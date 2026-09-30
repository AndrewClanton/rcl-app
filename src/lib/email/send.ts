import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashEmail } from "./hash";

// Sends one email through Resend (resend.com) with a plain HTTPS call: the
// everyday "transactional" mail (receipts, tickets, the daily report, booth
// and gift emails, tests). List email goes through campaign-send.ts instead.
//
// RESEND_API_KEY is set in Vercel. EMAIL_FROM is the sender, e.g.
// "Royale Cinema Lounge <hello@royalecinemajoplin.com>" once the domain is
// verified in Resend; until then Resend's own address works, but only for
// sending to the email the Resend account was made with.
//
// Transactional mail never checks email preferences or caps (a receipt is
// owed either way), but it does skip an address that hard-bounced: mailing
// it again only hurts the domain's reputation. Every send is tagged
// kind=transactional so a spam complaint about it is still caught by the
// webhook.
export function emailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

export interface SendOptions {
  replyTo?: string;
  text?: string;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
  idempotencyKey?: string;
}

async function hardBounced(to: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().from("email_suppressions").select("reason").eq("email_hash", hashEmail(to)).maybeSingle();
    return !error && data?.reason === "hard_bounce";
  } catch {
    return false;
  }
}

export async function sendEmail(to: string, subject: string, html: string, opts: SendOptions = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "Email isn't set up yet (RESEND_API_KEY missing)." };
  if (await hardBounced(to)) return { ok: false, error: "That address bounced before, so email to it is off. Check the address." };
  const tags = [{ name: "kind", value: "transactional" }, ...(opts.tags ?? []).filter((t) => t.name !== "kind")];
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey.slice(0, 256) } : {}),
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Royale Cinema Lounge <onboarding@resend.dev>",
      to: [to],
      subject,
      html,
      tags,
      ...(opts.text ? { text: opts.text } : {}),
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      ...(opts.headers ? { headers: opts.headers } : {}),
    }),
  }).catch(() => null);
  if (!res) return { ok: false, error: "Couldn't reach the email service." };
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return { ok: false, error: body?.message ?? `Email service answered ${res.status}.` };
}

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import { hashEmail } from "@/lib/email/hash";
import { orgInviteHtml, orgInviteSubject, orgInviteText } from "@/lib/email/org-invite-email";
import { allowAttempt } from "@/lib/rate-limit";
import { siteOrigin } from "@/lib/site-origin";
import type { StaffSession } from "@/lib/auth";

// Emails an organization's helper sign-up link (organizations.invite_code →
// /account/join) to one address: from the organization's Back office page,
// or at the register with the helper typing their work email. A
// transactional email (the receipts sender), so the marketing switch and
// email preferences don't apply; a hard-bounced address is still skipped.
// Each send is logged in org_invite_sends (who, to, when, from where).
// At most 10 an hour per organization, and 3 an hour to one address.

export const ORG_INVITES_PER_HOUR = 10;
const PER_ADDRESS_PER_HOUR = 3;

export type InviteSource = "back_office" | "register";

export interface OrgInviteSend {
  id: string;
  email: string;
  sentByName: string | null;
  source: InviteSource;
  at: string;
}

const UUID = /^[0-9a-f-]{36}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function cleanInviteEmail(raw: unknown): string | null {
  const email = String(raw ?? "").trim().toLowerCase();
  return email.length <= 200 && EMAIL.test(email) ? email : null;
}

export async function sendOrgInvite(
  orgId: string,
  rawEmail: unknown,
  source: InviteSource,
  staff: StaffSession,
): Promise<{ ok: true; orgName: string } | { ok: false; error: string }> {
  if (!UUID.test(orgId)) return { ok: false, error: "Couldn't find that organization." };
  const email = cleanInviteEmail(rawEmail);
  if (!email) return { ok: false, error: "That email doesn't look right. Check it and try again." };
  const db = createAdminClient();
  const { data: org } = await db.from("organizations").select("id, name, status, invite_code").eq("id", orgId).maybeSingle();
  if (!org) return { ok: false, error: "Couldn't find that organization." };
  if (org.status === "closed") return { ok: false, error: "This organization is closed, so its sign-up link doesn't work." };
  // The address first, so a repeat to one person doesn't use up the
  // organization's hour.
  if (!(await allowAttempt(`org-invite-to:${orgId}:${hashEmail(email)}`, PER_ADDRESS_PER_HOUR, 3600))) {
    return { ok: false, error: "That address already got a few invites this hour. Check the inbox (and spam)." };
  }
  if (!(await allowAttempt(`org-invite:${orgId}`, ORG_INVITES_PER_HOUR, 3600))) {
    return { ok: false, error: `That's ${ORG_INVITES_PER_HOUR} invites for ${org.name} in the last hour. Try again later.` };
  }
  const d = { orgName: org.name as string, joinUrl: `${await siteOrigin()}/account/join?c=${org.invite_code}` };
  const sent = await sendEmail(email, orgInviteSubject(d), orgInviteHtml(d), {
    text: orgInviteText(d),
    tags: [{ name: "category", value: "org_invite" }],
  });
  if (!sent.ok) return { ok: false, error: sent.error };
  const { error } = await db.from("org_invite_sends").insert({
    organization_id: orgId,
    email,
    sent_by: staff.employeeId,
    sent_by_name: staff.name.slice(0, 120),
    source,
    resend_id: sent.id,
  });
  if (error) console.error("org_invite_sends insert:", error.message);
  return { ok: true, orgName: d.orgName };
}

// The organization page's log, newest first.
export async function recentOrgInvites(orgId: string, limit = 25): Promise<OrgInviteSend[]> {
  const { data, error } = await createAdminClient()
    .from("org_invite_sends")
    .select("id, email, sent_by_name, source, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    email: r.email as string,
    sentByName: (r.sent_by_name as string | null) ?? null,
    source: r.source as InviteSource,
    at: r.created_at as string,
  }));
}

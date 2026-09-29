import "server-only";

// Sends email through Resend (resend.com) with a plain HTTPS call.
// RESEND_API_KEY is set in Vercel. EMAIL_FROM is the sender, e.g.
// "Royale Cinema Lounge <reports@royalecinemajoplin.com>" once the domain is
// verified in Resend; until then Resend's own address works, but only for
// sending to the email the Resend account was made with.
export function emailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  opts: { replyTo?: string; text?: string } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "Email isn't set up yet (RESEND_API_KEY missing)." };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Royale Cinema Lounge <onboarding@resend.dev>",
      to: [to],
      subject,
      html,
      ...(opts.text ? { text: opts.text } : {}),
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
    }),
  }).catch(() => null);
  if (!res) return { ok: false, error: "Couldn't reach the email service." };
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return { ok: false, error: body?.message ?? `Email service answered ${res.status}.` };
}

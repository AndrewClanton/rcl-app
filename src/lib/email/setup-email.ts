// "Finish setting up your Royale Cinema account": the setup link for a member
// with an account but no website login yet (lib/sign-in-help.ts). Sent
// when they ask on the sign-in page, or when staff send it from the Back
// office. Transactional: one personal link, nothing to unsubscribe from.
// Drawn in the same frame as every Royale email (shell.ts), signed by the
// crew, never by a staff member.
import { BODY, C, THEATER_LINE, button, row, shell } from "./shell";
import { esc, firstNameOf } from "./format";

export const SETUP_SUBJECT = "Finish setting up your Royale Cinema account";

export function setupEmail(input: { name: string | null; url: string; days: number }): { subject: string; html: string; text: string } {
  const first = firstNameOf(input.name);
  const hi = first ? `Hi ${first},` : "Hi there,";
  const intro = "Your Royale Cinema account is here, with your points waiting. Set up your website login to see your points, visits and member card any time.";
  const note = `This link is just for you and works for ${input.days} days.`;
  const p = (text: string, extra = "") =>
    `<p style="margin:0 0 14px;font-family:${BODY};font-size:16px;line-height:25px;color:${C.ink};${extra}">${esc(text)}</p>`;

  const html = shell({
    subject: SETUP_SUBJECT,
    preheader: "Your points are waiting. One link and you're in.",
    rows: [
      row(`${p(hi)}${p(intro)}`, "padding:26px 28px 6px;"),
      row(`${button(input.url, "Set up my account")}<p style="margin:0;padding-top:12px;font-family:${BODY};font-size:13px;line-height:19px;color:${C.muted};">${esc(note)}</p>`, "padding:8px 28px 18px;"),
      row(p("The RCL crew", "margin:0;font-weight:700;"), "padding:6px 28px 24px;"),
      `<tr><td class="px" bgcolor="${C.cream}" style="background:${C.cream};padding:20px 28px 24px;border-top:3px solid ${C.ink};font-family:${BODY};font-size:12px;line-height:19px;color:${C.muted};">${esc(THEATER_LINE)}</td></tr>`,
    ].join("\n"),
  });

  const text = [hi, "", intro, "", `Set up my account: ${input.url}`, note, "", "The RCL crew", "", THEATER_LINE].join("\n");
  return { subject: SETUP_SUBJECT, html, text };
}

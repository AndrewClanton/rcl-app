// The organization helper invite: "You're invited to join Easter Seals at
// the Royale", one big button to the join link (/account/join?c=…). Sent
// from the organization's Back office page or at the register
// (src/lib/org-invite-server.ts). Plain tables and inline styles (what Gmail
// and phone mail apps render) in the Royale print palette, like the gift
// emails. Signed by the crew, never a staff member.

const INK = "#14110c";
const MUTED = "#6b6455";
const RULE = "#e3ddc9";
const GOLD = "#ffc72c";
const CREAM = "#f8f5ec";

// "an Easter Seals helper", "a Joplin Arc helper".
export const withArticle = (name: string) => `${/^[aeiou]/i.test(name.trim()) ? "an" : "a"} ${name}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface OrgInviteEmailData {
  orgName: string;
  joinUrl: string;
}

export function orgInviteSubject(d: OrgInviteEmailData) {
  return `You're invited to join ${d.orgName} at the Royale`;
}

export function orgInviteHtml(d: OrgInviteEmailData) {
  const org = esc(d.orgName);
  const url = esc(d.joinUrl);
  const perk = (icon: string, text: string) =>
    `<tr><td width="44" valign="top" style="padding:10px 0;border-bottom:1px solid ${RULE};font:900 22px/1 Arial,Helvetica,sans-serif;color:${INK}">${icon}</td><td style="padding:10px 0;border-bottom:1px solid ${RULE};font:700 15px/1.4 Arial,Helvetica,sans-serif;color:${INK}">${text}</td></tr>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:${CREAM}">
  <div style="display:none;max-height:0;overflow:hidden">Tap the button and sign up with your work email. Your day pass and movies with ${org} are covered.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:3px solid ${INK};border-collapse:separate">
      <tr><td style="background:${INK};padding:14px 22px;font:900 13px/1 Arial,Helvetica,sans-serif;letter-spacing:3px;text-transform:uppercase;color:${GOLD}">Royale Cinema Lounge</td></tr>
      <tr><td style="background:${GOLD};padding:22px;border-bottom:3px solid ${INK}">
        <div style="font:700 13px/1 'Courier New',monospace;letter-spacing:2px;text-transform:uppercase;color:${INK}">You're invited</div>
        <div style="margin-top:8px;font:900 30px/1.05 'Arial Black',Arial,Helvetica,sans-serif;color:${INK}">Join ${org} at the Royale</div>
      </td></tr>
      <tr><td align="center" style="padding:26px 22px 8px">
        <a href="${url}" style="display:block;background:${INK};color:${GOLD};font:900 18px/1.2 Arial,Helvetica,sans-serif;letter-spacing:1px;text-transform:uppercase;text-decoration:none;padding:20px 18px;text-align:center">Join as ${esc(withArticle(d.orgName))} helper</a>
        <div style="margin-top:10px;font:13px/1.4 Arial,Helvetica,sans-serif;color:${MUTED}">Sign up with your <strong style="color:${INK}">work</strong> email. It stays separate from any personal Royale account.</div>
      </td></tr>
      <tr><td style="padding:14px 22px 4px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          ${perk("🎟", `Your day pass and movies are on ${org} when you're here with the group.`)}
          ${perk("🍿", "Food and drinks are regular price.")}
          ${perk("👋", `At the box office, tell us you're with ${org}.`)}
        </table>
      </td></tr>
      <tr><td style="padding:18px 22px 22px;font:15px/1.5 Arial,Helvetica,sans-serif;color:${INK}">
        See you at the movies,<br><strong>The Royale crew</strong>
        <div style="margin-top:14px;font:12px/1.5 Arial,Helvetica,sans-serif;color:${MUTED}">Button not working? Paste this into your browser:<br><a href="${url}" style="color:${MUTED};word-break:break-all">${url}</a></div>
        <div style="margin-top:10px;font:12px/1.5 Arial,Helvetica,sans-serif;color:${MUTED}">Not expecting this? You can ignore it; nothing happens unless you sign up.</div>
      </td></tr>
    </table>
    <div style="max-width:560px;margin:14px auto 0;font:11px/1.5 'Courier New',monospace;color:${MUTED};letter-spacing:1px;text-transform:uppercase">Royale Cinema Lounge · 715 E Broadway, Joplin, MO 64801 · 417-281-4172</div>
  </td></tr></table>
</body></html>`;
}

export function orgInviteText(d: OrgInviteEmailData) {
  return `You're invited to join ${d.orgName} at the Royale.

Join as ${withArticle(d.orgName)} helper (sign up with your work email):
${d.joinUrl}

Your day pass and movies are on ${d.orgName} when you're here with the group. Food and drinks are regular price.

See you at the movies,
The Royale crew`;
}

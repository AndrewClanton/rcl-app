// "Keep your unlimited membership going": the link staff email a former
// unlimited member from the register (pos/legacy-plus-actions.ts) so they
// can put their card on Stripe's page from their own phone. Only ever sent
// when staff press the button, never automatically. Plain tables and inline
// styles (what Gmail and phone mail apps render), in the Royale print
// palette, like the gift emails. Signed by the crew, never a person.

const INK = "#14110c";
const MUTED = "#6b6455";
const GOLD = "#ffc72c";
const CREAM = "#f8f5ec";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const first = (name: string) => name.trim().split(/\s+/)[0] || name;

export interface UnlimitedFinishEmail {
  name: string;
  plan: string; // "$15/month"
  url: string;
}

export function unlimitedFinishSubject() {
  return "Keep your unlimited membership going";
}

export function unlimitedFinishText(e: UnlimitedFinishEmail) {
  return [
    `Hi ${first(e.name)},`,
    "",
    `Our new system doesn't have a card on file for your unlimited membership yet. Add yours here to keep it going (${e.plan} plus tax, charged today and then automatically):`,
    e.url,
    "",
    "The link works for 7 days. Rather do it in person? Tap your card at the register next time you're in.",
    "",
    "The Royale crew",
  ].join("\n");
}

export function unlimitedFinishHtml(e: UnlimitedFinishEmail) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:${CREAM}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:3px solid ${INK};border-collapse:separate">
      <tr><td style="background:${INK};padding:14px 22px;font:900 13px/1 Arial,Helvetica,sans-serif;letter-spacing:3px;text-transform:uppercase;color:${GOLD}">Insiders+ · unlimited movies</td></tr>
      <tr><td style="padding:22px 22px 6px">
        <p style="margin:0 0 14px;font:16px/1.5 Arial,Helvetica,sans-serif;color:${INK}">Hi ${esc(first(e.name))}, our new system doesn't have a card on file for your unlimited membership yet. Add yours to keep it going: <strong>${esc(e.plan)}</strong> plus tax, charged today and then automatically.</p>
      </td></tr>
      <tr><td style="padding:8px 22px 6px">
        <a href="${esc(e.url)}" style="display:inline-block;background:${INK};color:${GOLD};font:900 13px/1 Arial,Helvetica,sans-serif;letter-spacing:1px;text-transform:uppercase;text-decoration:none;padding:12px 18px">Add my card</a>
      </td></tr>
      <tr><td style="padding:14px 22px 22px">
        <p style="margin:0 0 10px;font:14px/1.5 Arial,Helvetica,sans-serif;color:${MUTED}">The link works for 7 days. Rather do it in person? Tap your card at the register next time you're in.</p>
        <p style="margin:0;font:700 15px/1.5 Arial,Helvetica,sans-serif;color:${INK}">The Royale crew</p>
      </td></tr>
    </table>
    <div style="max-width:560px;margin:14px auto 0;font:11px/1.5 'Courier New',monospace;color:${MUTED};letter-spacing:1px;text-transform:uppercase">Royale Cinema Lounge · 715 E Broadway, Joplin, MO 64801 · 417-281-4172</div>
  </td></tr></table>
</body></html>`;
}

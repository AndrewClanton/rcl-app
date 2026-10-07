import { ADDRESS, BUSINESS, isReceipt, nonprofitLine, NONPROFIT_TAGLINE, money, monthTitle, NONPROFIT, shortDate, statusText, type InvoiceDoc } from "@/lib/org-invoices";

// An organization's monthly invoice/receipt (lib/org-invoices.ts), emailed
// from its Back office invoice page (lib/org-invoice-server.ts). Pictures
// first: three big numbers (worth, you pay, covered by the Royale Cinema
// Project), the status, one "Pay by card" button while something's owed and
// there's a payment link, then each line with the same three numbers.
// Plain tables and inline styles (what Gmail and phone mail apps render) in
// the print palette, like the helper invite. Signed by the crew.

const INK = "#14110c";
const MUTED = "#6b6455";
const RULE = "#e3ddc9";
const GOLD = "#ffc72c";
const CREAM = "#f8f5ec";
const GREEN = "#1f6b3a";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function orgInvoiceSubject(d: InvoiceDoc) {
  return `${d.orgName}: your ${monthTitle(d.month)} ${isReceipt(d) ? "receipt" : "invoice"} from Royale Cinema`;
}

export function orgInvoiceHtml(d: InvoiceDoc) {
  const receipt = isReceipt(d);
  const t = d.totals;
  const tile = (label: string, value: string, bg: string, fg: string) =>
    `<td width="33%" valign="top" style="background:${bg};border:2px solid ${INK};padding:12px 8px;text-align:center"><div style="font:700 11px/1.2 'Courier New',monospace;letter-spacing:1px;text-transform:uppercase;color:${fg}">${label}</div><div style="margin-top:6px;font:900 22px/1 'Arial Black',Arial,Helvetica,sans-serif;color:${fg}">${value}</div></td>`;
  const gap = `<td width="6" style="font-size:0">&nbsp;</td>`;
  const line = (l: InvoiceDoc["lines"][number]) => `<tr><td style="padding:12px 0;border-bottom:1px solid ${RULE}">
      <div style="font:700 15px/1.35 Arial,Helvetica,sans-serif;color:${INK}">${l.date ? `<span style="color:${MUTED}">${esc(shortDate(l.date))} · </span>` : ""}${esc(l.label)}</div>
      ${l.detail ? `<div style="font:13px/1.4 Arial,Helvetica,sans-serif;color:${MUTED}">${esc(l.detail)}</div>` : ""}
      <div style="margin-top:4px;font:13px/1.4 Arial,Helvetica,sans-serif;color:${INK}">Worth ${money(l.fullValue)} · You pay <strong>${money(l.charged)}</strong>${
        l.covered > 0 ? ` · <strong style="color:${GREEN}">Covered by the ${NONPROFIT}: ${money(l.covered)}</strong>` : ""
      }</div>
    </td></tr>`;
  const pay =
    !receipt && d.payUrl
      ? `<tr><td align="center" style="padding:4px 22px 6px">
        <a href="${esc(d.payUrl)}" style="display:block;background:${INK};color:${GOLD};font:900 18px/1.2 Arial,Helvetica,sans-serif;letter-spacing:1px;text-transform:uppercase;text-decoration:none;padding:18px;text-align:center">Pay ${money(t.due)} by card</a>
        <div style="margin-top:8px;font:13px/1.4 Arial,Helvetica,sans-serif;color:${MUTED}">Or pay with cash or a check at the box office.</div>
      </td></tr>`
      : !receipt
        ? `<tr><td align="center" style="padding:0 22px 6px;font:13px/1.4 Arial,Helvetica,sans-serif;color:${MUTED}">Pay with cash, a check or a card at the box office.</td></tr>`
        : "";
  return `<!doctype html><html><body style="margin:0;padding:0;background:${CREAM}">
  <div style="display:none;max-height:0;overflow:hidden">Worth ${money(t.fullValue)}. You pay ${money(t.charged)}. The ${NONPROFIT} covered ${money(t.covered)}.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:3px solid ${INK};border-collapse:separate">
      <tr><td style="background:${INK};padding:14px 22px;font:900 13px/1 Arial,Helvetica,sans-serif;letter-spacing:3px;text-transform:uppercase;color:${GOLD}">Royale Cinema Lounge</td></tr>
      <tr><td style="background:${GOLD};padding:22px;border-bottom:3px solid ${INK}">
        <div style="font:700 13px/1 'Courier New',monospace;letter-spacing:2px;text-transform:uppercase;color:${INK}">${esc(monthTitle(d.month))} ${receipt ? "receipt" : "invoice"} · ${esc(d.number)}</div>
        <div style="margin-top:8px;font:900 30px/1.05 'Arial Black',Arial,Helvetica,sans-serif;color:${INK}">${esc(d.orgName)}</div>
      </td></tr>
      <tr><td style="padding:22px 22px 8px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate"><tr>
          ${tile("Worth", money(t.fullValue), "#ffffff", INK)}${gap}${tile("You pay", money(t.charged), "#ffffff", INK)}${gap}${tile("Covered", money(t.covered), GOLD, INK)}
        </tr></table>
        <div style="margin-top:8px;font:13px/1.4 Arial,Helvetica,sans-serif;color:${MUTED};text-align:center">Covered by the <strong style="color:${INK}">${NONPROFIT}</strong>, a 501(c)(3) nonprofit: <em>${NONPROFIT_TAGLINE}</em></div>
      </td></tr>
      <tr><td align="center" style="padding:10px 22px 14px">
        <div style="display:inline-block;border:2px solid ${receipt ? GREEN : INK};color:${receipt ? GREEN : INK};padding:8px 14px;font:900 16px/1.2 Arial,Helvetica,sans-serif">${esc(statusText(d))}</div>
      </td></tr>
      ${pay}
      <tr><td style="padding:10px 22px 4px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          ${d.lines.length ? d.lines.map(line).join("") : `<tr><td style="padding:12px 0;font:14px/1.4 Arial,Helvetica,sans-serif;color:${MUTED}">Nothing this month.</td></tr>`}
          <tr><td style="padding:12px 0;font:900 15px/1.4 Arial,Helvetica,sans-serif;color:${INK}">Month total: worth ${money(t.fullValue)} · you pay ${money(t.charged)} · covered ${money(t.covered)}</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:14px 22px 22px;font:15px/1.5 Arial,Helvetica,sans-serif;color:${INK}">
        Thanks for bringing your group to the movies,<br><strong>The RCL crew</strong>
        <div style="margin-top:14px;font:12px/1.5 Arial,Helvetica,sans-serif;color:${MUTED}">Questions? Just reply to this email. Comps are day passes and movies at their menu price.</div>
      </td></tr>
    </table>
    <div style="max-width:560px;margin:14px auto 0;font:11px/1.5 'Courier New',monospace;color:${MUTED};letter-spacing:1px;text-transform:uppercase">${BUSINESS} · ${ADDRESS} · 417-281-4172<br>${esc(nonprofitLine(d.ein))}</div>
  </td></tr></table>
</body></html>`;
}

export function orgInvoiceText(d: InvoiceDoc) {
  const t = d.totals;
  const lines = d.lines
    .map((l) => `- ${l.date ? `${shortDate(l.date)}: ` : ""}${l.label}${l.detail ? ` (${l.detail})` : ""}\n  Worth ${money(l.fullValue)}, you pay ${money(l.charged)}${l.covered > 0 ? `, covered by the ${NONPROFIT}: ${money(l.covered)}` : ""}`)
    .join("\n");
  return `${d.orgName}: ${monthTitle(d.month)} ${isReceipt(d) ? "receipt" : "invoice"} (${d.number})

Worth ${money(t.fullValue)}. You pay ${money(t.charged)}. Covered by the ${NONPROFIT}: ${money(t.covered)}. ${NONPROFIT_TAGLINE}
${statusText(d)}
${!isReceipt(d) && d.payUrl ? `\nPay by card: ${d.payUrl}\nOr pay with cash or a check at the box office.\n` : ""}
${lines || "Nothing this month."}

Thanks for bringing your group to the movies,
The RCL crew

${BUSINESS} · ${ADDRESS}
${nonprofitLine(d.ein)}`;
}

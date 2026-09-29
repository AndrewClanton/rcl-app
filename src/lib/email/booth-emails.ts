// Booth booking emails: the guest's confirmation and the staff alert. Plain
// tables and inline styles (what Gmail and phone mail apps render), in the
// Royale print palette.

const INK = "#14110c";
const MUTED = "#6b6455";
const RULE = "#e3ddc9";
const RED = "#ed1c24";
const GOLD = "#ffc72c";
const CREAM = "#f8f5ec";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export interface BoothEmailData {
  booth: string;
  dateLong: string; // "Wednesday, September 30"
  window: string; // "7:00–9:00 PM"
  name: string;
  email: string;
  phone: string | null;
  party: number;
  fee: number; // 0 = free with Insiders+
  tax: number;
}

function frame(inner: string) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:${CREAM}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:3px solid ${INK};border-collapse:separate">
      ${inner}
    </table>
    <div style="max-width:560px;margin:14px auto 0;font:11px/1.5 'Courier New',monospace;color:${MUTED};letter-spacing:1px;text-transform:uppercase">Royale Cinema Lounge · 715 E Broadway, Joplin, MO 64801 · 417-281-4172</div>
  </td></tr></table>
</body></html>`;
}

function specRows(pairs: [string, string][]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    ${pairs
      .map(
        ([k, v]) => `<tr>
      <td style="padding:9px 0;border-bottom:1px solid ${RULE};font:700 11px/1.4 'Courier New',monospace;letter-spacing:1px;text-transform:uppercase;color:${MUTED};width:38%">${esc(k)}</td>
      <td style="padding:9px 0;border-bottom:1px solid ${RULE};font:700 16px/1.4 Arial,Helvetica,sans-serif;color:${INK}">${esc(v)}</td>
    </tr>`,
      )
      .join("")}
  </table>`;
}

// ---------- to the guest ----------

export function boothConfirmationSubject(b: BoothEmailData) {
  return `Your booth is reserved: ${b.booth}, ${b.dateLong}, ${b.window}`;
}

export function boothConfirmationHtml(b: BoothEmailData) {
  const paid = b.fee > 0 ? `${money(b.fee + b.tax)} paid` : "Free with your Insiders+";
  return frame(`
    <tr><td style="background:${INK};padding:14px 22px;font:900 13px/1 Arial,Helvetica,sans-serif;letter-spacing:3px;text-transform:uppercase;color:${GOLD}">Booth reserved</td></tr>
    <tr><td style="background:${GOLD};padding:22px;border-bottom:3px solid ${INK}">
      <div style="font:900 30px/1.05 'Arial Black',Arial,Helvetica,sans-serif;color:${INK}">${esc(b.booth)}</div>
      <div style="margin-top:8px;font:700 17px/1.4 Arial,Helvetica,sans-serif;color:${INK}">${esc(b.dateLong)} · ${esc(b.window)}</div>
    </td></tr>
    <tr><td style="padding:18px 22px 6px">
      <p style="margin:0 0 14px;font:16px/1.5 Arial,Helvetica,sans-serif;color:${INK}">Hi ${esc(b.name.split(" ")[0] || b.name)}, your booth is held for your two-hour window. There'll be a Reserved card on it when you get here; just let us know you've arrived.</p>
      ${specRows([
        ["Booth", b.booth],
        ["Date", b.dateLong],
        ["Time", b.window],
        ["Party", `${b.party} ${b.party === 1 ? "person" : "people"}`],
        ["Reservation", paid],
      ])}
    </td></tr>
    <tr><td style="padding:12px 22px 22px">
      <p style="margin:0 0 8px;font:15px/1.5 Arial,Helvetica,sans-serif;color:${INK}">Food, drinks and any movie tickets are ordered separately once you're seated.</p>
      <p style="margin:0;font:15px/1.5 Arial,Helvetica,sans-serif;color:${INK}">Need to change or cancel? Call <strong>417-281-4172</strong> or reply to this email.</p>
    </td></tr>`);
}

// ---------- to the owner and admins ----------

export function boothAlertSubject(b: BoothEmailData) {
  return `New booth booking: ${b.booth}, ${b.dateLong} ${b.window} (${b.name}, ${b.party})`;
}

export function boothAlertHtml(b: BoothEmailData, adminUrl: string) {
  return frame(`
    <tr><td style="background:${RED};padding:14px 22px;font:900 13px/1 Arial,Helvetica,sans-serif;letter-spacing:3px;text-transform:uppercase;color:#ffffff">New booth booking</td></tr>
    <tr><td style="padding:18px 22px 6px">
      ${specRows([
        ["Booth", b.booth],
        ["When", `${b.dateLong}, ${b.window}`],
        ["Guest", b.name],
        ["Party", String(b.party)],
        ["Email", b.email],
        ["Phone", b.phone || "—"],
        ["Paid", b.fee > 0 ? money(b.fee + b.tax) : "Free (Insiders+)"],
      ])}
    </td></tr>
    <tr><td style="padding:14px 22px 22px">
      <p style="margin:0 0 14px;font:15px/1.5 Arial,Helvetica,sans-serif;color:${INK}">It's on the register's shift bar the day before and the day of, with a button to print the Reserved card.</p>
      <a href="${esc(adminUrl)}" style="display:inline-block;background:${INK};color:${GOLD};font:900 13px/1 Arial,Helvetica,sans-serif;letter-spacing:1px;text-transform:uppercase;text-decoration:none;padding:12px 18px">See all booth bookings</a>
    </td></tr>`);
}

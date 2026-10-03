import type { DailyDigest } from "@/lib/data/daily-digest";
import { DAILY_COFFEE_LINE } from "@/lib/daily-perk";
import { taxFreeCallout, taxFreeLine } from "@/lib/tax-exempt";
import type { MembershipLineKey, MembershipTotals } from "@/lib/membership-payments/rows";

// The end-of-day report as an email: plain tables and inline styles, which
// is what Gmail and phone mail apps render reliably. Also shown as-is on
// Reports → Daily email so it can be previewed any day.

const INK = "#14110c";
const MUTED = "#6b6455";
const RULE = "#e3ddc9";
const RED = "#ed1c24";
const GOLD = "#ffc72c";
const CREAM = "#f8f5ec";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function change(now: number, before: number) {
  if (!before) return "";
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return "same as";
  return `${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% from`;
}

function section(title: string, body: string) {
  return `<tr><td style="padding:22px 0 0">
    <div style="font:700 11px/1.4 'Courier New',monospace;letter-spacing:2px;text-transform:uppercase;color:${MUTED};margin-bottom:8px">${esc(title)}</div>
    ${body}
  </td></tr>`;
}

function rows(pairs: [string, string, boolean?][]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font:15px/1.5 Arial,Helvetica,sans-serif;color:${INK}">
    ${pairs
      .map(
        ([a, b, strong]) =>
          `<tr><td style="padding:4px 0;border-bottom:1px solid ${RULE}${strong ? ";font-weight:700" : ""}">${a}</td><td align="right" style="padding:4px 0;border-bottom:1px solid ${RULE};white-space:nowrap${strong ? ";font-weight:700" : ""}">${b}</td></tr>`,
      )
      .join("")}
  </table>`;
}

// "1 new yearly ($166.35), 2 renewals ($32.62)": what Stripe charged for
// Insiders+ and gift memberships that day.
const MEMBERSHIP_NOUN: Record<MembershipLineKey, [string, string]> = {
  new_month: ["new monthly", "new monthly"],
  new_year: ["new yearly", "new yearly"],
  renewal: ["renewal", "renewals"],
  switch: ["switch to yearly", "switches to yearly"],
  change: ["plan change", "plan changes"],
  gift: ["gift membership", "gift memberships"],
  refund: ["refund", "refunds"],
};
function membershipsSentence(m: MembershipTotals) {
  return m.lines.map((l) => `${l.count} ${MEMBERSHIP_NOUN[l.key][l.count === 1 ? 0 : 1]} (${money(l.collected)})`).join(", ");
}

function bullets(items: string[], color = INK) {
  return `<ul style="margin:0;padding-left:18px;font:15px/1.5 Arial,Helvetica,sans-serif;color:${color}">${items.map((i) => `<li style="margin:0 0 6px">${esc(i)}</li>`).join("")}</ul>`;
}

export function dailyDigestSubject(d: DailyDigest) {
  const orders = d.day.orders.filter((o) => o.status === "completed").length;
  return `Royale ${d.label}: ${money(d.day.collected)} in, ${orders} order${orders === 1 ? "" : "s"}, ${d.day.ticketsSold} ticket${d.day.ticketsSold === 1 ? "" : "s"}`;
}

export function dailyDigestHtml(d: DailyDigest, reportUrl: string) {
  const r = d.day;
  const orders = r.orders.filter((o) => o.status === "completed").length;
  // Memberships are in the money in, but they aren't orders.
  const orderMoney = r.collected - r.memberships.collected;
  const compare: string[] = [];
  if (d.lastWeek?.collected) compare.push(`${change(r.collected, d.lastWeek.collected)} last week (${money(d.lastWeek.collected)})`);
  if (d.weekdayAverage && d.weekdayAverage.weeks > 1) compare.push(`typical ${d.label.split(",")[0]}: ${money(d.weekdayAverage.collected)}`);

  const money_in: [string, string, boolean?][] = [
    ["Cash", money(r.cash)],
    ["Card", money(r.card)],
    ["Online (tickets, booths)", money(r.online)],
  ];
  // Charged by Stripe, never at the register (so not in Cash or Card).
  if (r.membershipLines.length) money_in.push(["Insiders+ memberships (Stripe)", money(r.memberships.collected)]);
  if (r.vouchers > 0) money_in.push(["Trivia vouchers (no money in)", money(r.vouchers)]);
  money_in.push(["Collected", money(r.collected), true]);

  const sold: [string, string, boolean?][] = r.sold.map((s) => [`${esc(s.label)}${s.detail ? ` <span style="color:${MUTED}">· ${esc(s.detail)}</span>` : ""}`, money(s.amount)]);
  if (r.discounts > 0) sold.push(["Member discounts", `−${money(r.discounts)}`]);
  if (r.dailyCoffee > 0) sold.push([`${DAILY_COFFEE_LINE} · ${r.dailyCoffeeCount}`, `−${money(r.dailyCoffee)}`]);
  sold.push(["Net sales", money(r.netSales), true]);
  sold.push([`<span style="color:${MUTED}">Tips · sales tax</span>`, `<span style="color:${MUTED}">${money(r.tips)} · ${money(r.tax)}</span>`]);
  // Orders rung up tax-free: a line at the top, and each one with who and why.
  const taxFree = taxFreeCallout(r.taxFreeOrders);

  const body = [
    section("Money in", rows(money_in)),
    sold.length > 2 ? section("What sold", rows(sold)) : "",
    r.taxFreeOrders.length ? section(`Tax-free orders · ${r.taxFreeOrders.length}`, bullets(r.taxFreeOrders.map(taxFreeLine))) : "",
    r.topItems.length ? section("Top items", rows(r.topItems.slice(0, 5).map((i) => [`${i.qty}× ${esc(i.name)}`, money(i.revenue)]))) : "",
    d.showings.length
      ? section(
          "Showings",
          rows(d.showings.map((s) => [`${esc(s.time)} · ${esc(s.title)}${s.room && !/^indoor/i.test(s.room) ? ` <span style="color:${MUTED}">(${esc(s.room)})</span>` : ""}`, `${s.sold} / ${s.capacity}`])),
        )
      : "",
    d.good.length ? section("Good news", bullets(d.good)) : "",
    d.watch.length ? section("Worth a look", bullets(d.watch, INK)) : "",
    d.ranOut?.length
      ? section(
          "Ran out today",
          rows(
            d.ranOut.map((o) => [
              `<strong>${esc(o.what)}</strong> <span style="color:${MUTED}">· ${esc(o.time)}${o.by ? `, ${esc(o.by)}` : ""}</span>`,
              o.bought ? esc(o.status) : `<span style="color:${o.status === "Not bought yet" ? RED : MUTED}">${esc(o.status)}</span>`,
            ]),
          ),
        )
      : "",
    d.staff.length ? section("On shift", rows(d.staff.map((s) => [esc(s.name), esc(s.hours)]))) : "",
    section(
      `Coming up · ${d.next.label}`,
      d.next.items.length ? rows(d.next.items.map((i) => [esc(i.text), esc(i.time)])) : `<p style="margin:0;font:15px Arial,sans-serif;color:${MUTED}">Nothing on the schedule yet.</p>`,
    ),
    d.newMembers || r.membershipLines.length
      ? section(
          "Members",
          [
            d.newMembers ? `${d.newMembers} new member${d.newMembers === 1 ? "" : "s"} joined.` : "",
            r.membershipLines.length ? `Insiders+: ${membershipsSentence(r.memberships)}.` : "",
          ]
            .filter(Boolean)
            .map((line) => `<p style="margin:0 0 4px;font:15px Arial,sans-serif">${esc(line)}</p>`)
            .join(""),
        )
      : "",
  ].join("");

  return `<!doctype html><html><body style="margin:0;padding:0;background:${CREAM}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:2px solid ${INK};border-radius:8px">
  <tr><td style="background:${INK};padding:18px 22px;border-radius:6px 6px 0 0">
    <div style="font:700 11px/1.4 'Courier New',monospace;letter-spacing:2px;color:${GOLD}">ROYALE CINEMA LOUNGE · END OF DAY</div>
    <div style="font:900 24px/1.2 'Arial Black',Arial,sans-serif;color:#ffffff;margin-top:4px">${esc(d.label)}</div>
  </td></tr>
  <tr><td style="padding:22px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td>
        <div style="font:900 40px/1 'Arial Black',Arial,sans-serif;color:${RED}">${money(r.collected)}</div>
        <div style="font:15px/1.5 Arial,sans-serif;color:${INK};margin-top:6px">${orders} order${orders === 1 ? "" : "s"} · ${r.ticketsSold} ticket${r.ticketsSold === 1 ? "" : "s"}${orders ? ` · ${money(orderMoney / Math.max(1, orders))} average` : ""}</div>
        ${compare.length ? `<div style="font:14px/1.5 Arial,sans-serif;color:${MUTED};margin-top:2px">${esc(compare.join(" · "))}</div>` : ""}
        ${taxFree ? `<div style="font:14px/1.5 Arial,sans-serif;color:${INK};margin-top:12px;padding:8px 10px;background:#fff6d6;border-left:4px solid ${GOLD}">${esc(taxFree)} Who and why are under Tax-free orders.</div>` : ""}
      </td></tr>
      ${body}
      <tr><td style="padding:26px 0 0">
        <a href="${esc(reportUrl)}" style="display:inline-block;background:${RED};color:#ffffff;text-decoration:none;font:700 15px Arial,sans-serif;padding:11px 18px;border-radius:6px">Open the full day report</a>
      </td></tr>
    </table>
  </td></tr>
</table>
<p style="font:12px/1.5 Arial,sans-serif;color:${MUTED};margin:14px 0 0">Sent to the Royale's admins after each business day (4 AM to 4 AM).</p>
</td></tr></table>
</body></html>`;
}

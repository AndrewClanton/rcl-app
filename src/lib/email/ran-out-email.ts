// The email the purchasers get the moment something's reported out on the
// register (src/lib/ops/ran-out-alert.ts sends it). Plain tables and inline
// styles, like the booth alert, so phone mail apps show it right.

const INK = "#14110c";
const MUTED = "#6b6455";
const RULE = "#e3ddc9";
const RED = "#ed1c24";
const GOLD = "#ffc72c";
const CREAM = "#f8f5ec";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface RanOutEmailData {
  what: string; // "Heavy whipping cream"
  when: string; // "8:09 PM Fri Oct 2"
  byName: string | null; // "Bryce"
  par: string | null; // "1 quart", or null with no par (or not on the sheet)
  source: string | null; // "Walmart"
  note: string | null;
  stopped: string[]; // menu items the register stopped selling
  counts: string[] | null; // this week's par counts, "Mon Sep 28: 2 quarts"; null when it isn't on the sheet
  bought: string[] | null; // what this week's data says was bought, "Tue Sep 29: +2 quarts"
  suggestion: string; // "Ran out before the week was over. Consider raising the par from 1 quart."
}

export function ranOutSubject(d: RanOutEmailData) {
  return `Ran out: ${d.what}${d.byName ? ` (reported by ${d.byName})` : ""}`;
}

function rows(pairs: [string, string][]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    ${pairs
      .map(
        ([k, v]) => `<tr>
      <td style="padding:9px 12px 9px 0;border-bottom:1px solid ${RULE};font:700 11px/1.4 'Courier New',monospace;letter-spacing:1px;text-transform:uppercase;color:${MUTED};width:34%;vertical-align:top">${esc(k)}</td>
      <td style="padding:9px 0;border-bottom:1px solid ${RULE};font:700 16px/1.4 Arial,Helvetica,sans-serif;color:${INK}">${v}</td>
    </tr>`,
      )
      .join("")}
  </table>`;
}

const lines = (items: string[]) => items.map(esc).join("<br>");

function facts(d: RanOutEmailData): [string, string][] {
  const out: [string, string][] = [
    ["Ran out", esc(d.when)],
    ["Reported by", esc(d.byName ?? "Not recorded")],
    ["Par", esc(d.par ?? (d.counts === null ? "Not on the par sheet" : "No par set"))],
  ];
  if (d.source) out.push(["Bought at", esc(d.source)]);
  if (d.note) out.push(["Note", esc(`“${d.note}”`)]);
  if (d.stopped.length) out.push(["Not selling", esc(d.stopped.join(", "))]);
  if (d.counts !== null) out.push(["Counted this week", d.counts.length ? lines(d.counts) : "No counts yet this week"]);
  if (d.bought !== null) out.push(["Bought this week", d.bought.length ? lines(d.bought) : "Nothing recorded"]);
  return out;
}

export function ranOutHtml(d: RanOutEmailData, backInStockUrl: string) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:${CREAM}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:3px solid ${INK};border-collapse:separate">
      <tr><td style="background:${RED};padding:14px 22px;font:900 13px/1 Arial,Helvetica,sans-serif;letter-spacing:3px;text-transform:uppercase;color:#ffffff">Ran out</td></tr>
      <tr><td style="padding:20px 22px 4px;font:900 26px/1.2 Arial,Helvetica,sans-serif;color:${INK}">Out of ${esc(d.what)}</td></tr>
      <tr><td style="padding:10px 22px 6px">${rows(facts(d))}</td></tr>
      <tr><td style="padding:14px 22px 4px">
        <div style="background:${GOLD};border:2px solid ${INK};padding:12px 14px;font:700 15px/1.5 Arial,Helvetica,sans-serif;color:${INK}">${esc(d.suggestion)}</div>
      </td></tr>
      <tr><td style="padding:16px 22px 22px">
        <p style="margin:0 0 14px;font:15px/1.5 Arial,Helvetica,sans-serif;color:${INK}">Once it's restocked, mark it back in stock. That takes the "Out of" line off the register and puts anything it stopped back on sale.</p>
        <a href="${esc(backInStockUrl)}" style="display:inline-block;background:${INK};color:${GOLD};font:900 13px/1 Arial,Helvetica,sans-serif;letter-spacing:1px;text-transform:uppercase;text-decoration:none;padding:12px 18px">Back in stock</a>
        <p style="margin:12px 0 0;font:12px/1.5 Arial,Helvetica,sans-serif;color:${MUTED}">Opens Back office → Ran out. You'll need to be signed in.</p>
      </td></tr>
    </table>
    <div style="max-width:560px;margin:14px auto 0;font:11px/1.5 'Courier New',monospace;color:${MUTED};letter-spacing:1px;text-transform:uppercase">Sent to the staff picked under Back office → Ran out → Ran-out alerts go to</div>
  </td></tr></table>
</body></html>`;
}

export function ranOutText(d: RanOutEmailData, backInStockUrl: string) {
  return [
    `Out of ${d.what}`,
    "",
    ...facts(d).map(([k, v]) => `${k}: ${v.replace(/<br>/g, "; ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')}`),
    "",
    d.suggestion,
    "",
    `Back in stock (Back office, signed in): ${backInStockUrl}`,
  ].join("\n");
}

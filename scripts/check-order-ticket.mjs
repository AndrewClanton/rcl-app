// Checks the kitchen order ticket (orderTicketXml in src/lib/print/receipt.ts)
// and the add-on arithmetic behind it (src/lib/print/order-lines.ts): every
// line fits the 80mm paper at its print size, the order number is huge,
// items are big and bold with modifiers indented under them, an add-on says
// so, nothing costs anything, special characters are made safe. Also the
// print-queue helpers a register relies on (drawer split, what counts as a
// print job). Prints a text preview. No printer or database needed.
//
// Usage: node scripts/check-order-ticket.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";

const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) { return next(s.startsWith("@/") ? ${JSON.stringify(srcRoot)} + s.slice(2) + ".ts" : s, c); }`,
    ),
);
const { orderTicketXml, receiptXml } = await import("../src/lib/print/receipt.ts");
const { newLines, addLines, subtractLines, tallyLines, readLines } = await import("../src/lib/print/order-lines.ts");
const { isEposDocument, withoutDrawer, hasDrawer, seenLabel, isOnline } = await import("../src/lib/print/stations.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

// ePOS-Print XML to the text on paper, tracking the character size (width
// w means 48 / w characters to the line) and bold.
function render(xml) {
  const out = [];
  let w = 1;
  let h = 1;
  let bold = false;
  for (const m of xml.matchAll(/<text([^>]*)\/>|<text>([\s\S]*?)<\/text>|<(cut|pulse|feed)([^>]*)\/>/g)) {
    if (m[1] !== undefined) {
      const ww = m[1].match(/width="(\d)"/);
      const hh = m[1].match(/height="(\d)"/);
      if (ww) w = Number(ww[1]);
      if (hh) h = Number(hh[1]);
      const em = m[1].match(/em="(true|false)"/);
      if (em) bold = em[1] === "true";
    } else if (m[2] !== undefined) {
      const text = m[2].replace(/&#10;$/, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
      out.push({ text, w, h, bold });
    } else out.push({ text: `[${m[3]}${m[4]}]`, w: 1, h: 1, bold: false, tag: true });
  }
  return out;
}
const fits = (rows) => rows.filter((l) => !l.tag && l.text.length > Math.floor(48 / l.w));

const at = "2026-10-03T01:42:00Z"; // 8:42 PM in Joplin
const order = {
  orderNumber: 10427,
  name: "Andrew & the “booth 3” crew",
  tab: true,
  station: "outdoor",
  at,
  kind: "order",
  lines: [
    { name: "Royale Burger", qty: 2, mods: ["No onion", "Add bacon", "Sub gluten-free bun, toasted extra long so it wraps onto two lines"] },
    { name: "Loaded nachos with jalapeños & extra queso for the table", qty: 1, mods: [] },
    { name: "Old Fashioned", qty: 1, mods: ["Rye"] },
  ],
  notes: "Allergy: peanuts <severe>",
};
const xml = orderTicketXml(order);
const rows = render(xml);
const text = rows.filter((r) => !r.tag);
const all = text.map((r) => r.text).join("\n");

check("every line fits the paper at its size", fits(rows).length === 0, fits(rows).map((l) => `${l.w}x: ${l.text}`).join(" | "));
check("order number printed huge (4x)", text.some((r) => r.text === "#10427" && r.w === 4 && r.h === 4 && r.bold));
check("tab name big and bold, wrapped", text.filter((r) => r.w === 2 && r.bold && /Andrew|crew/.test(r.text)).length >= 1 && all.includes("Tab: Andrew & the"));
check("register and time", text.some((r) => r.text === "OUTDOOR STAND  |  8:42 PM"));
check("items big and bold with quantity", text.some((r) => r.text === "2 x Royale Burger" && r.w === 2 && r.bold));
check("long item wraps under its name, not its quantity", /1 x Loaded nachos with\n {4}\S/.test(all));
check("modifiers indented under the item", text.some((r) => r.text === "      - No onion" && r.w === 1 && r.h === 2));
check("long modifier wraps further in", /\n {8}\S/.test(all.slice(all.indexOf("Sub gluten-free"))));
check("notes printed", all.includes("NOTE: Allergy: peanuts <severe>"));
check("no prices", !/\$\d/.test(all));
check("special characters escaped", xml.includes("Andrew &amp; the") && xml.includes("&lt;severe&gt;") && !/<severe>/.test(xml));
check("non-ASCII folded to plain text", xml.includes("&quot;booth") && xml.includes("3&quot;") && xml.includes("jalapenos") && !/[^\x00-\x7E]/.test(xml));
check("item count", all.includes("4 items"));
check("ends with a cut", /<cut type="feed"\/><\/epos-print>$/.test(xml));
check("no drawer kick", !xml.includes("<pulse"));
check("is a print job a register may queue", isEposDocument(xml));

const addon = orderTicketXml({ ...order, kind: "addon", lines: [{ name: "Fries", qty: 1, mods: [] }], notes: null });
const addonRows = render(addon).filter((r) => !r.tag);
check("add-on ticket says ADD-ON, big", addonRows.some((r) => r.text.trim() === "ADD-ON" && r.w === 2));
check("add-on carries the same order number", addonRows.some((r) => r.text === "#10427"));
check("add-on lists only what was added", addonRows.filter((r) => /^\d+ x /.test(r.text)).map((r) => r.text).join() === "1 x Fries" && addonRows.some((r) => r.text.startsWith("1 item added")));

const walkup = render(orderTicketXml({ ...order, tab: false, name: null, station: "bar", kind: "order" })).filter((r) => !r.tag);
check("walk-up order: no Tab line, bar register", !walkup.some((r) => /^Tab/.test(r.text)) && walkup.some((r) => r.text.startsWith("BAR  |")));
const reprint = render(orderTicketXml({ ...order, kind: "reprint", printedAt: "2026-10-03T02:05:00Z" })).filter((r) => !r.tag);
check("reprint is marked and says when", reprint.some((r) => r.text === "** REPRINT **") && reprint.some((r) => r.text.endsWith("reprinted 9:05 PM")));
const unknown = render(orderTicketXml({ ...order, station: null })).filter((r) => !r.tag);
check("unknown register still prints", unknown.some((r) => r.text.startsWith("REGISTER  |")));

// ---- which items are new on a tab ----
const L = (name, qty, mods = []) => ({ name, qty, mods });
const sent = [L("Burger", 1, ["No onion"]), L("Beer", 2)];
check("same item on two lines adds up", tallyLines([L("Beer", 1), L("Beer", 1)])[0].qty === 2);
check("nothing new", newLines([L("Beer", 2), L("Burger", 1, ["No onion"])], sent).length === 0);
check("one more of an item", JSON.stringify(newLines([L("Burger", 1, ["No onion"]), L("Beer", 3)], sent)) === JSON.stringify([L("Beer", 1)]));
check("same item, different modifiers, is new", JSON.stringify(newLines([...sent, L("Burger", 1, ["Add bacon"])], sent)) === JSON.stringify([L("Burger", 1, ["Add bacon"])]));
check("modifier order doesn't matter", newLines([L("Burger", 1, ["b", "a"])], [L("Burger", 1, ["a", "b"])]).length === 0);
check("removing an item isn't new", newLines([L("Beer", 2)], sent).length === 0);
check("add then take back", JSON.stringify(subtractLines(addLines(sent, [L("Fries", 1)]), [L("Fries", 1)])) === JSON.stringify(tallyLines(sent)));
check("stored JSON read back, junk dropped", readLines([{ name: "Beer", qty: 2, mods: [] }, null, { name: "", qty: 1 }, { qty: 3 }, "x"]).length === 1);

// ---- register -> queue helpers ----
const rxml = receiptXml(
  { orderNumber: 7, at, cashier: null, member: null, orderName: null, lines: [L("Beer", 1)].map((l) => ({ ...l, unit: 5 })), subtotal: 5, discounts: [], tax: 0.41, tip: 0, total: 5.41, payments: [{ label: "Cash", amount: 5.41 }] },
  { openDrawer: true },
);
check("receipt with drawer detected, and stripped for a reprint", hasDrawer(rxml) && !hasDrawer(withoutDrawer(rxml)) && isEposDocument(withoutDrawer(rxml)));
check("junk isn't a print job", !isEposDocument("<epos-print>") && !isEposDocument(`${xml}<ePOSPrint>`) && !isEposDocument(xml.replace("<text>", "<!DOCTYPE x><text>")) && !isEposDocument(xml.replace("</epos-print>", "</PrintData></ePOSPrint><ePOSPrint><PrintData></epos-print>")));
const now = Date.parse("2026-10-03T01:00:00Z");
check("online / last seen / never", seenLabel(null, 5, now) === "Never connected" && seenLabel("2026-10-03T00:59:30Z", 5, now) === "Online" && seenLabel("2026-10-03T00:57:00Z", 5, now) === "Last seen 3 min ago" && !isOnline("2026-10-03T00:57:00Z", 5, now));

console.log("\nSample kitchen ticket (wide text shown spaced out):\n" + "=".repeat(48));
for (const l of text) console.log(l.w > 1 ? l.text.split("").join(" ".repeat(l.w - 1)) : l.text);
console.log("=".repeat(48));
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll order ticket checks passed.");
process.exit(failures ? 1 : 0);

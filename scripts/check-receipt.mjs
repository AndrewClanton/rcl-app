// Checks the receipt printer layout (src/lib/print/receipt.ts): every line
// fits the 80mm paper, totals and payments appear, special characters are
// made safe, and the cash drawer opens only when asked. Prints a text
// preview of a sample receipt. No printer or database needed.
//
// Usage: node scripts/check-receipt.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";

// receipt.ts imports "@/lib/site" like the rest of the app; point that alias
// at src/ so plain node can load it.
const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) { return next(s.startsWith("@/") ? ${JSON.stringify(srcRoot)} + s.slice(2) + ".ts" : s, c); }`,
    ),
);
const { receiptXml, drawerXml, testPageXml, ticketXml, columns } = await import("../src/lib/print/receipt.ts");
const { ditherToRaster, rgbaToGray } = await import("../src/lib/print/raster.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

// Turn ePOS-Print XML into the text the printer would put on paper, tracking
// double-size text (half as many characters per line).
function render(xml) {
  const out = [];
  let big = false;
  for (const m of xml.matchAll(/<text([^>]*)\/>|<text>([\s\S]*?)<\/text>|<(cut|pulse|feed)[^>]*\/>/g)) {
    if (m[1] !== undefined) {
      if (/width="2"/.test(m[1])) big = true;
      if (/width="1"/.test(m[1])) big = false;
    } else if (m[2] !== undefined) {
      const text = m[2].replace(/&#10;$/, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
      out.push({ text, big });
    } else out.push({ text: `[${m[3]}]`, big: false });
  }
  return out;
}

const sample = {
  orderNumber: 1042,
  at: "2026-09-26T01:14:00Z",
  cashier: "Bryce",
  member: "Jamie O’Neil",
  orderName: "Booth 3",
  lines: [
    { name: "Old Fashioned", qty: 2, unit: 11, mods: ["Rye", "Extra cherry"] },
    { name: "Large popcorn with real butter & truffle salt — shareable", qty: 1, unit: 9.5, mods: [] },
    { name: "Café <special>", qty: 1, unit: 4.25, mods: [] },
  ],
  subtotal: 35.75,
  discounts: [{ label: "Member discount", amount: 1.79 }, { label: "Points reward", amount: 0 }],
  tax: 2.72,
  tip: 6,
  total: 42.68,
  payments: [{ label: "Cash", amount: 20 }, { label: "Card", amount: 22.68 }],
};

const xml = receiptXml(sample, { openDrawer: true });
const lines = render(xml);
const tooWide = lines.filter((l) => l.text.length > (l.big ? 24 : 48));
check("every line fits the paper", tooWide.length === 0, tooWide.map((l) => l.text).join(" | "));
check("drawer opens first when asked", xml.indexOf("<pulse") > -1 && xml.indexOf("<pulse") < xml.indexOf("<text>"));
check("no drawer unless asked", !receiptXml(sample).includes("<pulse"));
check("ends with a cut", /<cut type="feed"\/><\/epos-print>$/.test(xml));
check("special characters escaped", xml.includes("butter &amp;") && xml.includes("&lt;special&gt;") && !/<special>/.test(xml));
check("non-ASCII folded to plain text", xml.includes("Jamie O'Neil") && xml.includes("Cafe") && !/[^\x00-\x7E]/.test(xml));
const all = lines.map((l) => l.text).join("\n");
check("total and both payments printed", /TOTAL\s+\$42\.68/.test(all) && /Cash\s+\$20\.00/.test(all) && /Card\s+\$22\.68/.test(all));
check("zero discounts left off", !all.includes("Points reward") && all.includes("Member discount"));
check("long item wraps, indented, with price on its last line", /\n  truffle salt - shareable\s+\$9\.50/.test(all));
check("columns right-aligns within 48", columns("Tax", "$2.72")[0].length === 48 && columns("Tax", "$2.72")[0].endsWith("$2.72"));
check("drawer-only job has no paper output", !drawerXml().includes("<text>") && drawerXml().includes("<pulse"));
check("test page renders", render(testPageXml(sample.at)).some((l) => l.text === "PRINTER TEST"));

// Movie ticket: fits the paper, carries the pictures, code and cut.
const px = new Uint8Array(16 * 4 * 4).fill(255); // 16x4 white
for (let i = 0; i < 16; i++) px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 0; // first row black
const r = ditherToRaster(rgbaToGray(px, 16, 4), 16, 4);
check("dithered raster packs 1 bit per dot", r.width === 16 && Buffer.from(r.data, "base64").length === 8);
const tXml = ticketXml(
  { title: "Wallace & Gromit: The Curse of the Were-Rabbit", startsAt: "2026-10-03T01:00:00Z", room: "Outdoor Cinema", rating: "G", runtime: 85, orderNumber: 7, code: "RCL-TKT:7:abcd1234:2" },
  { logo: r, poster: r },
);
const tLines = render(tXml);
const tooWideT = tLines.filter((l) => l.text.length > (l.big ? 24 : 48));
check("ticket lines fit the paper", tooWideT.length === 0, tooWideT.map((l) => l.text).join(" | "));
check("ticket has logo and poster, QR code and a cut", (tXml.match(/<image /g) || []).length === 2 && tXml.includes('<symbol type="qrcode_model_2"') && /<cut type="feed"\/><\/epos-print>$/.test(tXml));
check("ticket says ADMIT ONE, no price or ticket count", tLines.some((l) => l.text.trim() === "ADMIT ONE") && !/Ticket \d+ of|\$\d/.test(tLines.map((l) => l.text).join("\n")));
check("ticket title escaped and wrapped", tXml.includes("WALLACE &amp; GROMIT") && tLines.filter((l) => l.big && /GROMIT|CURSE|RABBIT/.test(l.text)).length >= 2);
check("ticket shows the register order number", tLines.some((l) => l.text.trim() === "Order #7"));
// An online booking printed at the door goes by its booking number.
const doorLines = render(ticketXml({ title: "Clue", startsAt: "2026-10-03T01:00:00Z", room: "Main Theater", rating: "PG", runtime: 94, orderNumber: "T-1A2B3C4D", code: "RCL-TKT:T-1A2B3C4D:abcd1234:1" }));
check("door ticket shows the booking number", doorLines.some((l) => l.text.trim() === "Order T-1A2B3C4D"));

console.log("\nSample receipt:\n" + "=".repeat(48));
for (const l of lines) {
  if (l.text.startsWith("[")) continue;
  console.log(l.big ? l.text.split("").join(" ") : l.text);
}
console.log("=".repeat(48));
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll receipt checks passed.");
process.exit(failures ? 1 : 0);

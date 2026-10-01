// Checks the rules for points from past card purchases (src/lib/fortis-backfill.ts)
// and the "most regular regulars" runs (src/lib/regularity.ts) without a
// database, on made-up cards and members:
//  1. Reading the export: which rows are sales, refunds, voids and declines;
//     the subtotal or the amount; Central times and business dates (the 4 a.m.
//     edge, midnight and noon, both nights the clocks change); card keys stop
//     at six + four digits.
//  2. Names: LAST/FIRST, middle initials, case, punctuation, titles and
//     suffixes, accents, stand-in names; middle names that fit or clash;
//     short forms (Jake/Jacob, Chris/Christopher, not Mark/Mary).
//  3. Matching: email, then phone, then name; two members with the name and
//     a card pointing at two members need a pick; erased members never match.
//  4. One row per card: sales less refunds, voids and declines left out,
//     visit days, a refund-only card dropped.
//  5. Points: the rate, sales tax out, the cap with earlier grants, one entry
//     per member with card shares that add up.
//  6. Re-matching never overrides a person's decision or a grant.
//  7. Weekly runs: closed weeks, this week, the longest and current run.
//  8. Rewind (src/lib/fortis-lookup.ts): amounts read to the exact cent
//     ("$8", "8.00" and "8" are all $8.00), the day windows (exact, posting
//     dates up to 2 days back, after midnight), several purchases narrowing
//     to one card (each a different sale), the last 4, refunds never
//     counting as a purchase, who may assign a card, the history note, and
//     the per-sale rows the loader writes.
//
// Usage: node scripts/check-fortis-backfill.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";

const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        if (s === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
        return next(s.startsWith("@/") ? ${JSON.stringify(srcRoot)} + s.slice(2) + ".ts" : s, c);
      }`,
    ),
);
const L = await import("../src/lib/fortis-backfill.ts");
const R = await import("../src/lib/regularity.ts");
const LK = await import("../src/lib/fortis-lookup.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(label, ok, ok ? "" : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// ---------- 1. the export ----------
eq("approved sale", L.classifyFortisRow("101", "20"), "sale");
eq("refund (status 111, type 30)", L.classifyFortisRow("111", "30"), "refund");
eq("voided sale left out", L.classifyFortisRow("201", "20"), "voided");
eq("declined left out", L.classifyFortisRow("301", "20"), "declined");
eq("anything else left out", L.classifyFortisRow("111", "20"), "other");
eq("subtotal when there is one", L.rowDollars("12.50", "12.50"), 12.5);
eq("amount when the subtotal is 0", L.rowDollars("0.00", "23.10"), 23.1);
eq("amount when the subtotal is blank", L.rowDollars("", "9.00"), 9);
eq("nothing for a zeroed (voided) amount", L.rowDollars("0", "0.00"), 0);

eq("7:15 PM CDT", L.parseFortisTimestamp("09/21/2026 07:15:03 PM CDT"), { iso: "2026-09-22T00:15:03.000Z", businessDate: "2026-09-21" });
eq("1:30 AM belongs to the night before", L.parseFortisTimestamp("09/22/2026 01:30:00 AM CDT")?.businessDate, "2026-09-21");
eq("3:59 AM still the night before", L.parseFortisTimestamp("09/22/2026 03:59:59 AM CDT")?.businessDate, "2026-09-21");
eq("4:00 AM starts the new day", L.parseFortisTimestamp("09/22/2026 04:00:00 AM CDT")?.businessDate, "2026-09-22");
eq("12:05 AM is just after midnight", L.parseFortisTimestamp("09/21/2026 12:05:00 AM CDT"), { iso: "2026-09-21T05:05:00.000Z", businessDate: "2026-09-20" });
eq("12:05 PM is just after noon", L.parseFortisTimestamp("09/21/2026 12:05:00 PM CDT")?.iso, "2026-09-21T17:05:00.000Z");
eq("CST is UTC-6", L.parseFortisTimestamp("01/15/2026 10:00:00 PM CST"), { iso: "2026-01-16T04:00:00.000Z", businessDate: "2026-01-15" });
eq("fall back: 1:30 AM CDT", L.parseFortisTimestamp("11/01/2026 01:30:00 AM CDT"), { iso: "2026-11-01T06:30:00.000Z", businessDate: "2026-10-31" });
eq("fall back: 1:30 AM CST, an hour later", L.parseFortisTimestamp("11/01/2026 01:30:00 AM CST"), { iso: "2026-11-01T07:30:00.000Z", businessDate: "2026-10-31" });
eq("spring forward: 3:30 AM CDT", L.parseFortisTimestamp("03/08/2026 03:30:00 AM CDT"), { iso: "2026-03-08T08:30:00.000Z", businessDate: "2026-03-07" });
eq("unreadable date", L.parseFortisTimestamp("2026-09-21 19:15"), null);

eq("card key: first six + last four", L.cardKey(" 411111", "1111 "), "4111111111");
eq("card key: refuses a full number", L.cardKey("4111111111111111", "1111"), null);
eq("card key: refuses short or odd digits", [L.cardKey("41111", "1111"), L.cardKey("411111", "11a1")], [null, null]);

// ---------- 2. names ----------
const key = (s) => L.normalizeName(s).key;
eq("LAST/FIRST MIDDLE", L.normalizeName("SMITH/JOHN A"), { display: "John A Smith", key: "john smith", full: "john a smith" });
eq("LAST/FIRST.TITLE", key("SMITH/JOHN A.MR"), "john smith");
eq("suffix", key("John Smith Jr."), "john smith");
eq("suffix in the card's last name", key("SMITH III/JOHN"), "john smith");
eq("Last, First", key("Smith, John"), "john smith");
eq("First Last, Jr.", key("John Smith, Jr."), "john smith");
eq("apostrophes and case", key("O'BRIEN/SEAN"), "sean obrien");
eq("accents", key("José Núñez"), "jose nunez");
eq("title in front", key("Dr. Jane Doe"), "jane doe");
eq("hyphenated last name", key("SMITH-JONES/MARY"), "mary jones");
eq("extra spaces", key("  john   SMITH "), "john smith");
eq("stand-in names don't match", ["CARDHOLDER/VISA", "VALUED CUSTOMER", "VALUED/CUSTOMER", "ISSUE BRANDED/INSTANT", "A GIFT FOR YOU", "PAYWAVE/VISA", "AMEX/CONTACTLESS", "/"].map(key), Array(8).fill(null));
eq("one word or an initial doesn't match", [key("Madonna"), key("J SMITH"), key("SMITH/J"), key("")], [null, null, null, null]);
eq("middle initial fits a middle name", L.middlesFit("john a smith", "john allen smith"), true);
eq("no middle on one side fits", L.middlesFit("john a smith", "john smith"), true);
eq("different middle initials don't", L.middlesFit("john a smith", "john b smith"), false);
eq("Jake is Jacob", L.similarFirstNames("jake", "jacob"), true);
eq("Chris is Christopher", L.similarFirstNames("christopher", "chris"), true);
eq("Bill is William", L.similarFirstNames("bill", "william"), true);
eq("Mark is not Mary", L.similarFirstNames("mark", "mary"), false);
eq("Jo is too short to guess", L.similarFirstNames("jo", "joseph"), false);
eq("the same name isn't 'similar'", L.similarFirstNames("john", "john"), false);

// ---------- 3. matching ----------
const M = (id, name, email = null, phoneDigits = null, erased = false) => ({ id, name, email, phoneDigits, erased });
const members = [
  M("A", "Jake Miller", "Jake@Example.com", "4175550101"),
  M("B", "John Smith"),
  M("C", "John Smith"),
  M("D", "Mary Jones", null, null, true),
  M("F", "Pat Lee", "pat@example.com", "4175550199"),
  M("G", "Sam Q Public"),
  M("H", "Jake Thompson"),
  M("I", "Ann Lake"),
];
const idx = L.buildMemberIndex(members);
const card = (o) => ({ email: null, phone: null, nameKeys: [], nameFulls: [], ...o });
const fromName = (raw) => {
  const n = L.normalizeName(raw);
  return card({ nameKeys: n.key ? [n.key] : [], nameFulls: n.full ? [n.full] : [] });
};
eq("email, any case", L.matchCard(card({ email: "jake@example.COM" }), idx), { status: "matched", kind: "email", confidence: "high", memberId: "A", candidates: [] });
eq("phone, with a leading 1 and dashes", L.matchCard(card({ phone: "1-417-555-0101" }), idx).memberId, "A");
eq("email and phone agree", L.matchCard(card({ email: "jake@example.com", phone: "4175550101" }), idx).kind, "email");
eq("email and phone point at two members: pick", L.matchCard(card({ email: "jake@example.com", phone: "4175550199" }), idx), {
  status: "needs_pick",
  kind: "email",
  confidence: null,
  memberId: null,
  candidates: ["A", "F"],
});
eq("email beats the name on the card", L.matchCard({ ...fromName("SMITH/JOHN"), email: "pat@example.com" }, idx).memberId, "F");
eq("name, exact", L.matchCard(fromName("MILLER/JAKE"), idx), { status: "matched", kind: "name", confidence: "high", memberId: "A", candidates: [] });
eq("name with a middle initial the member didn't give", L.matchCard(fromName("MILLER/JAKE R"), idx).confidence, "high");
eq("name whose middle clashes: check it", L.matchCard(fromName("PUBLIC/SAM X"), idx).confidence, "medium");
eq("two members with the name: pick", L.matchCard(fromName("SMITH/JOHN"), idx), { status: "needs_pick", kind: "name", confidence: null, memberId: null, candidates: ["B", "C"] });
eq("an erased member never matches", L.matchCard(fromName("JONES/MARY"), idx).status, "unclaimed");
eq("Jacob on the card, Jake on the account: confirm, never automatic", L.matchCard(fromName("THOMPSON/JACOB"), idx), {
  status: "needs_pick",
  kind: "similar",
  confidence: null,
  memberId: null,
  candidates: ["H"],
});
eq("a stand-in name stays unclaimed", L.matchCard(fromName("CARDHOLDER/VISA"), idx).status, "unclaimed");
eq("nobody by that name: unclaimed", L.matchCard(fromName("NOBODY/ZED"), idx).status, "unclaimed");
eq(
  "a card that carried two people's names: pick",
  L.matchCard(card({ nameKeys: ["jake miller", "ann lake"], nameFulls: ["jake miller", "ann lake"] }), idx),
  { status: "needs_pick", kind: "name", confidence: null, memberId: null, candidates: ["A", "I"] },
);
eq(
  "two spellings that both lead to one member: matched, check it",
  L.matchCard(card({ nameKeys: ["jake miller", "jake millar"], nameFulls: ["jake miller", "jake millar"] }), idx).confidence,
  "medium",
);

// ---------- 4. one row per card ----------
const row = (o) => ({ statusId: "101", typeId: "20", firstSix: "411111", lastFour: "1111", holderName: "", amount: "10.00", subtotal: "0.00", createdTs: "09/20/2026 07:00:00 PM CDT", email: "", phone: "", brand: "visa", ...o });
const { cards, stats } = L.aggregateFortisRows([
  row({ amount: "20.00", holderName: "MILLER/JAKE" }),
  row({ amount: "15.50", subtotal: "15.50", createdTs: "09/20/2026 11:30:00 PM CDT", holderName: "CARDHOLDER/VISA" }),
  row({ amount: "4.50", createdTs: "09/21/2026 01:10:00 AM CDT", holderName: "MILLER/JAKE" }),
  row({ amount: "30.00", createdTs: "09/27/2026 08:00:00 PM CDT", holderName: "MILLER/JAKE R" }),
  row({ typeId: "30", statusId: "111", amount: "5.00", createdTs: "09/28/2026 08:00:00 PM CDT" }),
  row({ statusId: "201", amount: "0.00", subtotal: "12.00", createdTs: "09/29/2026 08:00:00 PM CDT" }),
  row({ statusId: "301", amount: "99.00" }),
  row({ firstSix: "522222", lastFour: "2222", typeId: "30", statusId: "111", amount: "7.00" }),
  row({ firstSix: "4111", lastFour: "1111" }),
]);
eq("rows by kind", stats, { rows: 9, sales: 4, refunds: 2, voided: 1, declined: 1, other: 0, noCard: 1, badDate: 0, salesDollars: 70, refundDollars: 12 });
eq("a refund with no sale on file is dropped", cards.length, 1);
const c1 = cards[0];
eq("sales less refunds", [c1.saleCount, c1.salesTotal, c1.refundCount, c1.refundsTotal], [4, 70, 1, 5]);
eq("visit days: 11:30 PM and 1:10 AM are the same night", c1.visitDates, ["2026-09-20", "2026-09-27"]);
eq("first and last purchase", [c1.firstAt, c1.lastAt], ["2026-09-21T00:00:00.000Z", "2026-09-28T01:00:00.000Z"]);
eq("the name it carried most, stand-ins ignored", [c1.holderName, c1.nameKeys], ["Jake Miller", ["jake miller"]]);
eq("every spelling kept for confidence", c1.nameFulls.sort(), ["jake miller", "jake r miller"]);

// ---------- 5. points ----------
const S = (o = {}) => ({ ...L.DEFAULT_GRANT_SETTINGS, ...o });
eq("default: 1 point per $1, before tax, no cap", L.DEFAULT_GRANT_SETTINGS, { rate: 1, cap: null, taxOut: true });
eq("tax in: $100 is 100", L.pointsForDollars(100, S({ taxOut: false })), 100);
eq("tax out: $108.73 is 100", L.pointsForDollars(108.73, S()), 100);
eq("tax out: $100 is 92", L.pointsForDollars(100, S()), 92);
eq("rate 2", L.pointsForDollars(50, S({ rate: 2, taxOut: false })), 100);
eq("$10.50 rounds to 11, not down on float error", L.pointsForDollars(10.5, S({ taxOut: false })), 11);
eq("refunds over sales give 0", L.pointsForDollars(-20, S()), 0);
eq("cap", L.cappedPoints(600, S({ cap: 500, taxOut: false })), 500);
eq("cap counts earlier grants", L.cappedPoints(600, S({ cap: 500, taxOut: false }), 450), 50);
eq("cap already reached", L.cappedPoints(600, S({ cap: 500, taxOut: false }), 600), 0);
eq("settings: rate 0 refused", L.validSettings(S({ rate: 0 })), false);
eq("settings: negative cap refused", L.validSettings(S({ cap: -1 })), false);
eq("settings: NaN refused", L.validSettings(S({ rate: Number("x") })), false);

const plan = L.planGrant(
  [
    { id: "c1", memberId: "A", dollars: 100 },
    { id: "c2", memberId: "A", dollars: 50.5 },
    { id: "c3", memberId: "A", dollars: -10 },
    { id: "c4", memberId: "B", dollars: 700 },
    { id: "c5", memberId: "C", dollars: 0.2 },
  ],
  S({ cap: 600, taxOut: false }),
  new Map([["B", 100]]),
);
eq("one entry per member, most points first", plan.map((p) => [p.memberId, p.dollars, p.points]), [
  ["B", 700, 500],
  ["A", 150.5, 151],
  ["C", 0.2, 0],
]);
eq("several cards add up; card shares add up to the member's points", plan[1].cards.reduce((s, c) => s + c.points, 0), 151);
eq("a card refunded below zero gives nothing", plan[1].cards.find((c) => c.id === "c3").points, 0);
eq("totals count members who get points", L.planTotals(plan), { members: 2, points: 651, dollars: 850.7 });
eq("note", L.BACKFILL_NOTE, "Points from card purchases before the new system");

// ---------- 6. re-matching ----------
const stored = (o) => ({ decision: "pending", matched_member_id: null, granted_at: null, erased_at: null, ...o });
eq("undecided: matched again", L.shouldRematch(stored({})), true);
eq("approved by a person: kept", L.shouldRematch(stored({ decision: "approved", matched_member_id: "A" })), false);
eq("skipped by a person: kept", L.shouldRematch(stored({ decision: "skipped" })), false);
eq("approved, but the member is gone: matched again", L.shouldRematch(stored({ decision: "approved", matched_member_id: null })), true);
eq("granted: never", L.shouldRematch(stored({ granted_at: "2026-10-01T00:00:00Z" })), false);
eq("member's info removed: never", L.shouldRematch(stored({ erased_at: "2026-10-01T00:00:00Z" })), false);
const m = L.matchCard(fromName("MILLER/JAKE"), idx);
const cols = L.matchColumns(m, "2026-10-01T00:00:00.000Z");
eq("a fresh match is undecided", [cols.decision, cols.decided_by, cols.matched_member_id, cols.matched_at], ["pending", null, "A", "2026-10-01T00:00:00.000Z"]);
check("same match is recognized", L.sameMatch({ ...cols, candidate_member_ids: [] }, m));
check("an approved card isn't 'the same' undecided match", !L.sameMatch({ ...cols, decision: "approved" }, m));

// ---------- 7. weekly runs ----------
// Mondays: 2026-08-03, 08-10, 08-17, 08-24, 08-31, 09-07, 09-14, 09-21.
const open = new Set(["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"]);
const visits = ["2026-08-04", "2026-08-06", "2026-08-12", "2026-08-21", "2026-09-01", "2026-09-09"];
eq("missed open week breaks a run", R.regularity(visits, open, "2026-09-10"), { days: 6, longestRun: 3, currentRun: 2, first: "2026-08-04", last: "2026-09-09" });
const closed = new Set([...open].filter((w) => w !== "2026-08-24"));
eq("a closed week doesn't", R.regularity(visits, closed, "2026-09-10").longestRun, 5);
eq("this week isn't over yet", R.regularity(visits, closed, "2026-09-16").currentRun, 5);
eq("a missed week that's over ends the current run", R.regularity(visits, closed, "2026-09-22").currentRun, 0);
eq("visits after asOf don't count", R.regularity(visits, open, "2026-08-10").days, 2);
eq("no visits", R.regularity([], open, "2026-09-10"), { days: 0, longestRun: 0, currentRun: 0, first: null, last: null });
const rows = [
  { days: 10, longestRun: 2, currentRun: 0, last: "2026-09-01" },
  { days: 8, longestRun: 6, currentRun: 6, last: "2026-09-02" },
  { days: 10, longestRun: 3, currentRun: 1, last: "2026-08-01" },
];
eq("sort by days, then longest run", [...rows].sort(R.compareRegulars("days")).map((r) => r.longestRun), [3, 2, 6]);
eq("sort by longest run", [...rows].sort(R.compareRegulars("longest")).map((r) => r.longestRun), [6, 3, 2]);

// ---------- 8. Rewind ----------
eq('"$8" is $8.00', LK.parseAmountCents("$8"), 800);
eq('"8.00" is $8.00', LK.parseAmountCents("8.00"), 800);
eq('"8" is $8.00', LK.parseAmountCents("8"), 800);
eq('"8.5" is $8.50', LK.parseAmountCents("8.5"), 850);
eq('".50" and "$ 23.45"', [LK.parseAmountCents(".50"), LK.parseAmountCents("$ 23.45")], [50, 2345]);
eq('"1,234.56" with a thousands comma', LK.parseAmountCents("1,234.56"), 123456);
eq(
  'refused: "8,00", "-8", "8.123", "0", "abc", "", "$", "1.2.3", "$10,001"',
  ["8,00", "-8", "8.123", "0", "abc", "", "$", "1.2.3", "$10,001"].map(LK.parseAmountCents),
  [null, null, null, null, null, null, null, null, null],
);
let centsOk = true;
for (let c = 1; c <= 1_000_000; c += 97) if (LK.parseAmountCents((c / 100).toFixed(2)) !== c) centsOk = false;
check("every dollars-and-cents amount reads to its exact cent (no float drift)", centsOk && LK.parseAmountCents("19.99") === 1999 && LK.parseAmountCents("0.29") === 29);

eq("exact days: the day entered", LK.purchaseWindow("2026-03-10", false), { from: "2026-03-10", to: "2026-03-10" });
eq("posting dates: that day or up to 2 days before", LK.purchaseWindow("2026-03-10", true), { from: "2026-03-08", to: "2026-03-10" });
eq("posting window across a month end", LK.purchaseWindow("2026-03-01", true).from, "2026-02-27");
eq("asks the database for the business day before too", LK.businessDateRange("2026-03-10", false), { from: "2026-03-09", to: "2026-03-10" });
eq("Central calendar date", [LK.centralDate("2026-03-10T06:30:00Z"), LK.centralDate("2026-03-10T04:30:00Z")], ["2026-03-10", "2026-03-09"]);

// Cards (first six + last four). A and B end in 0001, C in 2222, D in 0001.
const [A, B, C, D] = ["4111110001", "5222220001", "4111112222", "6011110001"];
const sale = (id, card, businessDate, cents, createdAt, kind = "sale") => ({ id, cardKey: card, businessDate, amountCents: cents, createdAt, kind });
const sales = [
  sale("s1", A, "2026-03-10", 1250, "2026-03-11T00:00:00Z"), // 7 PM
  sale("s2", B, "2026-03-10", 1250, "2026-03-11T01:00:00Z"), // same night, same amount, another card
  sale("s3", A, "2026-03-14", 2000, "2026-03-15T02:00:00Z"),
  sale("s4", B, "2026-03-20", 2000, "2026-03-21T02:00:00Z"),
  sale("s5", C, "2026-03-10", 1250, "2026-03-11T02:00:00Z"),
  sale("s6", D, "2026-03-09", 1250, "2026-03-10T06:30:00Z"), // 1:30 AM on the 10th: business day the 9th
  sale("r1", A, "2026-03-16", 900, "2026-03-17T01:00:00Z", "refund"),
];
const find = (purchases, o = {}) => LK.matchCards(o.sales ?? sales, { lastFour: o.lastFour ?? null, purchases, postingDates: !!o.posting });
eq("day + amount alone: every card with that sale", find([{ date: "2026-03-10", cents: 1250 }]), [A, C, B, D].sort());
eq("the last 4 narrows it", find([{ date: "2026-03-10", cents: 1250 }], { lastFour: "2222" }), [C]);
eq("the last 4 can still leave two", find([{ date: "2026-03-10", cents: 1250 }], { lastFour: "0001" }), [A, B, D].sort());
eq("two purchases: only the card with both", find([{ date: "2026-03-10", cents: 1250 }, { date: "2026-03-14", cents: 2000 }]), [A]);
eq("two purchases, one not on any card: nothing", find([{ date: "2026-03-10", cents: 1250 }, { date: "2026-03-15", cents: 2000 }]), []);
eq("to the cent: $12.05 isn't $12.50", find([{ date: "2026-03-10", cents: 1205 }]), []);
eq("bank shows a later posting date: no match on exact days", find([{ date: "2026-03-16", cents: 2000 }]), []);
eq("... found with posting dates on", find([{ date: "2026-03-16", cents: 2000 }], { posting: true }), [A]);
eq("posting dates only reach back, never forward", find([{ date: "2026-03-13", cents: 2000 }], { posting: true }), []);
eq("3 days later is too far", find([{ date: "2026-03-17", cents: 2000 }], { posting: true }), []);
eq("after midnight: the bank's calendar date finds it", find([{ date: "2026-03-10", cents: 1250 }], { lastFour: "0001" }).includes(D), true);
eq("after midnight: so does the business date", find([{ date: "2026-03-09", cents: 1250 }]), [D]);
eq("a refund isn't a purchase", find([{ date: "2026-03-16", cents: 900 }]), []);
eq("a card with a refund still matches its sales", find([{ date: "2026-03-14", cents: 2000 }], { lastFour: "0001" }), [A]);
eq("the same purchase twice needs two sales", find([{ date: "2026-03-10", cents: 1250 }, { date: "2026-03-10", cents: 1250 }]), []);
eq(
  "... and finds the card that has two",
  find([{ date: "2026-03-10", cents: 1250 }, { date: "2026-03-10", cents: 1250 }], { sales: [...sales, sale("s7", A, "2026-03-10", 1250, "2026-03-11T03:00:00Z")] }),
  [A],
);
eq("a sale fetched twice counts once", find([{ date: "2026-03-14", cents: 2000 }], { sales: [...sales, sales[2]] }), [A]);
eq("each purchase a different sale", [LK.distinctSales([["x"], ["x"]]), LK.distinctSales([["x", "y"], ["x"]]), LK.distinctSales([["x"], []])], [false, true, false]);
eq("verdict", [LK.verdictFor(0), LK.verdictFor(1), LK.verdictFor(2)], ["none", "found", "several"]);

const form = (o) => LK.readLookup({ lastFour: "", purchases: [{ date: "2026-03-10", amount: "8" }], postingDates: false, ...o });
eq("form: blank rows are skipped, amounts read exactly", form({ purchases: [{ date: "", amount: "" }, { date: "2026-03-10", amount: "$8" }] }), {
  ok: true,
  input: { lastFour: null, purchases: [{ date: "2026-03-10", cents: 800 }], postingDates: false },
});
check("form: a row with only a date is refused", !form({ purchases: [{ date: "2026-03-10", amount: "" }] }).ok);
check("form: the last 4 must be 4 digits", !form({ lastFour: "123" }).ok && !form({ lastFour: "12a4" }).ok && form({ lastFour: " 1234 " }).ok);
check("form: no purchase at all is refused", !form({ purchases: [] }).ok);
check("form: up to 3 purchases", !form({ purchases: Array(4).fill({ date: "2026-03-10", amount: "8" }) }).ok && form({ purchases: Array(3).fill({ date: "2026-03-10", amount: "8" }) }).ok);
check("form: a date that doesn't exist is refused", !form({ purchases: [{ date: "2026-02-30", amount: "8" }] }).ok);

const st = (o) => LK.lookupStatus({ granted_at: null, erased_at: null, decision: "pending", match_status: "unclaimed", matched_member_id: null, ...o });
eq("status", [st({}), st({ match_status: "needs_pick" }), st({ match_status: "matched", matched_member_id: "M" }), st({ decision: "skipped" }), st({ granted_at: "x" }), st({ erased_at: "x" })], [
  "unclaimed",
  "needs_pick",
  "matched",
  "skipped",
  "granted",
  "removed",
]);
eq("manager: an unclaimed or name-matched card is open", [LK.assignRule("unclaimed", false, false), LK.assignRule("matched", false, false)], ["open", "open"]);
eq("manager: approved for someone: only them; skipped: no", [LK.assignRule("matched", true, false), LK.assignRule("skipped", false, false)], ["same_member", "no"]);
eq("admin: open, but never a granted or removed card", [LK.assignRule("skipped", false, true), LK.assignRule("granted", true, true), LK.assignRule("removed", false, true)], ["open", "no", "no"]);
check("same_member lets only that member through", LK.mayAssignTo("same_member", "M", "M") && !LK.mayAssignTo("same_member", "M", "N") && LK.mayAssignTo("open", "M", "N"));
eq("history note, one card", LK.lookupGrantNote(["1234"]), "Points from card purchases before the new system (card ending 1234)");
eq("history note, two cards", LK.lookupGrantNote(["5678", "1234"]), "Points from card purchases before the new system (cards ending 1234 and 5678)");
eq("since", [LK.monthYear("2023-03-05"), LK.monthYear(null)], ["March 2023", ""]);
eq("settings label", [LK.settingsLabel(S()), LK.settingsLabel(S({ rate: 2, cap: 500, taxOut: false }))], ["1 point per $1 before tax", "2 points per $1, up to 500 per member"]);
eq(
  "a second card for the same member is paid in full (no cap)",
  L.planGrant([{ id: "c9", memberId: "A", dollars: 108.73 }], S(), new Map([["A", 300]]))[0].points,
  100,
);

const frow = (o) => ({ id: "t1", statusId: "101", typeId: "20", firstSix: "411111", lastFour: "0001", holderName: "", amount: "12.50", subtotal: "", createdTs: "03/10/2026 07:00:00 PM CDT", email: "", phone: "", brand: "visa", ...o });
const fs1 = LK.fortisSaleRows([
  frow({}),
  frow({ id: "t2", statusId: "111", typeId: "30", amount: "4.00" }),
  frow({ id: "t3", statusId: "201", amount: "0.00" }),
  frow({ id: "t1" }),
  frow({ id: "t4", firstSix: "" }),
  frow({ id: "t5", createdTs: "garbage" }),
]);
eq("loader rows: sales and refunds, as charged, to the cent", fs1.sales.map((s) => [s.fortisId, s.kind, s.amountCents, s.businessDate, s.cardKey]), [
  ["t1", "sale", 1250, "2026-03-10", "4111110001"],
  ["t2", "refund", 400, "2026-03-10", "4111110001"],
]);
eq("loader rows: a voided sale comes out; repeats, no card or no date are left out", [fs1.gone, fs1.skipped], [["t3"], 3]);

console.log(failures ? `\n${failures} FAILED` : "\nAll passed.");
process.exit(failures ? 1 : 0);

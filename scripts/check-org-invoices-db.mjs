// Organization invoices and the Community impact tab against the live
// database (lib/org-invoices.ts, lib/data/org-invoices.ts, lib/data/impact.ts,
// supabase/migrations/20261007010000_org_invoices_impact.sql): makes a
// throwaway organization (made-up names, 555 numbers, an example.com
// contact), logs comps the way a sale does (named and with no account), adds
// four discounted events (worth $400, charged $50), checks the invoice
// totals, the fee switch, the payment status, the card-link webhook, the
// emailed invoice (through a fake Resend: nothing is sent), a one-off
// community activity and the impact totals and CSV, then deletes everything
// it made. Stripe is off (no key), so no Stripe objects are made.
//
// Usage: node scripts/check-org-invoices-db.mjs [preview.html]
//   With a path, also writes a preview of the invoice email with example
//   data (Arc of the Ozarks, four events worth $400 charged $50).
import { registerHooks } from "node:module";
import { randomInt, randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
delete process.env.STRIPE_SECRET_KEY;
// A made-up key, in this process only: the fake Resend below answers.
process.env.RESEND_API_KEY = "test-only-not-a-real-key";
if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.");
  process.exit(1);
}

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) {
    sent.push(JSON.parse(init.body));
    return Response.json({ id: `fake-${sent.length}` });
  }
  if (/stripe\.com/.test(String(url))) throw new Error("no Stripe in this check");
  return realFetch(url, init);
};

const stubs = `
  export const who = { id: null };
  export async function assertStaff() { return { employeeId: who.id, name: "Check admin", role: "owner", email: null }; }
  export async function assertAdmin() { return { employeeId: who.id, name: "Check admin", role: "owner", email: null }; }
  export async function requireAdmin() { return { employeeId: who.id, name: "Check admin", role: "owner", email: null }; }
  export const hasAdminAccess = () => true;
  export const hasManagerAccess = () => true;
  export function after() {}
  export function revalidatePath() {}
  export async function headers() { return new Headers(); }
  export async function cookies() { return { get() {}, getAll() { return []; }, set() {} }; }
  export function redirect() { throw new Error("redirect"); }
  export function notFound() { throw new Error("not found"); }
  export const NextResponse = { json: (body, init) => Response.json(body, init) };
`;
const STUB_URL = "data:text/javascript," + encodeURIComponent(stubs);
const STUBBED = { "server-only": "data:text/javascript,", "@/lib/auth": STUB_URL, "next/server": STUB_URL, "next/cache": STUB_URL, "next/headers": STUB_URL, "next/navigation": STUB_URL };
const src = fileURLToPath(new URL("../src/", import.meta.url));
const withExt = (base) => [".ts", ".tsx", "/index.ts"].map((e) => base + e).find((p) => existsSync(p));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBBED[specifier]) return { url: STUBBED[specifier], shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const file = withExt(path.join(src, specifier.slice(2)));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !path.extname(specifier)) {
      const file = withExt(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { who } = await import(STUB_URL);
const L = await import("../src/lib/org-invoices.ts");
const E = await import("../src/lib/email/org-invoice-email.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const near = (a, b) => Math.abs(a - b) < 0.005;
const noBareRoyale = (s) => !/\bthe Royale\b(?! Cinema Project)/i.test(s);

// The preview (example data), and the email checks that need no database.
{
  const lines = ["03", "10", "17", "24"].map((d, i) =>
    L.docLine({ date: `2026-10-${d}`, label: `Event: ${["Sensory-friendly matinee", "Movie night", "Private screening", "Holiday movie party"][i]}`, detail: "18 people", fullValue: 400, charged: 50 }),
  );
  const doc = {
    orgName: "Arc of the Ozarks",
    contactName: null,
    month: "2026-10",
    number: "RCL-202610-A7C3",
    status: "unpaid",
    paidMethod: null,
    paidAt: null,
    lines,
    totals: L.docTotals(lines, "unpaid"),
    payUrl: "https://buy.stripe.com/test_example",
    ein: "99-4086131",
  };
  check("example totals: worth $1,600, pay $200, covered $1,400", doc.totals.fullValue === 1600 && doc.totals.charged === 200 && doc.totals.covered === 1400 && doc.totals.due === 200);
  const html = E.orgInvoiceHtml(doc);
  const text = E.orgInvoiceText(doc);
  check("subject", E.orgInvoiceSubject(doc) === "Arc of the Ozarks: your October 2026 invoice from Royale Cinema", E.orgInvoiceSubject(doc));
  check("covered line on each event", (html.match(/Covered by the Royale Cinema Project: \$350\.00/g) ?? []).length === 4);
  check("tagline on the covered line", html.includes("Encouraging Community. Enjoying Cinema."));
  check("pay-by-card button for $200", html.includes("Pay $200.00 by card</a>") && html.includes('href="https://buy.stripe.com/test_example"'));
  check("legal name and EIN in the footer", html.includes("Royale Cinema Project Co · 501(c)(3) · EIN 99-4086131"));
  check("signed The RCL crew", html.includes("The RCL crew") && text.includes("The RCL crew"));
  check('never "the Royale" on its own', noBareRoyale(html) && noBareRoyale(text));
  check("escapes the org name", E.orgInvoiceHtml({ ...doc, orgName: "A <b> & Co" }).includes("A &lt;b&gt; &amp; Co"));
  const paid = { ...doc, status: "paid", paidMethod: "check", paidAt: "2026-10-30T18:00:00Z", totals: L.docTotals(lines, "paid") };
  check("paid: a receipt, no button", E.orgInvoiceSubject(paid).includes("receipt") && !E.orgInvoiceHtml(paid).includes("by card</a>") && E.orgInvoiceHtml(paid).includes("Paid by check"));
  const out = process.argv[2];
  if (out) {
    writeFileSync(out, html);
    console.log(`wrote ${out}`);
  }
}

const { createAdminClient } = await import("../src/lib/supabase/admin.ts");
const orgActions = await import("../src/app/admin/organizations/actions.ts");
const inv = await import("../src/app/admin/organizations/invoice-actions.ts");
const impactActions = await import("../src/app/admin/impact/actions.ts");
const { getOrgInvoice } = await import("../src/lib/data/org-invoices.ts");
const { invoicePaidFromCheckout } = await import("../src/lib/org-invoice-server.ts");
const { getImpact, impactCsv } = await import("../src/lib/data/impact.ts");
const { businessDay } = await import("../src/lib/ops/time.ts");

const db = createAdminClient();
const tag = Array.from({ length: 8 }, () => String.fromCharCode(97 + randomInt(26))).join("");
const name = `Invcheck ${tag}`;
const memberIds = [];
const activityIds = [];
let orgId = null;
const phone = () => `(555) ${randomInt(200, 999)}-${randomInt(1000, 9999)}`;
const today = businessDay().date;
// Last month (its whole month is in the past), unless it's January: then
// this month, so the year-to-date numbers include it.
const month = today.slice(5, 7) === "01" ? today.slice(0, 7) : L.shiftMonth(today.slice(0, 7), -1);
const d = (day) => `${month}-${day}`;

try {
  const { data: staff } = await db.from("employees").select("id").limit(1).maybeSingle();
  who.id = staff?.id ?? randomUUID();
  const year = Number(month.slice(0, 4));
  const before = await getImpact(year, today);

  console.log("-- the organization, its people and comps");
  const made = await orgActions.createOrganization({
    name,
    contactName: "",
    contactEmail: `invcheck-${tag}@example.com`,
    monthlyFee: 100,
    dailyCompLimit: 20,
    status: "active",
    notes: "",
    impactCategory: "disabilities",
  });
  orgId = made.ok ? made.id : null;
  check("made the organization", made.ok, JSON.stringify(made));
  if (!orgId) throw new Error("no organization");
  for (const n of ["Helper", "Guest"]) {
    const { data } = await db
      .from("members")
      .insert({ name: `Invcheck ${n} ${tag}`, phone: phone(), email: null, email_opt_in: false, points: 0, tier: "Insiders" })
      .select("id")
      .single();
    if (data) memberIds.push(data.id);
  }
  const [helperId, guestId] = memberIds;
  check("helper and supported guest attached", (await orgActions.setPerson(orgId, helperId, "helper")).ok && (await orgActions.setPerson(orgId, guestId, "supported")).ok);
  const group = randomUUID();
  const comp = (o) => ({ organization_id: orgId, business_date: d("10"), screening_id: null, order_id: null, over_limit: false, anonymous: false, role: null, group_id: null, note: null, ...o });
  const { error: compErr } = await db.from("org_comps").insert([
    comp({ member_id: helperId, kind: "day_pass", amount: 8 }),
    comp({ member_id: helperId, kind: "movie", screening_id: randomUUID(), amount: 5 }),
    comp({ member_id: guestId, kind: "day_pass", amount: 8 }),
    comp({ member_id: guestId, kind: "movie", screening_id: randomUUID(), amount: 5 }),
    comp({ member_id: null, anonymous: true, role: "supported", group_id: group, kind: "day_pass", amount: 8, business_date: d("12") }),
    comp({ member_id: null, anonymous: true, role: "supported", group_id: group, kind: "day_pass", amount: 8, business_date: d("12") }),
    comp({ member_id: null, anonymous: true, group_id: group, kind: "movie", screening_id: randomUUID(), amount: 5, business_date: d("12") }),
    comp({ member_id: null, anonymous: true, group_id: group, kind: "movie", screening_id: randomUUID(), amount: 5, business_date: d("12") }),
  ]);
  check("eight comps logged ($52)", !compErr, compErr?.message);

  console.log("-- invoice lines");
  const line = (day, o = {}) => ({ date: d(day), kind: "event", description: `Check event ${day}`, fullValue: "$400", charged: "50", people: "10", ...o });
  for (const day of ["03", "10", "17", "24"]) {
    const r = await inv.addInvoiceLine(orgId, line(day));
    check(`event on the ${day}th added`, r.ok, JSON.stringify(r));
  }
  check("charged more than the value is refused", !(await inv.addInvoiceLine(orgId, line("05", { charged: "500" }))).ok);
  check("a bad amount is refused", !(await inv.addInvoiceLine(orgId, line("05", { fullValue: "lots" }))).ok);
  check("no description is refused", !(await inv.addInvoiceLine(orgId, line("05", { description: " " }))).ok);

  console.log("-- the invoice");
  let i = await getOrgInvoice(orgId, month);
  const t = i.doc.totals;
  check("4 events + comps + fee = 6 lines", i.doc.lines.length === 6, String(i.doc.lines.length));
  check("comps line: 4 visits, 4 movies, $52 covered", i.comps.visits === 4 && i.comps.movies === 4 && near(i.comps.value, 52), JSON.stringify(i.comps));
  check("fee on by default (invoiced by hand)", i.includeFee);
  check("totals: worth $1,752, charged $300, covered $1,452, due $300", near(t.fullValue, 1752) && near(t.charged, 300) && near(t.covered, 1452) && near(t.due, 300), JSON.stringify(t));
  check("fee off", (await inv.includeMonthlyFee(orgId, month, false)).ok);
  i = await getOrgInvoice(orgId, month);
  check("without the fee: charged $200, covered $1,452, due $200", near(i.doc.totals.charged, 200) && near(i.doc.totals.covered, 1452) && near(i.doc.totals.due, 200), JSON.stringify(i.doc.totals));
  const link = await inv.payByCardLink(orgId, month);
  check("no Stripe key: no pay link, a plain error", !link.ok && /Stripe/.test(link.error), JSON.stringify(link));

  console.log("-- emailing it (fake Resend)");
  const e1 = await inv.emailInvoice(orgId, month, "");
  check("sent to the contact email", e1.ok && e1.to === `invcheck-${tag}@example.com`, JSON.stringify(e1));
  const mail = sent.at(-1);
  check("one email, an invoice with the covered amount", sent.length === 1 && mail.subject.includes("invoice") && mail.html.includes("$1,452.00") && mail.tags.some((x) => x.value === "org_invoice"));
  check('never "the Royale" on its own', noBareRoyale(mail.html) && noBareRoyale(mail.text));
  check("a bad address is refused", !(await inv.emailInvoice(orgId, month, "not-an-email")).ok);
  i = await getOrgInvoice(orgId, month);
  check("logged: who, to whom, due $200, covered $1,452", i.sends.length === 1 && i.sends[0].sentByName === "Check admin" && near(i.sends[0].amountDue, 200) && near(i.sends[0].covered, 1452) && i.sends[0].kind === "invoice");

  console.log("-- payment status");
  check("paid needs a method", !(await inv.markInvoice(orgId, month, "paid", null)).ok);
  check("paid by check", (await inv.markInvoice(orgId, month, "paid", "check")).ok);
  i = await getOrgInvoice(orgId, month);
  check("now a receipt: nothing due, paid by check, who changed it", i.doc.status === "paid" && i.doc.paidMethod === "check" && i.doc.totals.due === 0 && i.invoice.status_by_name === "Check admin" && L.isReceipt(i.doc));
  await inv.emailInvoice(orgId, month, `invcheck-${tag}@example.com`);
  check("the email is a receipt now", sent.at(-1).subject.includes("receipt") && sent.at(-1).html.includes("Paid by check"));
  check("waived", (await inv.markInvoice(orgId, month, "waived", null)).ok && (await getOrgInvoice(orgId, month)).doc.status === "waived");
  check("back to unpaid", (await inv.markInvoice(orgId, month, "unpaid", null)).ok);
  // The card link's webhook: a fake link id on the invoice, then its checkout.
  const fakeLink = `plink_check_${tag}`;
  await db.from("org_invoices").update({ pay_link_id: fakeLink, pay_link_url: "https://buy.stripe.com/test_check", pay_link_amount: 200 }).eq("organization_id", orgId).eq("month", month);
  i = await getOrgInvoice(orgId, month);
  check("the link is current for $200 and goes in the email", i.payLinkCurrent && i.doc.payUrl === "https://buy.stripe.com/test_check");
  check("webhook: unpaid session ignored", (await invoicePaidFromCheckout({ payment_link: fakeLink, payment_status: "unpaid" })) && (await getOrgInvoice(orgId, month)).doc.status === "unpaid");
  check("webhook: paid", await invoicePaidFromCheckout({ payment_link: fakeLink, payment_status: "paid" }));
  i = await getOrgInvoice(orgId, month);
  check("paid by card through the link", i.doc.status === "paid" && i.doc.paidMethod === "card");

  console.log("-- Community impact");
  const act = await impactActions.addActivity({ date: d("20"), orgId: "", category: "seniors", description: `Invcheck free screening for assisted living residents ${tag}`, people: "22", value: "176" });
  check("logged a one-off activity", act.ok, JSON.stringify(act));
  const { data: acts } = await db.from("community_activities").select("id").like("description", `%${tag}`);
  activityIds.push(...(acts ?? []).map((a) => a.id));
  check("a bad category is refused", !(await impactActions.addActivity({ date: d("20"), orgId: "", category: "aliens", description: "x", people: "1", value: "1" })).ok);
  check("a bad EIN is refused", !(await impactActions.saveEin("12345")).ok);
  const after = await getImpact(year, today);
  const mine = after.byOrg.find((o) => o.key === orgId)?.cells;
  check(
    "the organization: 3 supported, 1 helper, 40 at events, 44 served",
    mine && mine.supported === 3 && mine.helpers === 1 && mine.eventPeople === 40 && mine.peopleServed === 44,
    JSON.stringify(mine && { s: mine.supported, h: mine.helpers, e: mine.eventPeople, p: mine.peopleServed }),
  );
  check(
    "4 visits (2 with no account), 4 movies, 8 comps worth $52",
    mine && mine.visits === 4 && mine.noAccountVisits === 2 && mine.movies === 4 && mine.comps === 8 && near(mine.compValue, 52),
  );
  check("4 discounted events: $1,600 worth, $200 charged, $1,400 covered; $1,452 covered in all", mine && mine.events === 4 && near(mine.eventValue, 1600) && near(mine.eventCharged, 200) && near(mine.eventCovered, 1400) && near(mine.covered, 1452));
  const mon = (r) => r.byMonth.find((m) => m.month === month).cells;
  check("the month went up by 66 people and $1,628 covered", mon(after).peopleServed - mon(before).peopleServed === 66 && near(mon(after).covered - mon(before).covered, 1628), `${mon(after).peopleServed - mon(before).peopleServed}, ${mon(after).covered - mon(before).covered}`);
  check("year to date went up by $1,628 covered", near(after.ytd.covered - before.ytd.covered, 1628));
  check("the activity is listed, under Seniors", after.activities.some((a) => activityIds.includes(a.id) && a.category === "seniors") && after.byCategory.some((c) => c.category === "seniors" && c.cells.activityPeople >= 22));
  const csv = impactCsv(after);
  check("CSV: header, a row for the organization's month, totals", csv[0][0] === "Month" && csv.some((r) => r[0] === month && r[1] === name && r.at(-1) === "1452.00") && csv.at(-1)[1] === "All");
} catch (e) {
  failures++;
  console.error("FAIL  threw:", e instanceof Error ? e.message : e);
} finally {
  if (activityIds.length) await db.from("community_activities").delete().in("id", activityIds);
  if (orgId) {
    await db.from("org_comps").delete().eq("organization_id", orgId);
    await db.from("org_invoice_sends").delete().eq("organization_id", orgId);
    await db.from("org_invoice_lines").delete().eq("organization_id", orgId);
    await db.from("org_invoices").delete().eq("organization_id", orgId);
    await db.from("organizations").delete().eq("id", orgId);
  }
  if (memberIds.length) await db.from("members").delete().in("id", memberIds);
  const { count } = await db.from("organizations").select("id", { count: "exact", head: true }).eq("name", name);
  const { count: left } = await db.from("community_activities").select("id", { count: "exact", head: true }).like("description", `%${tag}`);
  check("cleaned up", !count && !left);
}

console.log(failures ? `\n${failures} failed` : "\nAll passed");
process.exit(failures ? 1 : 0);

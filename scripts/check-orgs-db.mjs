// Organization accounts against the live database (lib/orgs.ts,
// supabase/migrations/20261005040000_organizations.sql): makes a throwaway
// organization from a "Group / organization" label, a helper and a
// supported guest (made-up names, 555 numbers), checks the register's chip
// numbers, logs comps the way a sale does, checks the daily limit (and the
// register's check before payment), the invite link and the monthly
// statement, then deletes everything it made. Never prints anyone's
// details. No orders are made and nothing touches Stripe.
//
// Usage: node scripts/check-orgs-db.mjs   (Node 23.6+ runs the .ts directly)
import { registerHooks } from "node:module";
import { randomInt, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
delete process.env.RESEND_API_KEY;
delete process.env.STRIPE_SECRET_KEY;
if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.");
  process.exit(1);
}

const stubs = `
  export const who = { id: null };
  export async function assertStaff() { return { employeeId: who.id, name: "Check staff", role: "owner", email: null }; }
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
const { createAdminClient } = await import("../src/lib/supabase/admin.ts");
const orgs = await import("../src/lib/orgs-server.ts");
const admin = await import("../src/app/admin/organizations/actions.ts");
const register = await import("../src/app/pos/org-actions.ts");
const { checkBeforePayment } = await import("../src/app/pos/actions.ts");
const { getOrganization, getOrgStatement, labelsWithoutOrg, compsByOrg } = await import("../src/lib/data/organizations.ts");
const { readInvite } = await import("../src/app/(site)/account/join/invite.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = createAdminClient();
const tag = Array.from({ length: 8 }, () => String.fromCharCode(97 + randomInt(26))).join("");
const label = `Orgcheck ${tag}`;
const memberIds = [];
let orgId = null;
const phone = () => `(555) ${randomInt(200, 999)}-${randomInt(1000, 9999)}`;

try {
  const { data: staff } = await db.from("employees").select("id").limit(1).maybeSingle();
  who.id = staff?.id ?? randomUUID();

  // Two people tagged at the register, like Andrew's three.
  for (const n of ["Helper", "Guest"]) {
    const { data } = await db
      .from("members")
      .insert({ name: `Orgcheck ${n} ${tag}`, phone: phone(), email: null, email_opt_in: false, points: 0, tier: "Insiders", organization: label })
      .select("id")
      .single();
    if (data) memberIds.push(data.id);
  }
  const [helperId, guestId] = memberIds;
  check("two throwaway members tagged with the label", memberIds.length === 2);
  check("the label is waiting to become an organization", (await labelsWithoutOrg()).some((l) => l.label === label && l.people === 2 && !l.exists));

  console.log("-- Back office: label → organization, roles");
  const made = await admin.organizationFromLabel(label);
  orgId = made.ok ? made.id : null;
  check("made the organization and attached both", made.ok && made.attached === 2, JSON.stringify(made));
  const { data: row } = await db.from("organizations").select("daily_comp_limit, monthly_fee, status, invite_code").eq("id", orgId).single();
  check("defaults: 20 comps a day, $100 a month, active", row.daily_comp_limit === 20 && Number(row.monthly_fee) === 100 && row.status === "active");
  check("a helper role", (await admin.setPerson(orgId, helperId, "helper")).ok);
  const detail = await getOrganization(orgId);
  check("the page lists one helper and one supported guest", detail.people.filter((p) => p.role === "helper").length === 1 && detail.people.filter((p) => p.role === "supported").length === 1);
  check("the label isn't waiting any more", !(await labelsWithoutOrg()).some((l) => l.label === label));
  const lim = await admin.updateOrganization(orgId, { name: label, contactName: "", contactEmail: "", monthlyFee: 100, dailyCompLimit: 2, status: "active", notes: "" });
  check("the limit set to 2 for the test", lim.ok);

  console.log("-- the register: chip, comps, the limit");
  const chip = await register.getOrgOnOrder(guestId);
  check("the guest's chip: supported, 0/2", chip?.orgName === label && chip.role === "supported" && chip.used === 0 && chip.limit === 2 && !chip.personCompedToday);
  const dayPass = [...(await orgs.dayPassItemIds())][0];
  check("the Day pass menu item is found", !!dayPass);
  const { data: show } = await db.from("screenings").select("id").limit(1).maybeSingle();
  const lines = [
    { menu_item_id: dayPass, screening_id: null, unit_price: 5, quantity: 1, name: "Day pass", modifiers: [], is_alcohol: false },
    ...(show ? [{ menu_item_id: null, screening_id: show.id, unit_price: 8, quantity: 1, name: "Ticket", modifiers: [], is_alcohol: false }] : []),
  ];
  const terms = await orgs.orgSaleTerms(guestId, lines, false);
  check("the guest's day pass (and ticket) are comped, tax included", terms.plan.amount === (show ? 13 : 5) && terms.taxIncluded && terms.plan.newComp);
  const helperTerms = await orgs.orgSaleTerms(helperId, lines, false);
  check("the helper's are comped, tax on top", helperTerms.plan.amount > 0 && !helperTerms.taxIncluded);
  await orgs.logOrderComps({ orderId: null, memberId: guestId, terms, lines, overLimitBy: null });
  await orgs.logOrderComps({ orderId: null, memberId: helperId, terms: helperTerms, lines, overLimitBy: null });
  const after = await register.getOrgOnOrder(guestId);
  check("after both: 2/2 used, the guest already comped today", after.used === 2 && after.personCompedToday && after.dayPassToday);
  const again = await orgs.orgSaleTerms(guestId, lines, false);
  check("the guest again today: nothing more comped, not blocked", again.plan.amount === 0 && !again.plan.blocked);

  // A third person: the limit is used up.
  const { data: third } = await db.from("members").insert({ name: `Orgcheck Third ${tag}`, phone: phone(), email: null, email_opt_in: false, points: 0, tier: "Insiders" }).select("id").single();
  memberIds.push(third.id);
  check("a third person added from the register", (await register.setMemberOrg(third.id, orgId, "supported")).ok);
  const full = await orgs.orgSaleTerms(third.id, lines, false);
  check("the third is blocked: 2 of 2 used", full.plan.blocked && full.plan.amount === 0);
  const fields = { employeeId: who.id, memberId: third.id, orderName: "", taxFree: false, monthlyMember: false, pointsRedeemed: false, lines };
  const totals = { subtotal: 13, tier_discount: 0, monthly_discount: 0, redemption_discount: 0, tax: 0, total: 0, org_comp_discount: 13, tax_included: true };
  const refused = await checkBeforePayment(fields, totals, null);
  check("the register's check before payment refuses the comp", !refused.ok && refused.orgFull === true, refused.ok ? "" : refused.error);
  const token = orgs.sealOverLimit(orgId, who.id, null);
  const allowed = await checkBeforePayment(fields, totals, token);
  check("a manager's OK lets it through", allowed.ok, allowed.ok ? "" : allowed.error);
  const over = await orgs.orgSaleTerms(third.id, lines, true);
  await orgs.logOrderComps({ orderId: null, memberId: third.id, terms: over, lines, overLimitBy: staff?.id ?? null });
  check("comped past the limit is marked", (await register.getOrgOnOrder(third.id)).used === 3);

  console.log("-- statement, report, invite link");
  const month = orgs.orgDay().slice(0, 7);
  const st = await getOrgStatement(orgId, month);
  check("the statement: 3 comps, over-limit one marked", st.comps === 3 && st.overLimit === 1 && st.rows.length >= 3);
  const rep = (await compsByOrg(orgs.orgDay(), orgs.orgDay())).find((o) => o.orgId === orgId);
  check("Reports: comps by organization today", rep?.people === 3);
  check("the invite link opens", (await readInvite(row.invite_code))?.id === orgId);
  check("a new invite link replaces it", (await admin.newInviteLink(orgId)).ok && (await readInvite(row.invite_code)) === null);
  check("taking someone out", (await admin.setPerson(orgId, third.id, null)).ok && (await register.getOrgOnOrder(third.id)) === null);
} finally {
  if (orgId) {
    await db.from("org_comps").delete().eq("organization_id", orgId);
    await db.from("members").update({ organization_id: null, org_role: null }).eq("organization_id", orgId);
    await db.from("organizations").delete().eq("id", orgId);
  }
  if (memberIds.length) await db.from("members").delete().in("id", memberIds);
  const { data: left } = await db.from("members").select("id").in("id", memberIds.length ? memberIds : [randomUUID()]);
  const { data: orgLeft } = orgId ? await db.from("organizations").select("id").eq("id", orgId) : { data: [] };
  check("cleaned up: members and organization gone", (left ?? []).length === 0 && (orgLeft ?? []).length === 0);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll organization checks passed");
process.exit(failures ? 1 : 0);

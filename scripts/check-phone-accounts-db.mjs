// Phone accounts (Andrew, 10/2: an account that's just a phone number, for
// guests who'll never want an email login) against the live database:
//  - the tablet's "Just use my phone number" (src/app/display/customer/
//    actions.ts createPhoneAccount): only the number, no name or email,
//    marketing off, no setup link; a number that's on an account already
//    checks that one in;
//  - the register's card for it ("Guest ·· 0199", phone only) and its
//    confirm: the visit's points, and no QR code pushed at them;
//  - "Add your name?" once, on the second visit, saved only when staff
//    confirm (lib/checkin-server.ts saveNameFromCheckin);
//  - the register's "New phone account", "Add name" and "Add email"
//    (src/app/pos/member-actions.ts);
//  - the name helpers keep "Guest ·· 0199" whole (lib/member-name.ts).
// Uses throwaway members (made-up names, example.invalid addresses and 555
// numbers), always deleted at the end with their visits. Never prints
// anyone's details. Nothing is emailed: RESEND_API_KEY is cleared.
//
// Usage: node scripts/check-phone-accounts-db.mjs   (Node 23.6+ runs the .ts directly)
import { registerHooks } from "node:module";
import { randomInt, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
delete process.env.RESEND_API_KEY;
if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.");
  process.exit(1);
}

// The screen and staff sessions are stand-ins (a made-up screen id, so the
// real screen's rate limits aren't touched; no staff id, since a confirmed
// visit records who confirmed it and that must be a real employee or none).
const SCREEN_ID = randomUUID();
const stubs = `
  export async function assertDisplayScreen() { return { employeeId: ${JSON.stringify(SCREEN_ID)}, name: "Check screen", role: "display", email: null }; }
  export async function assertStaff() { return { employeeId: null, name: "Check staff", role: "owner", email: null }; }
  export const hasAdminAccess = () => true;
  export const hasManagerAccess = () => true;
  export const afterCalls = [];
  export function after(fn) { afterCalls.push(fn); }
  export function revalidatePath() {}
  export function revalidateTag() {}
  export async function headers() { return new Headers(); }
  export async function cookies() { return { get() {}, getAll() { return []; }, set() {} }; }
  export function redirect() { throw new Error("redirect"); }
  export function notFound() { throw new Error("not found"); }
  export async function connection() {}
  export const unstable_cache = (fn) => fn;
  export function cacheTag() {}
  export function cacheLife() {}
  export function updateTag() {}
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

const { afterCalls } = await import(STUB_URL);
const { createAdminClient } = await import("../src/lib/supabase/admin.ts");
const tablet = await import("../src/app/display/customer/actions.ts");
const register = await import("../src/app/pos/checkin-actions.ts");
const pos = await import("../src/app/pos/member-actions.ts");
const server = await import("../src/lib/checkin-server.ts");
const { recordVisit } = await import("../src/lib/visits-server.ts");
const { formatPhone, firstNameOf } = await import("../src/lib/checkin.ts");
const { firstName, shortName } = await import("../src/lib/card-match.ts");
const names = await import("../src/lib/member-name.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

console.log("-- the name helpers");
check("'Guest ·· 0199' from any phone", names.guestName("(417) 555-0199") === "Guest ·· 0199" && names.guestName("+1 417.555.0199") === "Guest ·· 0199");
check("'Guest' with no phone", names.guestName(null) === "Guest" && names.guestName("-") === "Guest");
check("a name wins over the label", names.memberLabel("  Sarah Miller ", "4175550199") === "Sarah Miller" && names.memberLabel("", "4175550199") === "Guest ·· 0199");
check("the label stays whole as a first name, a short name and a card name", firstNameOf("Guest ·· 0199") === "Guest ·· 0199" && shortName("Guest ·· 0199") === "Guest ·· 0199" && firstName("Guest ·· 0199") === "Guest ·· 0199");
check("real names are unchanged", firstNameOf("Sarah Miller") === "Sarah" && shortName("Sarah Miller") === "Sarah M." && firstName("") === "Member");
check("a phone account is no email and no login", names.isPhoneAccount({ email: null, auth_user_id: null }) && !names.isPhoneAccount({ email: "a@b.co" }) && !names.isPhoneAccount({ email: null, hasLogin: true }));
check("a typed name can never look like the label", !names.isGuestName("Guest") && !names.isGuestName("Guest 0199") && names.isGuestName("Guest ·· 0199"));

const db = createAdminClient();
const letters = (n) => Array.from({ length: n }, () => String.fromCharCode(97 + randomInt(26))).join("");
const tag = letters(8);
const mail = (who) => `phoneacct-${who}-${tag}@example.invalid`;
const made = [];
const row = async (id) => (await db.from("members").select("name, email, phone, email_opt_in, tier, auth_user_id").eq("id", id).maybeSingle()).data;

async function freeNumber() {
  for (;;) {
    const d = `555${String(randomInt(2_000_000, 9_999_999))}`;
    const found = await server.memberIdsWithPhone(d);
    if (found.ok && found.ids.length === 0) return d;
  }
}

try {
  const p1 = await freeNumber();
  const p2 = await freeNumber();
  const p3 = await freeNumber();

  console.log("-- the tablet: Just use my phone number");
  const s1 = await tablet.startCheckin(p1);
  check("an unknown number is 'new' (nothing made yet)", s1.ok && s1.status === "new" && !(await server.memberIdsWithPhone(p1)).ids?.length);
  const c1 = await tablet.createPhoneAccount(formatPhone(p1));
  const sealed = c1.ok ? server.openCheckin(c1.request.ref) : null;
  const id1 = sealed && "memberId" in sealed ? sealed.memberId : null;
  if (id1) made.push(id1);
  check("made, with a check-in request for that account (fresh)", c1.ok && c1.made === true && !!id1 && sealed?.fresh === true && sealed.phone === p1);
  check("only the request comes back (nothing about the account)", c1.ok && Object.keys(c1).every((key) => ["ok", "request", "made"].includes(key)));
  const r1 = id1 ? await row(id1) : null;
  check("saved with only the number: no name, no email, marketing off, Insiders", r1?.name === "" && r1.email === null && r1.email_opt_in === false && r1.tier === "Insiders" && r1.phone === formatPhone(p1));
  check("no setup email or link queued", afterCalls.length === 0 && ((await db.from("member_claims").select("id").eq("member_id", id1 ?? randomUUID())).data ?? []).length === 0);
  const c1again = await tablet.createPhoneAccount(p1);
  check("the same number again checks that account in (no second one)", c1again.ok && c1again.made === false && (await server.memberIdsWithPhone(p1)).ids?.length === 1);
  check("junk numbers are refused", !(await tablet.createPhoneAccount("555-12")).ok && !(await tablet.createPhoneAccount("1115550199")).ok);

  console.log("-- the register: the card and the confirm");
  const card1 = c1.ok ? await register.resolveCheckin(c1.request.ref) : null;
  const m1 = card1?.ok && card1.card.kind === "known" ? card1.card.matches[0] : null;
  check("the card says 'Guest ·· last four', phone only, just joined", !!m1 && m1.name === `Guest ·· ${p1.slice(-4)}` && m1.named === false && m1.phoneOnly === true && card1.card.fresh === true && card1.card.phoneLast4 === p1.slice(-4));
  const v1 = id1 && c1.ok ? await register.confirmVisit(id1, c1.request.ref) : null;
  check("confirming pays the visit's points", v1?.ok === true && v1.visit.earned > 0 && v1.visit.alreadyToday === false, v1?.ok ? `+${v1.visit.earned}` : "");
  check("...and no 'see your points online' QR code for a phone account", v1?.ok === true && v1.claimUrl === null);
  check("no name was added (none asked for)", v1?.ok === true && !v1.nameNote && (await row(id1))?.name === "");

  console.log("-- Add your name? on the second visit");
  const s2 = await tablet.startCheckin(p1);
  check("not asked again the same day", s2.ok && s2.status === "known" && !s2.askName);
  // Their first visit moves to last week; today's goes, so today is the second.
  await db.from("member_visits").delete().eq("member_id", id1);
  await recordVisit(id1, null, new Date(Date.now() - 7 * 86_400_000));
  const s3 = await tablet.startCheckin(p1);
  check("asked on the second visit", s3.ok && s3.status === "known" && s3.askName === true && Object.keys(s3).every((key) => ["ok", "status", "request", "askName", "unlimited"].includes(key)));
  const bad = await tablet.nameCheckin({ phone: p1, firstName: "R2-D2", lastInitial: "" });
  check("a name that isn't letters is refused", !bad.ok);
  const badInitial = await tablet.nameCheckin({ phone: p1, firstName: "Ann", lastInitial: "Bx" });
  check("a last initial is one letter", !badInitial.ok);
  const n1 = await tablet.nameCheckin({ phone: p1, firstName: "  ann ", lastInitial: "b." });
  const sealedName = n1.ok ? server.openCheckin(n1.request.ref) : null;
  check("their answer is sealed into the request ('Ann B.')", n1.ok && n1.firstName === "Ann" && sealedName?.memberId === id1 && sealedName.addName === "Ann B.");
  check("nothing is saved before staff confirm", (await row(id1))?.name === "");
  const card2 = n1.ok ? await register.resolveCheckin(n1.request.ref) : null;
  check("the card says 'will add name Ann B.'", card2?.ok && card2.card.kind === "known" && card2.card.addName === "Ann B.");
  check("not added to some other account", n1.ok && (await server.saveNameFromCheckin(n1.request.ref, randomUUID())) === null && (await row(id1))?.name === "");
  const v2 = n1.ok ? await register.confirmVisit(id1, n1.request.ref) : null;
  check(
    "confirming saves it and hands back the member with it",
    v2?.ok === true && v2.nameNote === "Added their name: Ann B." && v2.member?.name === "Ann B." && v2.member?.named === true && (await row(id1))?.name === "Ann B.",
    v2?.ok ? `note: ${v2.nameNote ?? "none"}; member back: ${!!v2.member}` : (v2?.error ?? "no answer"),
  );
  check("confirming twice changes nothing", n1.ok && (await server.saveNameFromCheckin(n1.request.ref, id1)) === null);
  await db.from("member_visits").delete().eq("member_id", id1);
  await recordVisit(id1, null, new Date(Date.now() - 7 * 86_400_000));
  const s4 = await tablet.startCheckin(p1);
  check("a named account is never asked", s4.ok && s4.status === "known" && !s4.askName);
  const late = server.sealCheckin({ kind: "known", memberId: id1, phone: p1, addName: "Zed Q." });
  check("a name from the tablet never replaces one that's there", (await server.saveNameFromCheckin(late.ref, id1)) === null && (await row(id1))?.name === "Ann B.");

  console.log("-- the register: New phone account, Add name, Add email");
  const np = await pos.createPhoneMember({ phone: formatPhone(p2), firstName: "" });
  if (np.ok && np.made) made.push(np.member.id);
  check("made from just a number", np.ok && np.made === true && np.member.name === `Guest ·· ${p2.slice(-4)}` && np.member.phoneOnly === true);
  const np2 = await pos.createPhoneMember({ phone: p3, firstName: "bea" });
  if (np2.ok && np2.made) made.push(np2.member.id);
  check("...or with a first name", np2.ok && np2.made === true && np2.member.name === "Bea" && np2.member.named === true);
  const np3 = await pos.createPhoneMember({ phone: p2, firstName: "" });
  check("a number that has an account puts that one on instead", np3.ok && np3.made === false && np.ok && np3.member.id === np.member.id && /already has an account/.test(np3.message));
  check("junk is refused", !(await pos.createPhoneMember({ phone: "12345" })).ok && !(await pos.createPhoneMember({ phone: p2, firstName: "B0b" })).ok);
  if (np.ok) {
    const nm = await pos.addPosMemberName(np.member.id, { firstName: "carl", lastName: "Dee" });
    check("Add name", nm.ok && nm.member.name === "Carl Dee" && (await row(np.member.id))?.name === "Carl Dee");
    const nm2 = await pos.addPosMemberName(np.member.id, { firstName: "Other" });
    check("Add name never replaces a name", !nm2.ok && (await row(np.member.id))?.name === "Carl Dee");
    const em = await pos.addPosMemberEmail(np.member.id, { email: mail("c").toUpperCase() });
    const er = await row(np.member.id);
    check("Add email: saved lowercased, marketing still off", em.ok && er?.email === mail("c") && er.email_opt_in === false && em.member.phoneOnly === false);
    const em2 = await pos.addPosMemberEmail(np.member.id, { email: mail("d") });
    check("Add email never replaces an email", !em2.ok && (await row(np.member.id))?.email === mail("c"));
  }
  if (np2.ok) {
    const taken = await pos.addPosMemberEmail(np2.member.id, { email: mail("c") });
    check("an email on another account is refused", !taken.ok && /another account/.test(taken.error) && (await row(np2.member.id))?.email === null);
    const junk = await pos.addPosMemberEmail(np2.member.id, { email: "not an email" });
    check("junk email is refused", !junk.ok);
  }
} finally {
  if (made.length) await db.from("members").delete().in("id", made);
  const { data: byId } = await db.from("members").select("id").in("id", made.length ? made : [randomUUID()]);
  const { data: byMail } = await db.from("members").select("id").ilike("email", `phoneacct-%-${tag}@example.invalid`);
  const left = (byId ?? []).length + (byMail ?? []).length;
  check("cleaned up: no test members left", left === 0, `${left} left`);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll phone account checks passed");
process.exit(failures ? 1 : 0);

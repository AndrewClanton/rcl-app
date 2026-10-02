// "Phone or email" check-in (Andrew, 10/1) against the live database: the
// door tablet's email lookup and sign-up (src/app/display/customer/
// actions.ts), the register's card and the phone it adds on confirm
// (src/app/pos/checkin-actions.ts, lib/checkin-server.ts), and the
// register's duplicate hint for an account made with only an email
// (lib/data/member-merge.ts). Uses throwaway members (made-up names on
// example.invalid addresses and 555 numbers), always deleted at the end,
// with their links. Never prints anyone's details. Nothing is emailed:
// RESEND_API_KEY is cleared for this process.
//
// The screen and staff sessions are stand-ins (a made-up employee id, so
// the real screen's rate limits aren't touched).
//
// Usage: node scripts/check-checkin-email-db.mjs   (Node 23.6+ runs the .ts directly)
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

const SCREEN_ID = randomUUID();
const stubs = `
  export async function assertDisplayScreen() { return { employeeId: ${JSON.stringify(SCREEN_ID)}, name: "Check screen", role: "display", email: null }; }
  export async function assertStaff() { return { employeeId: ${JSON.stringify(SCREEN_ID)}, name: "Check staff", role: "owner", email: null }; }
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
const server = await import("../src/lib/checkin-server.ts");
const { tabletDuplicateOf } = await import("../src/lib/data/member-merge.ts");
const { formatPhone } = await import("../src/lib/checkin.ts");
const { isClaimUrl } = await import("../src/lib/claim-link.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = createAdminClient();
const letters = (n) => Array.from({ length: n }, () => String.fromCharCode(97 + randomInt(26))).join("");
const tag = letters(8);
const mail = (who) => `checkin-${who}-${tag}@example.invalid`;
const made = [];

// A 555 number nobody has.
async function freeNumber() {
  for (;;) {
    const d = `555${String(randomInt(2_000_000, 9_999_999))}`;
    const found = await server.memberIdsWithPhone(d);
    if (found.ok && found.ids.length === 0) return d;
  }
}
async function member(fields) {
  const { data, error } = await db.from("members").insert({ points: 0, tier: "Insiders", email_opt_in: false, ...fields }).select("id").single();
  if (error) throw new Error(`couldn't make a test member: ${error.message}`);
  made.push(data.id);
  return data.id;
}
const row = async (id) => (await db.from("members").select("name, email, phone, email_opt_in, points").eq("id", id).maybeSingle()).data;
const keysOk = (r) => Object.keys(r).every((key) => ["ok", "status", "name", "request", "withPhone", "phone", "unlimited"].includes(key));

try {
  const phoneB = await freeNumber();
  const phoneP = await freeNumber();
  // An older account the tablet couldn't have found (no phone), made first.
  const older = await member({ name: `Checkcheck Newbie${tag}` });
  const a = await member({ name: `Checkcheck Emailonly${tag}`, email: mail("a") });
  const b = await member({ name: `Checkcheck Phoneone${tag}`, phone: formatPhone(phoneB) });
  const a2 = await member({ name: `Checkcheck Emailtwo${tag}`, email: mail("a2") });

  console.log("-- the tablet: email lookup");
  const r1 = await tablet.startEmailCheckin({ email: `  ${mail("a").toUpperCase()} ` });
  check("found by email, any case and spaces", r1.ok && r1.status === "found");
  check("shows a first name and last initial only", r1.ok && r1.name === `Checkcheck E.`);
  check("nothing else about them comes back", r1.ok && keysOk(r1) && !JSON.stringify(r1).includes(mail("a")));
  check("no phone offer without a number typed first", r1.ok && !r1.withPhone && !r1.phone);
  const r2 = await tablet.startEmailCheckin({ email: mail("a"), phone: phoneP });
  check("a number they tried first is offered for an account with no phone", r2.ok && r2.status === "found" && !!r2.withPhone && r2.phone === formatPhone(phoneP));
  const sealedWith = r2.withPhone ? server.openCheckin(r2.withPhone.ref) : null;
  const sealedPlain = r2.ok ? server.openCheckin(r2.request.ref) : null;
  check("the offer's request carries the number, sealed", sealedWith?.kind === "known" && sealedWith.memberId === a && sealedWith.addPhone === phoneP);
  check("Skip's request doesn't", sealedPlain?.memberId === a && !sealedPlain.addPhone);
  const r3 = await tablet.startEmailCheckin({ email: mail("a"), phone: phoneB });
  check("no offer for a number that's on another account", r3.ok && r3.status === "found" && !r3.withPhone);
  const r4 = await tablet.startEmailCheckin({ email: mail("nobody") });
  check("an email nobody has is 'new'", r4.ok && r4.status === "new");
  const r5 = await tablet.startEmailCheckin({ email: "not an email" });
  check("junk is refused", !r5.ok);
  const r6 = await tablet.startCheckin(phoneP);
  check("the phone lookup still says 'new' for an unknown number (no account made)", r6.ok && r6.status === "new");

  console.log("-- the register: the card and the phone on confirm");
  const card = await register.resolveCheckin(r2.withPhone.ref);
  check(
    "the card is that account, by email, saying 'will add phone'",
    card.ok && card.card.kind === "known" && card.card.matches[0]?.id === a && card.card.byEmail === true && card.card.phoneLast4 === "" && card.card.addPhone === formatPhone(phoneP),
  );
  const plainCard = await register.resolveCheckin(r2.request.ref);
  check("Skip's card adds nothing", plainCard.ok && plainCard.card.kind === "known" && !plainCard.card.addPhone);
  check("not added to some other account", (await server.savePhoneFromCheckin(r2.withPhone.ref, b)) === null && (await row(a)).phone === null);
  check("Skip adds nothing", (await server.savePhoneFromCheckin(r2.request.ref, a)) === null && (await row(a)).phone === null);
  const note = await server.savePhoneFromCheckin(r2.withPhone.ref, a);
  check("confirming saves the number", note === `Added ${formatPhone(phoneP)} to their account.` && (await row(a)).phone === formatPhone(phoneP));
  const byPhone = await server.memberIdsWithPhone(phoneP);
  check("...and the phone keypad finds them next time", byPhone.ok && byPhone.ids.length === 1 && byPhone.ids[0] === a);
  check("confirming twice changes nothing", (await server.savePhoneFromCheckin(r2.withPhone.ref, a)) === null);
  const later = await register.resolveCheckin(r2.withPhone.ref);
  check("once they have a phone, the card stops saying 'will add phone'", later.ok && later.card.kind === "known" && !later.card.addPhone);
  const taken = server.sealCheckin({ kind: "known", memberId: a2, addPhone: phoneB });
  const takenNote = await server.savePhoneFromCheckin(taken.ref, a2);
  check("a number another account got meanwhile isn't added", /is on another account/.test(takenNote ?? "") && (await row(a2)).phone === null);
  check("a tampered request adds nothing", (await server.savePhoneFromCheckin(`${r2.withPhone.ref.slice(0, -2)}xx`, a)) === null);

  console.log("-- the tablet: someone new");
  const n1 = await tablet.createKioskMember({ firstName: "Checkcheck", lastName: "Again", email: mail("a").toUpperCase(), phone: "" });
  check("an email that's on an account checks that one in instead", n1.ok && n1.status === "found" && n1.name === "Checkcheck E.");
  const n2 = await tablet.createKioskMember({ firstName: "Checkcheck", lastName: `Phoneone${tag}`, email: mail("x"), phone: formatPhone(phoneB) });
  check("a number that's on an account checks that one in instead", n2.ok && n2.status === "known");
  check("...and no second account was made", (await db.from("members").select("id").ilike("email", mail("x"))).data?.length === 0);
  check("a bad email is refused", !(await tablet.createKioskMember({ firstName: "Checkcheck", lastName: "Bad", email: "nope", phone: "" })).ok);
  check("a part phone number is refused", !(await tablet.createKioskMember({ firstName: "Checkcheck", lastName: "Bad", email: mail("y"), phone: "417555" })).ok);
  const n3 = await tablet.createKioskMember({ firstName: "checkcheck", lastName: `Newbie${tag}`, email: ` ${mail("new").toUpperCase()} `, phone: null });
  check("a new account with just a name and email", n3.ok && n3.status === "created" && n3.firstName === "Checkcheck");
  const sealedNew = n3.ok && n3.status === "created" ? server.openCheckin(n3.request.ref) : null;
  if (sealedNew?.memberId) made.push(sealedNew.memberId);
  const fresh = sealedNew?.memberId ? await row(sealedNew.memberId) : null;
  check(
    "saved with their email (lowercase), no phone, no marketing, 0 points",
    !!fresh && fresh.email === mail("new") && fresh.phone === null && fresh.email_opt_in === false && Number(fresh.points) === 0 && fresh.name === `Checkcheck Newbie${tag}`,
  );
  check("its request is that account, fresh, by email", sealedNew?.kind === "known" && sealedNew.fresh === true && !sealedNew.phone);
  check("the on-screen QR code is a claim link (no phone needed)", n3.ok && n3.status === "created" && isClaimUrl(n3.claimUrl));
  check("no email here (RESEND_API_KEY cleared), and the screen isn't told one went", n3.ok && n3.status === "created" && n3.emailed === false && afterCalls.length === 0);
  const newCard = await register.resolveCheckin(n3.request.ref);
  check("the register sees 'New regular' by email", newCard.ok && newCard.card.kind === "known" && newCard.card.fresh === true && newCard.card.byEmail === true);
  const dup = sealedNew?.memberId ? await tabletDuplicateOf(sealedNew.memberId) : null;
  check("the duplicate hint finds the older same-name account with no phone", dup?.olderId === older);
  check("...and nothing for a new account with no look-alike", (await tabletDuplicateOf(a2)) === null);

  // The setup email, with a stand-in for Resend: a fake key for this
  // process, and every call to api.resend.com caught here (nothing leaves).
  // The database calls go through as usual.
  console.log("-- the setup email for someone new");
  const realFetch = globalThis.fetch;
  const caught = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.resend.com/")) {
      caught.push(JSON.parse(init.body));
      return Response.json({ id: randomUUID() });
    }
    return realFetch(url, init);
  };
  process.env.RESEND_API_KEY = "re_test_fake";
  try {
    const n4 = await tablet.createKioskMember({ firstName: "Checkcheck", lastName: `Mailed${tag}`, email: mail("mailed"), phone: "" });
    const id4 = n4.ok && n4.status === "created" ? server.openCheckin(n4.request.ref)?.memberId : null;
    if (id4) made.push(id4);
    check("the screen is told a link is on its way", n4.ok && n4.status === "created" && n4.emailed === true && afterCalls.length === 1);
    check("...sent after the answer, not before", caught.length === 0);
    await afterCalls.shift()?.();
    const sent = caught[0];
    check("one email, to the address they typed", caught.length === 1 && sent.to?.length === 1 && sent.to[0] === mail("mailed"));
    check("it's the setup email, with their own 30-day link", sent?.subject === "Finish setting up your Royale account" && /\/account\/claim\?t=[A-Za-z0-9_-]{58}/.test(sent.html) && /works for 30 days/.test(sent.text ?? ""));
    check("tagged transactional (no list, no unsubscribe needed)", (sent?.tags ?? []).some((t) => t.name === "kind" && t.value === "transactional"));
    const claimRows = id4 ? (await db.from("member_claims").select("kind").eq("member_id", id4)).data ?? [] : [];
    check("two links on record: the QR code's and the email's", claimRows.filter((r) => r.kind === "kiosk").length === 1 && claimRows.filter((r) => r.kind === "email").length === 1);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  }
} finally {
  if (made.length) await db.from("members").delete().in("id", made);
  const { data: byId } = await db.from("members").select("id").in("id", made.length ? made : [randomUUID()]);
  const { data: byMail } = await db.from("members").select("id").ilike("email", `checkin-%-${tag}@example.invalid`);
  const left = (byId ?? []).length + (byMail ?? []).length;
  check("cleaned up: no test members left", left === 0, `${left} left`);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll Phone or email check-in checks passed");
process.exit(failures ? 1 : 0);

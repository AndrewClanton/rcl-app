// "Flag suspicious activity" (Andrew, 10/2) against the live database:
//  - the register's press-and-hold panel flags an account (src/app/pos/
//    checkin-actions.ts flagMember): who, when, the reason, the note and
//    today's check-in; the panel and Checked in today see it;
//  - Back office takes back the flagged check-in's points and clears the
//    flag (src/app/admin/members/flag-actions.ts), each recording who;
//  - deleting the account deletes its flags (the migration's trigger).
// Uses one throwaway member (a made-up name and a 555 number), always
// deleted at the end with its visits and flags. The flag is recorded as
// one real employee's (read only; nothing about them changes). Never prints
// anyone's details.
//
// Needs supabase/migrations/20261002060000_member_flags.sql applied.
// Usage: node scripts/check-member-flags-db.mjs   (Node 23.6+ runs the .ts directly)
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

// Stand-in staff sessions: `who.id` is set to a real employee below (the
// flag's flagger and clearer must be a real employee or none).
const stubs = `
  export const who = { id: null };
  export async function assertStaff() { return { employeeId: who.id, name: "Check staff", role: "owner", email: null }; }
  export async function assertAdmin() { return { employeeId: who.id, name: "Check admin", role: "owner", email: null }; }
  export async function assertDisplayScreen() { return { employeeId: ${JSON.stringify(randomUUID())}, name: "Check screen", role: "display", email: null }; }
  export const hasAdminAccess = () => true;
  export const hasManagerAccess = () => true;
  export function after() {}
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

const { who } = await import(STUB_URL);
const { createAdminClient } = await import("../src/lib/supabase/admin.ts");
const register = await import("../src/app/pos/checkin-actions.ts");
const backOffice = await import("../src/app/admin/members/flag-actions.ts");
const flags = await import("../src/lib/member-flags-server.ts");
const { recordVisit } = await import("../src/lib/visits-server.ts");
const { visitBusinessDate } = await import("../src/lib/visits.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = createAdminClient();
const tag = Array.from({ length: 8 }, () => String.fromCharCode(97 + randomInt(26))).join("");
let memberId = null;

try {
  const { data: staff } = await db.from("employees").select("id, name").limit(1).maybeSingle();
  check("an employee to record as the flagger", !!staff?.id);
  who.id = staff?.id ?? null;

  const { data: m } = await db
    .from("members")
    .insert({ name: `Flagcheck Q${tag}`, phone: `(555) ${randomInt(200, 999)}-${randomInt(1000, 9999)}`, email: null, email_opt_in: false, points: 0, tier: "Insiders" })
    .select("id")
    .single();
  memberId = m?.id ?? null;
  check("a throwaway member", !!memberId);
  const visit = await recordVisit(memberId, null);
  check("checked in today, with points", !!visit && visit.earned > 0);
  const { data: v } = await db.from("member_visits").select("id").eq("member_id", memberId).eq("business_date", visitBusinessDate(new Date())).maybeSingle();

  console.log("-- the register: Flag suspicious activity");
  check("a made-up reason is refused", !(await register.flagMember(memberId, { reason: "nope" }, staff.id)).ok);
  const f = await register.flagMember(memberId, { reason: "someone_elses_number", note: "  used   her mom's number  " }, staff.id);
  check("flagged, by the cashier by name", f.ok && f.flag.by === staff.name && !!f.flag.at);
  const [row] = await flags.memberFlags(memberId);
  check(
    "the flag records the reason, the tidied note, today's check-in and who",
    row?.reason === "someone_elses_number" && row.note === "used her mom's number" && row.visitId === v?.id && row.visitDate === visitBusinessDate(new Date()) && row.flaggedBy === staff.name && !row.clearedAt,
  );
  const glance = await register.getMemberGlance(memberId);
  check("the press-and-hold panel shows it (who and when)", glance?.flag?.by === staff.name && glance.flag.at === row?.flaggedAt);
  const here = (await register.getHereToday()).find((h) => h.member.id === memberId);
  check("Checked in today marks the card flagged", here?.flagged === true);
  check("Back office's Today list has it", (await flags.openFlags(50)).some((x) => x.flag.id === row?.id));

  console.log("-- Back office: take back the check-in, clear the flag");
  const before = (await db.from("members").select("points").eq("id", memberId).single()).data?.points;
  const t = await backOffice.takeBackFlagPoints(row.id);
  const after = (await db.from("members").select("points").eq("id", memberId).single()).data?.points;
  const [taken] = await flags.memberFlags(memberId);
  check("the check-in's points come off", t.ok && Number(before) > 0 && Number(after) === 0, `${before} -> ${after}`);
  check("the visit is gone, and the flag says who took it back and how many", !taken.visitId && taken.takenBackBy === staff.name && taken.takenBackPoints === Number(before) && !!taken.takenBackAt);
  const { data: ledger } = await db.from("points_ledger").select("delta, note").eq("member_id", memberId).order("created_at", { ascending: false }).limit(1);
  check("one line in their points history", ledger?.[0]?.note === "Check-in taken back (flagged)" && Number(ledger[0].delta) === -Number(before));
  check("taking it back twice does nothing", !(await backOffice.takeBackFlagPoints(row.id)).ok);
  const c = await backOffice.clearMemberFlag(row.id);
  const [cleared] = await flags.memberFlags(memberId);
  check("cleared, recording who and when", c.ok && cleared.clearedBy === staff.name && !!cleared.clearedAt);
  check("clearing twice does nothing", !(await backOffice.clearMemberFlag(row.id)).ok);
  check("no longer open: the panel, the card and the Today list", (await register.getMemberGlance(memberId))?.flag === null && !(await flags.flaggedAmong([memberId])).has(memberId) && !(await flags.openFlags(50)).some((x) => x.flag.id === row.id));
  const noVisit = await register.flagMember(memberId, { reason: "other" }, null);
  const [second] = await flags.memberFlags(memberId);
  check("a flag with no check-in today (and no cashier picked) still saves", noVisit.ok && second.reason === "other" && !second.visitId && !second.note);
} finally {
  if (memberId) {
    await db.from("members").delete().eq("id", memberId);
    const { count } = await db.from("member_flags").select("id", { count: "exact", head: true }).eq("member_id", memberId);
    const { data: left } = await db.from("members").select("id").eq("id", memberId);
    check("cleaned up: the member and (by the trigger) its flags are gone", (left ?? []).length === 0 && count === 0, `${count} flags left`);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll member flag checks passed");
process.exit(failures ? 1 : 0);

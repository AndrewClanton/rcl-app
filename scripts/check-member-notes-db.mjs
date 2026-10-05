// Account notes and the "Group / organization" label (Andrew, 10/5) against
// the live database: the register's press-and-hold panel adds a note and
// sets the organization (src/app/pos/checkin-actions.ts), Checked in today
// shows the tag, Back office adds a note and Members filters by it; deleting
// the account deletes its notes (the migration's trigger). Uses one
// throwaway member (a made-up name and a 555 number), always deleted at the
// end. Never prints anyone's details.
//
// Needs supabase/migrations/20261005030000_member_notes.sql applied.
// Usage: node scripts/check-member-notes-db.mjs   (Node 23.6+ runs the .ts directly)
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
const backOffice = await import("../src/app/admin/members/[id]/notes-actions.ts");
const { getMembersPage } = await import("../src/lib/data/members.ts");
const { recordVisit } = await import("../src/lib/visits-server.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = createAdminClient();
const tag = Array.from({ length: 8 }, () => String.fromCharCode(97 + randomInt(26))).join("");
const org = `Notecheck Org ${tag}`;
let memberId = null;

try {
  const { data: staff } = await db.from("employees").select("id, name").limit(1).maybeSingle();
  check("an employee to record as the writer", !!staff?.id);
  who.id = staff?.id ?? null;

  const { data: m } = await db
    .from("members")
    .insert({ name: `Notecheck Q${tag}`, phone: `(555) ${randomInt(200, 999)}-${randomInt(1000, 9999)}`, email: null, email_opt_in: false, points: 0, tier: "Insiders" })
    .select("id")
    .single();
  memberId = m?.id ?? null;
  check("a throwaway member", !!memberId);
  await recordVisit(memberId, null);

  console.log("-- the register: Add a note, Group / organization");
  check("an empty note is refused", !(await register.addMemberNote(memberId, "   ", staff.id)).ok);
  const n = await register.addMemberNote(memberId, "  With   the group, corporate account later  ", staff.id);
  check("a note saves, by the cashier by name", n.ok && n.note.by === staff.name && n.note.note === "With the group, corporate account later");
  const o = await register.setMemberOrganization(memberId, `  ${org}  `);
  check("the organization saves, tidied", o.ok && o.organization === org);
  const glance = await register.getMemberGlance(memberId);
  check("the press-and-hold panel shows the note and organization", glance?.notes[0]?.id === (n.ok && n.note.id) && glance.organization === org && glance.organizations.includes(org));
  const here = (await register.getHereToday()).find((h) => h.member.id === memberId);
  check("Checked in today has the organization tag", here?.organization === org);
  const lower = await register.setMemberOrganization(memberId, org.toLowerCase());
  check("other capitals save as the spelling already in use", lower.ok && lower.organization === org);

  console.log("-- Back office: notes and the Members filter");
  const b = await backOffice.addMemberNoteAdmin(memberId, "Second note");
  check("a note from Back office saves", b.ok && b.note.by === staff.name);
  const { data: rows } = await db.from("member_notes").select("note").eq("member_id", memberId).order("created_at", { ascending: false });
  check("both notes are stored, newest first", rows?.length === 2 && rows[0].note === "Second note");
  const page = await getMembersPage({ organization: org.toUpperCase(), viewerRole: "owner" });
  check("Members filters by organization (any capitals)", page.total === 1 && page.members[0]?.id === memberId);
  const cleared = await backOffice.setMemberOrganizationAdmin(memberId, "");
  check("an empty organization clears it", cleared.ok && cleared.organization === null);
} finally {
  if (memberId) {
    await db.from("members").delete().eq("id", memberId);
    const { count } = await db.from("member_notes").select("id", { count: "exact", head: true }).eq("member_id", memberId);
    const { data: left } = await db.from("members").select("id").eq("id", memberId);
    check("cleaned up: the member and (by the trigger) its notes are gone", (left ?? []).length === 0 && count === 0, `${count} notes left`);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll member note checks passed");
process.exit(failures ? 1 : 0);

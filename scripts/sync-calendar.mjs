// Syncs the schedule with the staff calendar, "RCL Calendar 2026.xlsx".
// The same code as Back office > Showtimes > Sync from calendar
// (src/lib/calendar-sync.ts has the rules); this is the command-line way in.
//
// Usage (Node 23.6+ runs the .ts directly):
//   node scripts/sync-calendar.mjs "RCL Calendar 2026.xlsx"                 (dry run)
//   node scripts/sync-calendar.mjs calendar.xlsx --out report.txt
//   node scripts/sync-calendar.mjs calendar.xlsx --apply                    (writes)
//   node scripts/sync-calendar.mjs --drive [--apply]     (pulls it from Google Drive:
//     the link saved on the Back office page, else CALENDAR_SHEET_URL)
//
// Titles that need a pick (several films called "Legend", or a film that
// isn't in the library yet) are listed and left alone here: pick them on the
// Back office page, which can add a film from TMDb.
import { writeFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });
const srcRoot = pathToFileURL(fileURLToPath(new URL("../src/", import.meta.url))).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        return next(s.startsWith("@/") ? ${JSON.stringify(srcRoot)} + s.slice(2) + ".ts" : s, c);
      }`,
    ),
);
const sync = await import("../src/lib/calendar-sync.ts");

const drive = await import("../src/lib/calendar-drive.ts");

const args = process.argv.slice(2);
const fromDrive = args.includes("--drive");
const file = fromDrive ? "Google Drive" : args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
const outIdx = args.indexOf("--out");
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
const apply = args.includes("--apply");
if (!file) {
  console.error('Usage: node scripts/sync-calendar.mjs ("RCL Calendar 2026.xlsx" | --drive) [--out report.txt] [--apply]');
  process.exit(1);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let input = file;
if (fromDrive) {
  // The link saved on the Back office page, else CALENDAR_SHEET_URL.
  const { data } = await db.from("settings").select("value").eq("key", drive.CALENDAR_SHEET_SETTING).maybeSingle();
  const link = (typeof data?.value === "string" && data.value.trim()) || (process.env.CALENDAR_SHEET_URL ?? "").trim();
  if (!link) {
    console.error("No Google Drive link: save one on Back office > Showtimes > Sync from calendar, or set CALENDAR_SHEET_URL.");
    process.exit(1);
  }
  const got = await drive.fetchCalendarFromDrive(link);
  if (!got.ok) {
    console.error(got.error);
    process.exit(1);
  }
  input = got.bytes;
}
const cal = sync.parseCalendar(await sync.readCalendarFile(input));
const state = await sync.loadSyncState(db);
const plan = sync.buildPlan(cal, state);

const lines = [];
const say = (s = "") => lines.push(s);
const tag = (l) => (l.where === "outdoor" ? " (outdoor)" : "");
function grouped(title, items) {
  say(`${title} (${items.length})`);
  if (!items.length) say("    nothing");
  let last = null;
  for (const it of items) {
    if (it.date !== last) say(sync.dayHead((last = it.date)));
    say(`    ${it.clock}  ${it.title}${tag(it)}${it.detail ? `: ${it.detail}` : ""}`);
  }
  say();
}
say(`Calendar sync ${apply ? "" : "DRY RUN "}from ${sync.dayHead(plan.today)} through ${sync.dayHead(plan.lastDate)} (tabs: ${plan.tabs.join(", ")})`);
if (!apply) say("Nothing was written. Run again with --apply to make these changes.");
say();
grouped("TO ADD", plan.add);
grouped("TO CHANGE", plan.change);
grouped("TO REMOVE", plan.remove);
grouped("FLAGGED (tickets sold)", plan.flagged);
say(`TITLES TO PICK (${plan.looks.length}; left alone here, pick them in Back office)`);
for (const l of plan.looks) say(`    ${l.kind === "ambiguous" ? "several films" : "not in the library"}: ${l.title}${l.year ? ` ${l.year}` : ""}  [${l.when.join("; ")}]${l.candidates.length ? `  options: ${l.candidates.map((c) => c.label).join(" / ")}` : ""}`);
say();
grouped("ODD TIMES", plan.odd);
grouped("KEPT (the calendar mentions them)", plan.kept);
grouped("SKIPPED calendar lines", plan.skipped);
const report = lines.join("\n");
console.log(report);
if (outFile) writeFileSync(outFile, report + "\n");

if (apply) {
  const r = await sync.applyPlan(db, plan, { id: null, name: "sync-calendar script", file: file.split(/[\\/]/).pop() });
  console.log(`\nWrote ${r.added} adds, ${r.changed} changes, ${r.removed} removals${r.kept ? ` (${r.kept} kept: tickets sold just now)` : ""}.`);
}

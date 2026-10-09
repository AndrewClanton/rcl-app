// The hourly schedule check (Andrew, 10/9: "it needs to be checked every
// day... I'm not going to manually upload it"). A Claude scheduled task
// downloads "RCL Calendar 2026.xlsx" with the Google Drive connector, then
// runs this with the saved download:
//
//   node scripts/calendar-hourly.mjs <download.json | calendar.xlsx>
//
// It applies the sync (the calendar wins; showings with tickets sold are
// flagged, never removed: src/lib/calendar-sync.ts), then records the result
// in settings.calendar_sync_status, which the "schedule not checked" warning
// reads. A failed run records ok:false so the warning still fires.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function record(value) {
  const c = new pg.Client({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    user: process.env.SUPABASE_DB_USER || "postgres",
    password: process.env.SUPABASE_DB_PASSWORD,
    database: process.env.SUPABASE_DB_NAME || "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  await c.query(
    "insert into settings (key, value, updated_at) values ('calendar_sync_status', $1, now()) on conflict (key) do update set value = excluded.value, updated_at = now()",
    [JSON.stringify(value)],
  );
  await c.end();
}

const input = process.argv[2];
const at = new Date().toISOString();
try {
  if (!input) throw new Error("usage: calendar-hourly.mjs <download.json | calendar.xlsx>");
  const dir = mkdtempSync(path.join(tmpdir(), "rcl-cal-"));
  let xlsx = input;
  if (!input.toLowerCase().endsWith(".xlsx")) {
    const j = JSON.parse(readFileSync(input, "utf8"));
    const b64 = String(j.content).replace(/^data:[^,]*,/, "");
    xlsx = path.join(dir, "calendar.xlsx");
    writeFileSync(xlsx, Buffer.from(b64, "base64"));
  }
  const report = path.join(dir, "report.txt");
  const out = execFileSync(process.execPath, ["scripts/sync-calendar.mjs", xlsx, "--apply", "--out", report], { encoding: "utf8" });
  const text = readFileSync(report, "utf8");
  const count = (label) => Number((text.match(new RegExp(`^${label}[^\\n]*?\\((\\d+)`, "m")) ?? [])[1] ?? 0);
  const flaggedBlock = (text.match(/^FLAGGED[^\n]*\n([\s\S]*?)\n\n/m) ?? [])[1] ?? "";
  const status = {
    ok: true,
    at,
    source: "hourly (this computer, Google Drive connector)",
    added: count("TO ADD"),
    changed: count("TO CHANGE"),
    removed: count("TO REMOVE"),
    flagged: count("FLAGGED"),
    titlesToPick: count("TITLES TO PICK"),
    flaggedLines: flaggedBlock.split("\n").map((l) => l.trim()).filter((l) => l && l !== "nothing").slice(0, 10),
  };
  await record(status);
  console.log(out.trim());
  console.log(JSON.stringify(status));
} catch (e) {
  await record({ ok: false, at, source: "hourly (this computer, Google Drive connector)", error: String(e?.message ?? e).slice(0, 300) }).catch(() => {});
  console.error("calendar check failed:", e?.message ?? e);
  process.exit(1);
}

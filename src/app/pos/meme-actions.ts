"use server";

import { assertStaff } from "@/lib/auth";
import { allowAttempt } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueJobs, stationPrinter, stationProblem } from "@/lib/print/queue";
import { EASTER_EGG_TABLE, rowRaster, type EasterEggRow } from "@/lib/print/easter-egg-pictures";
import { memeXml } from "@/lib/print/receipt";
import { asStation } from "@/lib/print/stations";

// Register → ✨ → 🎲 Print a meme: one of the pictures an admin put in
// Back office → Printers → Easter egg pictures, on this register's station
// printer, through the print queue as a short receipt with no drawer kick.
// Random per press, seeded by the press itself, never the same one twice
// in a row; one every 10 seconds per station.

export type MemeResult = { ok: true; id: string } | { ok: false; error: string; none?: boolean };

const COOLDOWN_SECONDS = 10;
const NO_PICTURES = "Add pictures in Back office first.";

// How many pictures there are to print (the button says so when there are none).
export async function memePictureCount(): Promise<number> {
  await assertStaff();
  const { count } = await createAdminClient().from(EASTER_EGG_TABLE).select("id", { count: "exact", head: true });
  return count ?? 0;
}

// The press (station and time) picks the picture: same press, same pick.
function seeded(seedText: string): number {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619);
  h = (h + 0x6d2b79f5) | 0; // mulberry32, one step
  let t = Math.imul(h ^ (h >>> 15), 1 | h);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export async function printMeme(input: { station: string; lastId?: string | null; pressedAt: number }): Promise<MemeResult> {
  const staff = await assertStaff();
  const station = asStation(input.station);
  if (!station) return { ok: false, error: "This register isn't set to print through the website." };

  const admin = createAdminClient();
  const { data: ids, error: listErr } = await admin.from(EASTER_EGG_TABLE).select("id").order("created_at");
  if (listErr) return { ok: false, error: "Couldn't load the pictures. Try again." };
  const all = (ids ?? []).map((r) => String(r.id));
  if (!all.length) return { ok: false, error: NO_PICTURES, none: true };

  if (!(await allowAttempt(`meme-print:${station}`, 1, COOLDOWN_SECONDS))) return { ok: false, error: "One every 10 seconds. Try again in a moment." };

  const printer = await stationPrinter(station);
  const problem = stationProblem(station, printer);
  if (problem || !printer) return { ok: false, error: problem ?? "No printer." };

  const lastId = typeof input.lastId === "string" ? input.lastId : null;
  const pool = all.length > 1 ? all.filter((id) => id !== lastId) : all;
  const pressedAt = Number.isFinite(input.pressedAt) ? Math.floor(input.pressedAt) : Date.now();
  const id = pool[Math.floor(seeded(`${station}:${pressedAt}`) * pool.length)];

  const { data: row } = await admin.from(EASTER_EGG_TABLE).select("*").eq("id", id).maybeSingle();
  const raster = row ? await rowRaster(row as EasterEggRow) : null;
  if (!raster) return { ok: false, error: "That picture couldn't be read. Try again, or replace it in Back office." };
  try {
    await enqueueJobs(printer.id, [{ kind: "receipt", xml: memeXml(raster), label: "Easter egg picture" }], staff.employeeId);
    return { ok: true, id };
  } catch (e) {
    console.error("easter egg picture not queued", e);
    return { ok: false, error: "Couldn't send that to the printer. Check the connection and try again." };
  }
}

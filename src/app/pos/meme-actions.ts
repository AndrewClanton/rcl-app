"use server";

import { assertStaff } from "@/lib/auth";
import { allowAttempt } from "@/lib/rate-limit";
import { enqueueJobs, stationPrinter, stationProblem } from "@/lib/print/queue";
import { MEMES } from "@/lib/print/meme-rasters";
import { memeXml } from "@/lib/print/receipt";
import { asStation } from "@/lib/print/stations";

// Register → ✨ → Print a meme: one of the drawn memes (original art,
// scripts/make-meme-rasters.mjs) on this register's station printer,
// through the print queue as a short receipt with no drawer kick. Random
// per press, seeded by the press itself, never the same one twice in a
// row; one every 10 seconds per station.

export type MemeResult = { ok: true; key: string; title: string } | { ok: false; error: string };

const COOLDOWN_SECONDS = 10;

// The press (station and time) picks the meme: same press, same meme.
function pickMeme(seedText: string, lastKey: string | null): (typeof MEMES)[number] {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619);
  // mulberry32, one step
  h = (h + 0x6d2b79f5) | 0;
  let t = Math.imul(h ^ (h >>> 15), 1 | h);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  const pool = MEMES.filter((m) => m.key !== lastKey);
  return pool[Math.floor(r * pool.length)];
}

export async function printMeme(input: { station: string; lastKey?: string | null; pressedAt: number }): Promise<MemeResult> {
  const staff = await assertStaff();
  const station = asStation(input.station);
  if (!station) return { ok: false, error: "This register isn't set to print through the website." };
  if (!(await allowAttempt(`meme-print:${station}`, 1, COOLDOWN_SECONDS))) return { ok: false, error: "One meme every 10 seconds. Try again in a moment." };

  const printer = await stationPrinter(station);
  const problem = stationProblem(station, printer);
  if (problem || !printer) return { ok: false, error: problem ?? "No printer." };

  const pressedAt = Number.isFinite(input.pressedAt) ? Math.floor(input.pressedAt) : Date.now();
  const lastKey = typeof input.lastKey === "string" ? input.lastKey : null;
  const meme = pickMeme(`${station}:${pressedAt}`, lastKey);
  try {
    await enqueueJobs(printer.id, [{ kind: "receipt", xml: memeXml(meme.raster), label: `Meme: ${meme.title}` }], staff.employeeId);
    return { ok: true, key: meme.key, title: meme.title };
  } catch (e) {
    console.error("meme not queued", e);
    return { ok: false, error: "Couldn't send that to the printer. Check the connection and try again." };
  }
}

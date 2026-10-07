"use server";

import { revalidatePath, updateTag } from "next/cache";
import { getStaffSession, hasManagerAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasTmdbKey, searchTmdbMovies } from "@/lib/tmdb";
import { schemaMissing } from "@/lib/schema-missing";
import { PUBLIC_SCREENINGS_TAG } from "@/lib/data/screenings";
import { applyPlan, buildPlan, loadSyncState, parseCalendar, readCalendarFile, type Candidate, type ParsedCalendar, type Picks, type SyncPlan } from "@/lib/calendar-sync";
import { importMovie } from "../actions";

// Back office > Showtimes > Sync from calendar. Both actions take the
// uploaded .xlsx again (it's small), so Apply reads the calendar and the
// schedule fresh rather than trusting what the browser kept. Managers and up.

type Fail = { ok: false; error: string };
export type PreviewResult = { ok: true; plan: SyncPlan; fileName: string } | Fail;
export type ApplyResult = { ok: true; added: number; changed: number; removed: number; kept: number; filmsAdded: number } | (Fail & { plan?: SyncPlan });

const MOST_BYTES = 8 * 1024 * 1024;

async function manager() {
  const staff = await getStaffSession();
  if (!staff) return { staff: null, no: { ok: false as const, error: "Your staff session has expired. Sign in again." } };
  if (!hasManagerAccess(staff.role)) return { staff: null, no: { ok: false as const, error: "Syncing from the calendar takes a manager." } };
  return { staff, no: null };
}

async function readUpload(form: FormData): Promise<{ cal: ParsedCalendar; fileName: string; picks: Picks } | Fail> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Pick the calendar file (.xlsx) first." };
  if (file.size > MOST_BYTES) return { ok: false, error: "That file is too big to be the calendar. Pick the .xlsx file." };
  let picks: Picks = {};
  try {
    const raw = JSON.parse(String(form.get("picks") ?? "{}"));
    if (raw && typeof raw === "object") picks = Object.fromEntries(Object.entries(raw).filter(([k, v]) => typeof v === "string" && k.length < 300)) as Picks;
  } catch {
    // no picks
  }
  try {
    const tabs = await readCalendarFile(Buffer.from(await file.arrayBuffer()));
    const cal = parseCalendar(tabs);
    if (!cal.tabs.length) return { ok: false, error: "No month tabs (OCT, NOV, DEC...) with dates from today on were found in that file. Is it the right calendar?" };
    return { cal, fileName: file.name, picks };
  } catch {
    return { ok: false, error: "That file couldn't be read as an Excel spreadsheet. In Google Drive, download the calendar as .xlsx (Microsoft Excel) and pick that." };
  }
}

// Films TMDb has under each title staff need to pick, so they can add the
// right one straight from here, as Showtimes' own search does.
async function tmdbOptions(plan: SyncPlan): Promise<Record<string, Candidate[]>> {
  if (!hasTmdbKey() || !plan.looks.length) return {};
  const out: Record<string, Candidate[]> = {};
  await Promise.all(
    plan.looks.slice(0, 20).map(async (l) => {
      try {
        const hits = await searchTmdbMovies(l.title, l.year ? String(l.year) : undefined);
        out[l.key] = hits.slice(0, 6).map((h) => ({ value: `tmdb:${h.tmdbId}`, label: `${h.title}${h.year ? ` (${h.year})` : ""}`, source: "tmdb" as const }));
      } catch {
        // TMDb down: the library's choices and Skip still work.
      }
    }),
  );
  return out;
}

export async function previewCalendarSync(form: FormData): Promise<PreviewResult> {
  const { no } = await manager();
  if (no) return no;
  const up = await readUpload(form);
  if ("ok" in up) return up;
  try {
    const state = await loadSyncState(createAdminClient());
    const first = buildPlan(up.cal, state, up.picks);
    const plan = first.looks.length ? buildPlan(up.cal, state, up.picks, await tmdbOptions(first)) : first;
    return { ok: true, plan, fileName: up.fileName };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Couldn't compare the calendar with the schedule. Try again." };
  }
}

export async function applyCalendarSync(form: FormData): Promise<ApplyResult> {
  const { staff, no } = await manager();
  if (no) return no;
  const up = await readUpload(form);
  if ("ok" in up) return up;
  try {
    const db = createAdminClient();
    const state = await loadSyncState(db);
    let plan = buildPlan(up.cal, state, up.picks);
    if (plan.signature !== String(form.get("signature") ?? "")) {
      if (plan.looks.length) plan = buildPlan(up.cal, state, up.picks, await tmdbOptions(plan));
      return { ok: false, error: "The schedule changed since this preview (someone edited a showing, a ticket sold, or a showing started). Here's the new preview: check it and Apply again.", plan };
    }
    // Films picked from TMDb go into the library first.
    const movieIds: Record<string, string> = {};
    for (const v of new Set(plan.add.map((a) => a.movieId).filter((id) => id.startsWith("tmdb:")))) {
      const r = await importMovie(v);
      if (!r.ok) return { ok: false, error: `Couldn't add a film from TMDb: ${r.error} Nothing was changed.` };
      movieIds[v] = r.id;
    }
    const r = await applyPlan(db, plan, { id: staff.employeeId, name: staff.name, file: up.fileName }, movieIds);
    updateTag(PUBLIC_SCREENINGS_TAG);
    revalidatePath("/admin/screenings");
    revalidatePath("/admin/screenings/sync");
    revalidatePath("/showtimes");
    revalidatePath("/");
    return { ok: true, ...r, filmsAdded: Object.keys(movieIds).length };
  } catch (e) {
    if (schemaMissing(e as { code?: string })) return { ok: false, error: "Calendar sync isn't set up in the database yet (migration 20261007010000_calendar_syncs.sql). Nothing was changed." };
    console.error(e);
    return { ok: false, error: "Couldn't save the sync. Nothing was changed. Try again." };
  }
}

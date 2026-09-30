import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logOpsChange } from "./changes";
import { OFTEN_OUT_DAYS, OFTEN_OUT_TIMES, outReason, restockTaskText, type OftenOut, type OutageResolution, type RegisterOut } from "./shared";

// "Ran out" (86 it), the parts more than one screen needs: what's 86'd for
// the register's poll, putting items back on sale (the register's shopping
// list and "It's back", and Back office → Menu's Clear), and the managers'
// restock to-do each report makes (the register's shift bar, Back office →
// Team → To-dos). Not server actions: callers check who's asking first.

const db = () => createAdminClient();

// Menu items 86'd right now, and how many reports are open. Never throws:
// every register polls this each minute, and a failure (or a database
// without the migration yet) only means no OUT tags.
export async function currentOuts(): Promise<{ outs: RegisterOut[]; open: number }> {
  try {
    const supabase = db();
    const [items, open] = await Promise.all([
      supabase.from("menu_items").select("id, out_since, out_note, out_outage_id").not("out_since", "is", null),
      supabase.from("stock_outages").select("id, label").is("resolved_at", null),
    ]);
    if (items.error) return { outs: [], open: 0 };
    const labels = new Map((open.data ?? []).map((o) => [o.id as string, o.label as string]));
    return {
      outs: (items.data ?? []).map((i) => ({
        itemId: i.id as string,
        reason: (i.out_note as string | null) || "Out",
        since: i.out_since as string,
        outageId: (i.out_outage_id as string | null) ?? null,
        what: i.out_outage_id ? (labels.get(i.out_outage_id as string) ?? null) : null,
      })),
      open: open.error ? 0 : (open.data ?? []).length,
    };
  } catch {
    return { outs: [], open: 0 };
  }
}

// The menu items a resolved report was holding go back on sale, unless
// another open report stopped them too (out of hot dogs AND buns: buying
// buns doesn't put the hot dog back). Returns the names put back.
async function releaseItems(outageId: string): Promise<string[]> {
  const supabase = db();
  const { data: items } = await supabase.from("menu_items").select("id, name").eq("out_outage_id", outageId);
  if (!items?.length) return [];
  const ids = items.map((i) => i.id as string);
  const { data: others } = await supabase
    .from("stock_outages")
    .select("id, label, stopped_item_ids")
    .is("resolved_at", null)
    .neq("id", outageId)
    .overlaps("stopped_item_ids", ids)
    .order("reported_at", { ascending: false });
  const back: { id: string; name: string }[] = [];
  for (const it of items) {
    const other = (others ?? []).find((o) => ((o.stopped_item_ids as string[] | null) ?? []).includes(it.id as string));
    if (other) {
      await supabase
        .from("menu_items")
        .update({ out_note: outReason(other.label as string), out_outage_id: other.id })
        .eq("id", it.id)
        .eq("out_outage_id", outageId);
    } else {
      back.push({ id: it.id as string, name: it.name as string });
    }
  }
  if (back.length) {
    await supabase
      .from("menu_items")
      .update({ out_since: null, out_note: null, out_outage_id: null })
      .in("id", back.map((b) => b.id))
      .eq("out_outage_id", outageId);
  }
  return back.map((b) => b.name);
}

const RESOLVED: Record<OutageResolution, (what: string) => string> = {
  bought: (w) => `Bought ${w}`,
  found: (w) => `Found more ${w}`,
  mistake: (w) => `${w}: false alarm`,
};

export type ResolveResult = { ok: true; label: string; back: string[]; already: boolean } | { ok: false; error: string };

// Closes an open report (Bought it, Found some, False alarm) and puts the
// items it stopped back on sale, and ticks off its restock to-do. A report
// someone else already closed is fine: nothing changes (except a to-do left
// open by a failure part way, which is ticked off now).
export async function closeOutage(outageId: string, resolution: OutageResolution, by: string | null): Promise<ResolveResult> {
  const supabase = db();
  const { data, error } = await supabase
    .from("stock_outages")
    .update({ resolved_at: new Date().toISOString(), resolved_by: by, resolution })
    .eq("id", outageId)
    .is("resolved_at", null)
    .select("id, label")
    .maybeSingle();
  if (error) {
    console.error("ran out: resolve failed", error);
    return { ok: false, error: "Couldn't save that. Try again." };
  }
  if (!data) {
    const { data: row } = await supabase.from("stock_outages").select("label, resolved_at").eq("id", outageId).maybeSingle();
    if (row?.resolved_at) await closeRestockTodo(outageId, by);
    return row ? { ok: true, label: row.label as string, back: [], already: true } : { ok: false, error: "That report isn't there anymore." };
  }
  const label = data.label as string;
  const back = await releaseItems(outageId);
  await closeRestockTodo(outageId, by);
  await logOpsChange("outage", outageId, "resolved", [RESOLVED[resolution](label), back.length ? `back on sale: ${back.join(", ")}` : ""].filter(Boolean).join(" · "), by);
  return { ok: true, label, back, already: false };
}

// ---------- the managers' restock to-do ----------

// Every report makes one to-do for the managers (anyone with manager access
// or above): "Buy Hot dog buns at Walmart", with when it ran out, who said
// so, the par, and a nudge when it keeps happening. The cashier who
// reported it can't go shopping mid-shift; a manager makes sure it's bought
// and that the par is enough. staff_todos.outage_id is unique, so a second
// report of the same line (which adds to the open report) or two registers
// at once never make a second one.

const DAY_MS = 86_400_000;
const likeText = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// A report's to-do, made if it hasn't got one. False when there's none
// (the report is closed, or saving it failed).
export async function ensureRestockTodo(outageId: string): Promise<boolean> {
  const supabase = db();
  const { data: have } = await supabase.from("staff_todos").select("id").eq("outage_id", outageId).maybeSingle();
  if (have) return true;
  const { data: o } = await supabase
    .from("stock_outages")
    .select("id, par_item_id, label, reported_at, reported_by, resolved_at, item:par_items(name, par_qty, unit, unit_size, source)")
    .eq("id", outageId)
    .maybeSingle();
  if (!o || o.resolved_at) return false;
  const item = o.item as unknown as { name: string; par_qty: number | null; unit: string | null; unit_size: string | null; source: string | null } | null;
  const reportedAt = o.reported_at as string;

  // This report and the ones before it in the 30 days up to it, false
  // alarms left out: the same par line, or the same words if it isn't on
  // the sheet.
  let times = supabase
    .from("stock_outages")
    .select("id", { count: "exact", head: true })
    .gte("reported_at", new Date(Date.parse(reportedAt) - OFTEN_OUT_DAYS * DAY_MS).toISOString())
    .lte("reported_at", reportedAt)
    .or("resolution.is.null,resolution.neq.mistake");
  times = o.par_item_id ? times.eq("par_item_id", o.par_item_id) : times.is("par_item_id", null).ilike("label", likeText(o.label as string));
  const [{ count }, { data: staff }] = await Promise.all([times, supabase.from("employees").select("id, name")]);

  const people = (staff ?? []).map((e) => ({ id: e.id as string, name: (e.name as string).trim() }));
  const source = item?.source?.trim() || null;
  // "Andrew" on the par sheet's store is a person who brings it in.
  const sourceIsPerson = !!source && people.some((p) => p.name.toLowerCase() === source.toLowerCase() || p.name.split(/\s+/)[0].toLowerCase() === source.toLowerCase());
  const reporter = o.reported_by ? people.find((p) => p.id === o.reported_by) : undefined;
  const { title, details } = restockTaskText({
    what: item?.name ?? (o.label as string),
    onSheet: !!item,
    source,
    sourceIsPerson,
    reportedAt,
    byName: reporter ? reporter.name.split(/\s+/)[0] : null,
    parQty: item?.par_qty === null || item?.par_qty === undefined ? null : Number(item.par_qty),
    unit: item?.unit ?? null,
    unitSize: item?.unit_size ?? null,
    times: Math.max(1, count ?? 1),
  });
  const { error } = await supabase
    .from("staff_todos")
    .insert({ title, details, audience: "managers", outage_id: outageId, created_by: (o.reported_by as string | null) ?? null });
  // 23505: another register made it a moment ago.
  if (error && error.code !== "23505") {
    console.error("ran out: restock to-do failed", error);
    return false;
  }
  return true;
}

async function closeRestockTodo(outageId: string, by: string | null) {
  const { error } = await db().from("staff_todos").update({ done_at: new Date().toISOString(), done_by: by }).eq("outage_id", outageId).is("done_at", null);
  if (error) console.error("ran out: ticking off the restock to-do failed", error);
}

export type TodoDoneResult = { ok: true; restock: { what: string; back: string[] } | null } | { ok: false; error: string };

// Done on a to-do, from the register or Back office → Team. A restock
// to-do's Done means it was bought: its report is closed as bought (the same
// as Bought it on the shopping list), which puts what it stopped back on
// sale and ticks the to-do off. Safe to tap twice, or on two screens at once.
export async function finishTodo(todoId: string, by: string | null): Promise<TodoDoneResult> {
  const supabase = db();
  const { data: t, error } = await supabase.from("staff_todos").select("id, outage_id").eq("id", todoId).maybeSingle();
  if (error) return { ok: false, error: "Couldn't mark that done. Try again." };
  if (!t) return { ok: false, error: "That to-do isn't there anymore." };
  if (t.outage_id) {
    const r = await closeOutage(t.outage_id as string, "bought", by);
    if (!r.ok) return r;
    return { ok: true, restock: { what: r.label, back: r.back } };
  }
  const { error: saveError } = await supabase.from("staff_todos").update({ done_at: new Date().toISOString(), done_by: by }).eq("id", todoId).is("done_at", null);
  return saveError ? { ok: false, error: "Couldn't mark that done. Try again." } : { ok: true, restock: null };
}

const CLOSED_WITH_REPORT = "That to-do closed with its Ran out report. If it's still out, report it again on the register.";

// Undo, or Reopen in the back office. Not for a restock to-do: it closed
// with its report, and reopening it wouldn't stop the items again.
export async function reopenTodo(todoId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = db();
  const { data: t } = await supabase.from("staff_todos").select("id, outage_id").eq("id", todoId).maybeSingle();
  if (!t) return { ok: false, error: "That to-do isn't there anymore." };
  if (t.outage_id) return { ok: false, error: CLOSED_WITH_REPORT };
  const { error } = await supabase.from("staff_todos").update({ done_at: null, done_by: null }).eq("id", todoId);
  return error ? { ok: false, error: "Couldn't undo that. Try again." } : { ok: true };
}

// Remove, in the back office. A restock to-do whose report is still open
// stays: it's how the managers know to buy it.
export async function removeTodo(todoId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = db();
  const { data: t } = await supabase.from("staff_todos").select("id, done_at, outage:stock_outages(resolved_at)").eq("id", todoId).maybeSingle();
  if (!t) return { ok: true };
  const outage = t.outage as unknown as { resolved_at: string | null } | null;
  if (outage && !outage.resolved_at) {
    return { ok: false, error: "That's a Ran out to-do. Tap Bought it once it's bought, or close the report on the register's shopping list (Found some, False alarm)." };
  }
  const { error } = await supabase.from("staff_todos").delete().eq("id", todoId);
  return error ? { ok: false, error: "Couldn't remove that. Try again." } : { ok: true };
}

// ---------- par lines that keep running out ----------

// A report in the window, with its par line as it is now.
export interface OutageForPar {
  par_item_id: string;
  reported_at: string;
  item: { name: string; area: string; par_qty: number | string | null; unit: string | null; unit_size: string | null; active: boolean; updated_at: string | null } | null;
}

// Par lines reported out OFTEN_OUT_TIMES or more times in the last
// OFTEN_OUT_DAYS days (false alarms left out), most often first, for a
// "Raise par?" nudge to the managers. Nothing changes the par by itself.
// A line edited since it last ran out drops off (someone's looked at it)
// until it runs out again. Never throws: it's a hint.
export async function getOftenOut(now = new Date()): Promise<OftenOut[]> {
  try {
    return summarizeOftenOut(await recentParOutages(now));
  } catch {
    return [];
  }
}

// Reports of par lines in the OFTEN_OUT_DAYS days up to `now`, false alarms
// left out.
export async function recentParOutages(now = new Date()): Promise<OutageForPar[]> {
  const { data, error } = await db()
    .from("stock_outages")
    .select("par_item_id, reported_at, item:par_items(name, area, par_qty, unit, unit_size, active, updated_at)")
    .not("par_item_id", "is", null)
    .gte("reported_at", new Date(now.getTime() - OFTEN_OUT_DAYS * DAY_MS).toISOString())
    .lte("reported_at", now.toISOString())
    .or("resolution.is.null,resolution.neq.mistake");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as OutageForPar[];
}

// The counting part of getOftenOut, on reports already picked out (the
// window, false alarms left out).
export function summarizeOftenOut(rows: OutageForPar[]): OftenOut[] {
  const byLine = new Map<string, OftenOut & { editedAt: string | null; active: boolean }>();
  for (const r of rows) {
    if (!r.item) continue;
    const had = byLine.get(r.par_item_id);
    if (had) {
      had.times++;
      if (Date.parse(r.reported_at) > Date.parse(had.lastAt)) had.lastAt = r.reported_at;
      continue;
    }
    byLine.set(r.par_item_id, {
      parItemId: r.par_item_id,
      name: r.item.name,
      area: r.item.area,
      times: 1,
      days: OFTEN_OUT_DAYS,
      lastAt: r.reported_at,
      parQty: r.item.par_qty === null ? null : Number(r.item.par_qty),
      unit: r.item.unit,
      unitSize: r.item.unit_size,
      editedAt: r.item.updated_at,
      active: r.item.active,
    });
  }
  return [...byLine.values()]
    .filter((o) => o.active && o.times >= OFTEN_OUT_TIMES && !(o.editedAt && Date.parse(o.editedAt) > Date.parse(o.lastAt)))
    .sort((a, b) => b.times - a.times || Date.parse(b.lastAt) - Date.parse(a.lastAt))
    .map((o) => ({ parItemId: o.parItemId, name: o.name, area: o.area, times: o.times, days: o.days, lastAt: o.lastAt, parQty: o.parQty, unit: o.unit, unitSize: o.unitSize }));
}

// One menu item back on sale ("It's back" on the register, Clear in Back
// office → Menu). Its report, if any, stays on the shopping list.
export async function putBackOnSale(itemId: string, by: string | null): Promise<{ ok: true; name: string; wasOut: boolean } | { ok: false; error: string }> {
  const supabase = db();
  const { data: item } = await supabase.from("menu_items").select("id, name, out_since").eq("id", itemId).maybeSingle();
  if (!item) return { ok: false, error: "That item isn't on the menu anymore." };
  if (!item.out_since) return { ok: true, name: item.name as string, wasOut: false };
  const { error } = await supabase.from("menu_items").update({ out_since: null, out_note: null, out_outage_id: null }).eq("id", itemId);
  if (error) {
    console.error("ran out: clear failed", error);
    return { ok: false, error: "Couldn't put it back on sale. Try again." };
  }
  await logOpsChange("menu_item", itemId, "restored", `${item.name} back on sale`, by);
  return { ok: true, name: item.name as string, wasOut: true };
}

"use server";

import { assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowAttempt } from "@/lib/rate-limit";
import { logOpsChange } from "@/lib/ops/changes";
import { closeOutage, putBackOnSale } from "@/lib/ops/outages";
import {
  OUT_ITEMS_MAX,
  OUT_LABEL_MAX,
  OUT_NOTE_MAX,
  outReason,
  type OpenOutage,
  type OutageResolution,
  type RanOutOptions,
  type Result,
} from "@/lib/ops/shared";

// "Ran out" (86 it) on the register: report that something ran out
// mid-shift, stop selling the menu items that need it, and put it at the
// top of the shopping list until someone buys it. Staff-only, like the rest
// of the shift tools; `employeeId` is whoever's using the register (same
// trust model as orders), checked against the staff list.

const db = () => createAdminClient();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const BUSY = "Too many tries just now. Wait a minute and try again.";
const RESOLUTIONS: OutageResolution[] = ["bought", "found", "mistake"];

async function actingEmployee(id: unknown): Promise<string | null> {
  if (!isId(id)) return null;
  const { data } = await db().from("employees").select("id").eq("id", id).eq("active", true).neq("role", "display").maybeSingle();
  return data ? (data.id as string) : null;
}

async function validShift(id: unknown): Promise<string | null> {
  if (!isId(id)) return null;
  const { data } = await db().from("shifts").select("id").eq("id", id).maybeSingle();
  return data ? (data.id as string) : null;
}

async function firstNames(): Promise<Map<string, string>> {
  const { data } = await db().from("employees").select("id, name");
  return new Map((data ?? []).map((e) => [e.id as string, (e.name as string).split(" ")[0]]));
}

// Everything the "Ran out" sheet picks from: the par sheet, the register's
// menu, which menu items' recipes use each par line, and what's already out.
export async function getRanOutOptions(): Promise<RanOutOptions> {
  await assertStaff();
  const supabase = db();
  const [par, items, cats, linked, open, names] = await Promise.all([
    supabase.from("par_items").select("id, area, section, name, par_qty, unit, source").eq("active", true).order("sort_order"),
    supabase.from("menu_items").select("id, name, category_id, out_since").eq("active", true).order("sort_order"),
    supabase.from("menu_categories").select("id, key, label, parent_id, sort_order").order("sort_order"),
    supabase.from("ingredients").select("id, par_item_id").not("par_item_id", "is", null),
    supabase.from("stock_outages").select("par_item_id, reported_at, reported_by").is("resolved_at", null).not("par_item_id", "is", null),
    firstNames(),
  ]);

  // Menu items in register order (category, then item), without tickets.
  type Cat = { id: string; key: string; label: string; parent_id: string | null; sort_order: number };
  const catRows = (cats.data ?? []) as Cat[];
  const catById = new Map(catRows.map((c) => [c.id, c]));
  const top = (c: Cat): Cat => (c.parent_id ? (catById.get(c.parent_id) ?? c) : c);
  const rank = (c: Cat) => [top(c).sort_order, c.parent_id ? c.sort_order + 1 : 0];
  const menu = (items.data ?? [])
    .map((i) => ({ i, c: catById.get(i.category_id as string) }))
    .filter((x): x is { i: typeof x.i; c: Cat } => !!x.c && top(x.c).key !== "tickets")
    .map((x, idx) => ({ ...x, idx }))
    .sort((a, b) => {
      const [a1, a2] = rank(a.c);
      const [b1, b2] = rank(b.c);
      return a1 - b1 || a2 - b2 || a.idx - b.idx;
    })
    .map(({ i, c }) => ({
      id: i.id as string,
      name: i.name as string,
      category: c.parent_id ? `${top(c).label} › ${c.label}` : c.label,
      outSince: (i.out_since as string | null) ?? null,
    }));

  // Par line → menu items whose recipe uses it (via the ingredient's link).
  const recipeUses: Record<string, string[]> = {};
  const parOf = new Map((linked.data ?? []).map((l) => [l.id as string, l.par_item_id as string]));
  if (parOf.size) {
    const { data: lines } = await supabase.from("recipe_ingredients").select("ingredient_id, recipe:recipes(menu_item_id)").in("ingredient_id", [...parOf.keys()]);
    const onMenu = new Set(menu.map((m) => m.id));
    for (const l of (lines ?? []) as unknown as { ingredient_id: string; recipe: { menu_item_id: string } | null }[]) {
      const p = parOf.get(l.ingredient_id);
      const m = l.recipe?.menu_item_id;
      if (!p || !m || !onMenu.has(m)) continue;
      recipeUses[p] = [...new Set([...(recipeUses[p] ?? []), m])];
    }
  }

  const openByPar: RanOutOptions["open"] = {};
  for (const o of open.data ?? []) {
    openByPar[o.par_item_id as string] = { at: o.reported_at as string, byName: o.reported_by ? (names.get(o.reported_by as string) ?? null) : null };
  }

  return {
    parItems: (par.data ?? []).map((p) => ({
      id: p.id as string,
      area: p.area as string,
      section: (p.section as string | null) ?? null,
      name: p.name as string,
      par_qty: p.par_qty === null ? null : Number(p.par_qty),
      unit: (p.unit as string | null) ?? null,
      source: (p.source as string | null) ?? null,
    })),
    menu,
    recipeUses,
    open: openByPar,
  };
}

export interface ReportOutageInput {
  parItemId: string | null; // a par sheet line, or
  label: string | null; // something that isn't on the sheet
  note: string | null;
  menuItemIds: string[]; // stop selling these
}

// "We're out of X." Stops the ticked menu items and lands on the shopping
// list. Reporting a par line that's already out adds to that report.
export async function reportOutage(
  input: ReportOutageInput,
  employeeId: string | null,
  shiftId: string | null,
): Promise<Result<{ outageId: string; name: string; stopped: string[]; added: boolean }>> {
  const staff = await assertStaff();
  if (!(await allowAttempt(`ran-out:${staff.employeeId}`, 20, 300))) return { ok: false, error: BUSY };
  if (!input || typeof input !== "object") return { ok: false, error: "Say what ran out." };

  const parItemId = input.parItemId === null || input.parItemId === undefined ? null : isId(input.parItemId) ? input.parItemId.toLowerCase() : false;
  if (parItemId === false) return { ok: false, error: "Pick what ran out again." };
  const typed = typeof input.label === "string" ? input.label.replace(/\s+/g, " ").trim() : "";
  if (!parItemId && !typed) return { ok: false, error: "Say what ran out." };
  if (typed.length > OUT_LABEL_MAX) return { ok: false, error: `Keep what ran out under ${OUT_LABEL_MAX} characters.` };
  if (input.note !== null && input.note !== undefined && typeof input.note !== "string") return { ok: false, error: "That note didn't come through. Try again." };
  const note = (input.note ?? "").trim();
  if (note.length > OUT_NOTE_MAX) return { ok: false, error: `Keep the note under ${OUT_NOTE_MAX} characters.` };
  if (!Array.isArray(input.menuItemIds) || input.menuItemIds.length > OUT_ITEMS_MAX || !input.menuItemIds.every(isId)) {
    return { ok: false, error: "Those menu items didn't come through. Close this and try again." };
  }
  const menuIds = [...new Set(input.menuItemIds.map((id) => id.toLowerCase()))];

  const supabase = db();
  // Typed: "napkins" reads as "Napkins" on the shopping list.
  let label = typed.charAt(0).toUpperCase() + typed.slice(1);
  if (parItemId) {
    const { data: p } = await supabase.from("par_items").select("id, name").eq("id", parItemId).maybeSingle();
    if (!p) return { ok: false, error: "That isn't on the par sheet anymore. Close this and try again." };
    label = (p.name as string).trim().slice(0, OUT_LABEL_MAX);
  }
  let stoppedNames: string[] = [];
  if (menuIds.length) {
    const { data: items } = await supabase.from("menu_items").select("id, name").in("id", menuIds);
    if ((items ?? []).length !== menuIds.length) return { ok: false, error: "One of those menu items isn't on the menu anymore. Close this and try again." };
    const byId = new Map((items ?? []).map((i) => [i.id as string, i.name as string]));
    stoppedNames = menuIds.map((id) => byId.get(id) ?? "item");
  }
  const [by, shift] = await Promise.all([actingEmployee(employeeId), validShift(shiftId)]);

  // A par line already reported out: add to that report instead.
  const existingFor = async () =>
    parItemId
      ? (await supabase.from("stock_outages").select("id, note, stopped_item_ids").eq("par_item_id", parItemId).is("resolved_at", null).maybeSingle()).data
      : null;
  let existing = await existingFor();
  let outageId = existing ? (existing.id as string) : null;
  if (!existing) {
    const { data, error } = await supabase
      .from("stock_outages")
      .insert({ par_item_id: parItemId, label, note: note || null, stopped_item_ids: menuIds, reported_by: by, shift_id: shift })
      .select("id")
      .single();
    if (error?.code === "23505") {
      // Reported on the other register a moment ago.
      existing = await existingFor();
      outageId = existing ? (existing.id as string) : null;
    } else if (!error && data) {
      outageId = data.id as string;
    }
    if (!outageId) {
      console.error("ran out: report failed", error);
      return { ok: false, error: "Couldn't save that. Try again." };
    }
  }
  if (!outageId) return { ok: false, error: "Couldn't save that. Try again." };
  let newlyStopped = stoppedNames;
  if (existing) {
    const had = new Set((existing.stopped_item_ids as string[] | null) ?? []);
    newlyStopped = menuIds.filter((id) => !had.has(id)).map((id) => stoppedNames[menuIds.indexOf(id)]);
    const oldNote = (existing.note as string | null) ?? "";
    const mergedNote = note && !oldNote.includes(note) ? (oldNote ? `${oldNote} / ${note}` : note).slice(0, OUT_NOTE_MAX) : oldNote || null;
    const { error } = await supabase
      .from("stock_outages")
      .update({ stopped_item_ids: [...new Set([...had, ...menuIds])], note: mergedNote })
      .eq("id", outageId);
    if (error) {
      console.error("ran out: update failed", error);
      return { ok: false, error: "Couldn't save that. Try again." };
    }
  }

  if (menuIds.length) {
    const reason = outReason(label);
    const [a, b] = await Promise.all([
      supabase.from("menu_items").update({ out_note: reason, out_outage_id: outageId }).in("id", menuIds),
      supabase.from("menu_items").update({ out_since: new Date().toISOString() }).in("id", menuIds).is("out_since", null),
    ]);
    if (a.error || b.error) {
      console.error("ran out: stopping items failed", a.error ?? b.error);
      return { ok: false, error: `${label} is on the shopping list, but the menu didn't update. Tap Save again.` };
    }
  }

  const stopped = newlyStopped.length ? `stopped ${newlyStopped.join(", ")}` : "";
  if (!existing) await logOpsChange("outage", outageId, "reported", [`Ran out of ${label}`, stopped].filter(Boolean).join(" · "), by);
  else if (stopped) await logOpsChange("outage", outageId, "changed", [`Still out of ${label}`, stopped].join(" · "), by);
  return { ok: true, outageId, name: label, stopped: stoppedNames, added: !existing };
}

// Open reports, oldest first, for the top of the shopping list.
export async function getOpenOutages(): Promise<OpenOutage[]> {
  await assertStaff();
  const supabase = db();
  const [{ data, error }, names] = await Promise.all([
    supabase
      .from("stock_outages")
      .select("id, par_item_id, label, note, reported_at, reported_by, item:par_items(name, area, par_qty, unit, source)")
      .is("resolved_at", null)
      .order("reported_at"),
    firstNames(),
  ]);
  if (error) throw new Error("Couldn't load what ran out.");
  type Row = {
    id: string;
    par_item_id: string | null;
    label: string;
    note: string | null;
    reported_at: string;
    reported_by: string | null;
    item: { name: string; area: string; par_qty: number | null; unit: string | null; source: string | null } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const stopped = new Map<string, string[]>();
  if (rows.length) {
    const { data: items } = await supabase.from("menu_items").select("name, out_outage_id").in("out_outage_id", rows.map((r) => r.id)).order("sort_order");
    for (const i of items ?? []) stopped.set(i.out_outage_id as string, [...(stopped.get(i.out_outage_id as string) ?? []), i.name as string]);
  }
  return rows.map((r) => ({
    id: r.id,
    parItemId: r.par_item_id,
    name: r.item?.name ?? r.label,
    area: r.item?.area ?? null,
    source: r.item?.source ?? null,
    parQty: r.item?.par_qty === null || r.item?.par_qty === undefined ? null : Number(r.item.par_qty),
    unit: r.item?.unit ?? null,
    note: r.note,
    reportedAt: r.reported_at,
    byName: r.reported_by ? (names.get(r.reported_by) ?? null) : null,
    stopped: stopped.get(r.id) ?? [],
  }));
}

// Bought it / Found some / False alarm, from the shopping list. Puts the
// items it stopped back on sale.
export async function resolveOutage(outageId: string, resolution: OutageResolution, employeeId: string | null): Promise<Result<{ back: string[] }>> {
  const staff = await assertStaff();
  if (!isId(outageId) || !RESOLUTIONS.includes(resolution)) return { ok: false, error: "That didn't come through. Close this and try again." };
  if (!(await allowAttempt(`ran-out-fix:${staff.employeeId}`, 60, 60))) return { ok: false, error: BUSY };
  const r = await closeOutage(outageId.toLowerCase(), resolution, await actingEmployee(employeeId));
  return r.ok ? { ok: true, back: r.back } : r;
}

// "It's back" on an 86'd menu button. With `resolution`, the report that
// stopped it is closed too (someone bought more, or found some), which puts
// anything else it stopped back on sale.
export async function markItemBack(menuItemId: string, resolution: "bought" | "found" | null, employeeId: string | null): Promise<Result> {
  const staff = await assertStaff();
  if (!isId(menuItemId) || !(resolution === null || resolution === "bought" || resolution === "found")) return { ok: false, error: "That didn't come through. Try again." };
  if (!(await allowAttempt(`ran-out-fix:${staff.employeeId}`, 60, 60))) return { ok: false, error: BUSY };
  const id = menuItemId.toLowerCase();
  const by = await actingEmployee(employeeId);
  if (resolution) {
    const { data: item } = await db().from("menu_items").select("out_outage_id").eq("id", id).maybeSingle();
    if (item?.out_outage_id) {
      const r = await closeOutage(item.out_outage_id as string, resolution, by);
      if (!r.ok) return r;
    }
  }
  // Also when another open report still held it: staff say it's back.
  const r = await putBackOnSale(id, by);
  return r.ok ? { ok: true } : r;
}

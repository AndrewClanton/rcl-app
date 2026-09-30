import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logOpsChange } from "./changes";
import { outReason, type OutageResolution, type RegisterOut } from "./shared";

// "Ran out" (86 it), the parts more than one screen needs: what's 86'd for
// the register's poll, and putting items back on sale (the register's
// shopping list and "It's back", and Back office → Menu's Clear). Not server
// actions: callers check who's asking first.

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
// items it stopped back on sale. A report someone else already closed is
// fine: nothing changes.
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
    const { data: row } = await supabase.from("stock_outages").select("label").eq("id", outageId).maybeSingle();
    return row ? { ok: true, label: row.label as string, back: [], already: true } : { ok: false, error: "That report isn't there anymore." };
  }
  const label = data.label as string;
  const back = await releaseItems(outageId);
  await logOpsChange("outage", outageId, "resolved", [RESOLVED[resolution](label), back.length ? `back on sale: ${back.join(", ")}` : ""].filter(Boolean).join(" · "), by);
  return { ok: true, label, back, already: false };
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

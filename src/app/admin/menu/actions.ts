"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/slugify";
import type { ModifierType, EventPriceMode } from "@/lib/types";

// All writes here use the service-role client and bypass RLS. Menu tables
// are public-read (see the initial migration); write access is gated by
// this being a server-only module until staff auth + real RLS policies for
// the /admin surface are built.

function revalidate() {
  revalidatePath("/admin/menu");
  revalidatePath("/menu");
}

// ---------- categories ----------

export async function addCategory(label: string) {
  const name = label.trim();
  if (!name) return;
  const supabase = createAdminClient();
  const { count } = await supabase.from("menu_categories").select("id", { count: "exact", head: true }).is("parent_id", null);
  await supabase.from("menu_categories").insert({ key: slugify(name), label: name, sort_order: count ?? 0 });
  revalidate();
}

export async function addSubcategory(parentId: string, label: string) {
  const name = label.trim();
  if (!name) return;
  const supabase = createAdminClient();
  const { count } = await supabase.from("menu_categories").select("id", { count: "exact", head: true }).eq("parent_id", parentId);
  await supabase.from("menu_categories").insert({ key: slugify(name), label: name, parent_id: parentId, sort_order: count ?? 0 });
  revalidate();
}

export async function renameCategory(id: string, label: string) {
  const name = label.trim();
  if (!name) return;
  const supabase = createAdminClient();
  await supabase.from("menu_categories").update({ label: name }).eq("id", id);
  revalidate();
}

export async function deleteCategory(id: string) {
  const supabase = createAdminClient();
  // ON DELETE CASCADE handles subcategories, items, modifier groups/options.
  await supabase.from("menu_categories").delete().eq("id", id);
  revalidate();
}

export async function reorderCategory(id: string, direction: "up" | "down", siblingIds: string[]) {
  const idx = siblingIds.indexOf(id);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (idx === -1 || swapWith < 0 || swapWith >= siblingIds.length) return;

  const supabase = createAdminClient();
  const { data: rows } = await supabase
    .from("menu_categories")
    .select("id, sort_order")
    .in("id", [siblingIds[idx], siblingIds[swapWith]]);
  if (!rows || rows.length !== 2) return;

  const [a, b] = rows;
  await Promise.all([
    supabase.from("menu_categories").update({ sort_order: b.sort_order }).eq("id", a.id),
    supabase.from("menu_categories").update({ sort_order: a.sort_order }).eq("id", b.id),
  ]);
  revalidate();
}

// ---------- items ----------

export async function addItem(categoryId: string, name: string, price: number) {
  const trimmed = name.trim();
  if (!trimmed || !(price >= 0)) return;
  const supabase = createAdminClient();
  const { count } = await supabase.from("menu_items").select("id", { count: "exact", head: true }).eq("category_id", categoryId);
  await supabase.from("menu_items").insert({ category_id: categoryId, name: trimmed, price, sort_order: count ?? 0 });
  revalidate();
}

export async function updateItem(
  id: string,
  fields: Partial<{ name: string; price: number; is_alcohol: boolean; is_event_item: boolean; event_price_mode: EventPriceMode | null; active: boolean }>
) {
  const supabase = createAdminClient();
  await supabase.from("menu_items").update(fields).eq("id", id);
  revalidate();
}

export async function deleteItem(id: string) {
  const supabase = createAdminClient();
  await supabase.from("menu_items").delete().eq("id", id);
  revalidate();
}

// ---------- modifier groups & options ----------

export async function addModifierGroup(itemId: string, label: string, type: ModifierType) {
  const name = label.trim();
  if (!name) return;
  const supabase = createAdminClient();
  const { count } = await supabase.from("menu_modifier_groups").select("id", { count: "exact", head: true }).eq("item_id", itemId);
  await supabase.from("menu_modifier_groups").insert({ item_id: itemId, key: slugify(name), label: name, type, sort_order: count ?? 0 });
  revalidate();
}

export async function deleteModifierGroup(id: string) {
  const supabase = createAdminClient();
  await supabase.from("menu_modifier_groups").delete().eq("id", id);
  revalidate();
}

export async function addModifierOption(groupId: string, name: string, priceDelta: number) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const supabase = createAdminClient();
  const { count } = await supabase.from("menu_modifier_options").select("id", { count: "exact", head: true }).eq("group_id", groupId);
  await supabase.from("menu_modifier_options").insert({ group_id: groupId, name: trimmed, price_delta: priceDelta || 0, sort_order: count ?? 0 });
  revalidate();
}

export async function updateModifierOption(id: string, fields: Partial<{ name: string; price_delta: number }>) {
  const supabase = createAdminClient();
  await supabase.from("menu_modifier_options").update(fields).eq("id", id);
  revalidate();
}

export async function deleteModifierOption(id: string) {
  const supabase = createAdminClient();
  await supabase.from("menu_modifier_options").delete().eq("id", id);
  revalidate();
}

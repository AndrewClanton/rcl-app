import { createClient } from "@/lib/supabase/server";
import type { MenuCategory, MenuItem, ModifierGroup, ModifierOption } from "@/lib/types";

// Fetches the full menu as a tree (top-level categories -> optional
// subcategories -> items -> modifier groups -> options), mirroring the
// shape of rcl-pos.html's MENU_DATA. Four flat queries + in-memory assembly
// instead of one deeply nested PostgREST embed, so ordering and the
// self-referential category->subcategory relationship stay simple.
export async function getMenuTree(): Promise<MenuCategory[]> {
  const supabase = await createClient();

  const [{ data: categories, error: catErr }, { data: items, error: itemErr }, { data: groups, error: grpErr }, { data: options, error: optErr }] =
    await Promise.all([
      supabase.from("menu_categories").select("*").order("sort_order"),
      supabase.from("menu_items").select("*").order("sort_order"),
      supabase.from("menu_modifier_groups").select("*").order("sort_order"),
      supabase.from("menu_modifier_options").select("*").order("sort_order"),
    ]);

  if (catErr) throw catErr;
  if (itemErr) throw itemErr;
  if (grpErr) throw grpErr;
  if (optErr) throw optErr;

  const optionsByGroup = new Map<string, ModifierOption[]>();
  for (const o of options ?? []) {
    const list = optionsByGroup.get(o.group_id) ?? [];
    list.push(o);
    optionsByGroup.set(o.group_id, list);
  }

  const groupsByItem = new Map<string, ModifierGroup[]>();
  for (const g of groups ?? []) {
    const list = groupsByItem.get(g.item_id) ?? [];
    list.push({ ...g, options: optionsByGroup.get(g.id) ?? [] });
    groupsByItem.set(g.item_id, list);
  }

  const itemsByCategory = new Map<string, MenuItem[]>();
  for (const i of items ?? []) {
    const list = itemsByCategory.get(i.category_id) ?? [];
    list.push({ ...i, modifier_groups: groupsByItem.get(i.id) ?? [] });
    itemsByCategory.set(i.category_id, list);
  }

  const byId = new Map<string, MenuCategory>();
  for (const c of categories ?? []) {
    byId.set(c.id, { ...c, items: itemsByCategory.get(c.id) ?? [], subcategories: [] });
  }

  const roots: MenuCategory[] = [];
  for (const c of categories ?? []) {
    const node = byId.get(c.id)!;
    if (c.parent_id) {
      byId.get(c.parent_id)?.subcategories.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

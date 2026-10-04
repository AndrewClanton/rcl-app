import "server-only";
import { after } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fillMissingPictures } from "@/lib/menu-pictures/found";
import type { PhotoTarget } from "@/lib/menu-pictures/shared";

// Adding a menu item, shared by Back office → Menu (addItem) and the Bar
// Book's "Make this a menu item": last in its category, then its picture
// is looked for in the background. The callers check who's asking.
export async function insertMenuItem(fields: { categoryId: string; name: string; price: number; isAlcohol: boolean }): Promise<{ id: string | null; error: PostgrestError | null }> {
  const supabase = createAdminClient();
  const { count } = await supabase.from("menu_items").select("id", { count: "exact", head: true }).eq("category_id", fields.categoryId);
  const { data: added, error } = await supabase
    .from("menu_items")
    .insert({ category_id: fields.categoryId, name: fields.name, price: fields.price, is_alcohol: fields.isAlcohol, sort_order: count ?? 0 })
    .select("id")
    .maybeSingle();
  return { id: (added?.id as string | undefined) ?? null, error };
}

// A new item gets a picture on its own, once the page has its answer: found
// and put on unapproved, for the Photo walk. Never fails the add: without
// one, the button shows its label tile.
export function findPictureLater(target: PhotoTarget, id: string | null | undefined) {
  if (!id) return;
  after(async () => {
    try {
      await fillMissingPictures({ only: { target, id } });
    } catch (e) {
      console.error("menu: no picture found for the new", target, e);
    }
  });
}

import { getMenuTree } from "@/lib/data/menu";
import { getIngredients } from "@/lib/data/ingredients";
import { getRecipesByItem } from "@/lib/data/recipes";
import { hasManagerAccess, requireStaff } from "@/lib/auth";
import MenuManager from "./MenuManager";

export const dynamic = "force-dynamic";

// Everyone on staff can look things up here (prices, recipes, what's
// hidden); only managers and up can change anything. The actions check
// that again on their own.
export default async function AdminMenuPage() {
  const staff = await requireStaff();
  const [categories, ingredients, recipesByItem] = await Promise.all([getMenuTree(), getIngredients(), getRecipesByItem()]);
  const canEdit = hasManagerAccess(staff.role);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ">
      {!canEdit && <p className="notice mb-4 text-sm">You can look through the menu here. Changing it (prices, items, recipes) takes a manager.</p>}
      <MenuManager categories={categories} ingredients={ingredients} recipesByItem={recipesByItem} canEdit={canEdit} />
    </div>
  );
}

import { getMenuTree } from "@/lib/data/menu";
import { getIngredients } from "@/lib/data/ingredients";
import { getRecipesByItem } from "@/lib/data/recipes";
import MenuManager from "./MenuManager";

export const dynamic = "force-dynamic";

export default async function AdminMenuPage() {
  const [categories, ingredients, recipesByItem] = await Promise.all([getMenuTree(), getIngredients(), getRecipesByItem()]);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ">
      <MenuManager categories={categories} ingredients={ingredients} recipesByItem={recipesByItem} />
    </div>
  );
}

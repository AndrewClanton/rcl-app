import { getMenuTree } from "@/lib/data/menu";
import { getIngredients } from "@/lib/data/ingredients";
import { getRecipesByItem } from "@/lib/data/recipes";
import MenuManager from "./MenuManager";

export const dynamic = "force-dynamic";

export default async function AdminMenuPage() {
  const [categories, ingredients, recipesByItem] = await Promise.all([getMenuTree(), getIngredients(), getRecipesByItem()]);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
      <MenuManager categories={categories} ingredients={ingredients} recipesByItem={recipesByItem} />
    </div>
  );
}

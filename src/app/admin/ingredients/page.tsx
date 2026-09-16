import { getIngredientsWithLastCount } from "@/lib/data/ingredients";
import IngredientManager from "./IngredientManager";

export const dynamic = "force-dynamic";

export default async function AdminIngredientsPage() {
  const ingredients = await getIngredientsWithLastCount();
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Ingredients & inventory</h1>
      <p className="mb-4 text-sm text-neutral-500">
        The shared ingredient catalog used by recipes (see Menu → an alcohol item → Recipe). Log a physical count here whenever someone
        counts the shelf -- the Reports page compares counts over time against recipe-based expected usage to flag overpour/waste.
      </p>
      <IngredientManager ingredients={ingredients} />
    </div>
  );
}

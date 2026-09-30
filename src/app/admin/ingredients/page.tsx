import { getIngredientsWithLastCount, getParItemRefs } from "@/lib/data/ingredients";
import { requireManager } from "@/lib/auth";
import IngredientManager from "./IngredientManager";
import InfoTip from "@/components/help/InfoTip";

export const dynamic = "force-dynamic";

// Managers and up: ingredient names, units and costs feed recipes, the par
// sheet and the pour-cost reports, so cashiers don't edit them.
export default async function AdminIngredientsPage() {
  await requireManager();
  const [ingredients, parItems] = await Promise.all([getIngredientsWithLastCount(), getParItemRefs()]);
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">
        Ingredients & inventory
        <InfoTip topic="recipes-par-link" />
      </h1>
      <p className="mb-4 text-sm text-[var(--muted)]">
        The shared ingredient catalog used by recipes (see Menu → any item → Recipe). Log a physical count here whenever someone
        counts the shelf -- the Reports page compares counts over time against recipe-based expected usage to flag overpour/waste.
      </p>
      <IngredientManager ingredients={ingredients} parItems={parItems} canLink />
    </div>
  );
}

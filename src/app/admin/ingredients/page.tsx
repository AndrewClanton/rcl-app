import { getIngredientsWithLastCount, getParItemRefs } from "@/lib/data/ingredients";
import { hasManagerAccess, requireStaff } from "@/lib/auth";
import IngredientManager from "./IngredientManager";

export const dynamic = "force-dynamic";

export default async function AdminIngredientsPage() {
  const staff = await requireStaff();
  const [ingredients, parItems] = await Promise.all([getIngredientsWithLastCount(), getParItemRefs()]);
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Ingredients & inventory</h1>
      <p className="mb-4 text-sm text-[var(--muted)]">
        The shared ingredient catalog used by recipes (see Menu → any item → Recipe). Log a physical count here whenever someone
        counts the shelf -- the Reports page compares counts over time against recipe-based expected usage to flag overpour/waste.
      </p>
      <IngredientManager ingredients={ingredients} parItems={parItems} canLink={hasManagerAccess(staff.role)} />
    </div>
  );
}

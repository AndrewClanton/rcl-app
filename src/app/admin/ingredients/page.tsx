import { getIngredientsWithLastCount, getParItemRefs } from "@/lib/data/ingredients";
import { requireManager } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
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
      <PageHeader
        titleAside={<InfoTip topic="recipes-par-link" />}
        area="stock"
        title="Ingredients & counts"
        purpose="The ingredients recipes are made from (Menu → any item → Recipe), with their costs. Log a count whenever someone counts the shelf: Reports → Bar usage compares the counts with what the recipes say was poured, to catch overpouring and waste."
      />
      <IngredientManager ingredients={ingredients} parItems={parItems} canLink />
    </div>
  );
}

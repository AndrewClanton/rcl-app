import { getMenuTree } from "@/lib/data/menu";
import { getIngredients, getParItemRefs } from "@/lib/data/ingredients";
import { getRecipesByItem } from "@/lib/data/recipes";
import { hasManagerAccess, requireStaff } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import MenuManager from "./MenuManager";

export const dynamic = "force-dynamic";

// Everyone on staff can look things up here (prices, recipes, what's
// hidden); only managers and up can change anything. The actions check
// that again on their own.
export default async function AdminMenuPage() {
  const staff = await requireStaff();
  const canEdit = hasManagerAccess(staff.role);
  // The par sheet is only needed to edit recipes (adding an ingredient can
  // put it on the par sheet), so only managers' pages get it.
  const [categories, ingredients, recipesByItem, parItems] = await Promise.all([
    getMenuTree(),
    getIngredients(),
    getRecipesByItem(),
    canEdit ? getParItemRefs() : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader
        area="stock"
        title="Menu"
        purpose="Every item on the register: prices, recipes, choices like size or flavor, and what's hidden. Anything marked out on the register shows here too."
      />
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 ">
        {!canEdit && <p className="notice mb-4 text-sm">You can look through the menu here. Changing it (prices, items, recipes) takes a manager.</p>}
        <MenuManager
          categories={categories}
          ingredients={ingredients}
          parItems={parItems.filter((p) => p.active)}
          recipesByItem={recipesByItem}
          canEdit={canEdit}
        />
      </div>
    </>
  );
}

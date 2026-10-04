import { requireManager } from "@/lib/auth";
import { getBarBookAdmin } from "@/lib/data/barBook";
import PageHeader from "@/components/admin/PageHeader";
import BarBookManager from "./BarBookManager";

export const dynamic = "force-dynamic";

// Back office → Bar Book. Managers and up: what each ingredient is (its
// kind and its color on the drink icons), whether the bar carries it, and
// the book's own drinks that aren't on the menu. A menu item's recipe is
// still changed in Menu → the item → Recipe.
export default async function BarBookPage() {
  await requireManager();
  const data = await getBarBookAdmin();
  return (
    <div>
      <PageHeader
        area="stock"
        title="Bar Book"
        purpose="The register's book of drinks (Bar tab → Bar Book). Mark which ingredients the bar carries so the book knows what we can make, set each one's color on the drink icons, and add our own drinks that aren't on the menu."
      />
      {data ? (
        <BarBookManager ingredients={data.ingredients} drinks={data.drinks} />
      ) : (
        <p className="notice text-sm">The Bar Book isn&apos;t set up yet: its database update (20261004010000_bar_book.sql) hasn&apos;t been applied. The register&apos;s Bar tab works without it.</p>
      )}
    </div>
  );
}

import { hasAdminAccess, requireManager } from "@/lib/auth";
import { getBarBookAdmin, getDoubleSettings, getMenuDoubles } from "@/lib/data/barBook";
import Doubles from "./Doubles";
import PageHeader from "@/components/admin/PageHeader";
import BarBookManager from "./BarBookManager";

export const dynamic = "force-dynamic";

// Back office → Bar Book. Managers and up: what each ingredient is (its
// kind and its color on the drink icons), whether the bar carries it, what
// it costs, and the book's own drinks that aren't on the menu. Owners and
// admins also set the target pour cost and make a book drink a menu item.
// A menu item's recipe is still changed in Menu → the item → Recipe.
export default async function BarBookPage() {
  const staff = await requireManager();
  const [data, doubleSettings] = await Promise.all([getBarBookAdmin(), getDoubleSettings()]);
  const menuDoubles = await getMenuDoubles(doubleSettings).catch(() => []);
  return (
    <div>
      <PageHeader
        area="stock"
        title="Bar Book"
        purpose="The register's book of drinks (Bar tab → Bar Book). Mark which ingredients the bar carries so the book knows what we can make, enter what bottles cost so every card can suggest a price, set each one's color on the drink icons, and add our own drinks."
      />
      {data ? (
        <div className="space-y-6">
          <Doubles settings={doubleSettings} drinks={menuDoubles} canOwn={hasAdminAccess(staff.role)} />
          <BarBookManager ingredients={data.ingredients} drinks={data.drinks} target={data.target} canOwn={hasAdminAccess(staff.role)} />
        </div>
      ) : (
        <p className="notice text-sm">The Bar Book isn&apos;t set up yet: its database update (20261004010000_bar_book.sql) hasn&apos;t been applied. The register&apos;s Bar tab works without it.</p>
      )}
    </div>
  );
}

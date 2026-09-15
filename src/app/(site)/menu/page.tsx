import { getMenuTree } from "@/lib/data/menu";
import type { MenuCategory, MenuItem } from "@/lib/types";

export const dynamic = "force-dynamic";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function ItemCard({ item }: { item: MenuItem }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{item.name}</span>
        <span className="text-sm text-neutral-500">{money(item.price)}</span>
      </div>
      {item.modifier_groups.length > 0 && (
        <div className="mt-1 text-xs text-neutral-500">
          {item.modifier_groups.map((g) => g.label).join(" · ")}
        </div>
      )}
    </div>
  );
}

function CategorySection({ category }: { category: MenuCategory }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-xl font-semibold">{category.label}</h2>
      {category.subcategories.length > 0 ? (
        <div className="space-y-6">
          {category.subcategories.map((sub) => (
            <div key={sub.id}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{sub.label}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {sub.items.map((item) => (
                  <ItemCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {category.items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

export default async function MenuPage() {
  const categories = await getMenuTree();
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Menu</h1>
      {categories
        .filter((c) => c.key !== "tickets")
        .map((cat) => (
          <CategorySection key={cat.id} category={cat} />
        ))}
    </div>
  );
}

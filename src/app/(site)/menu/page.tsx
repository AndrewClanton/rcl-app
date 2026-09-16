import type { Metadata } from "next";
import { getMenuTree } from "@/lib/data/menu";
import type { MenuCategory, MenuItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Menu",
  description: "Snacks, soft drinks, draft beer, wine, and specialty cocktails -- plus vegan, dairy-free, and gluten-free options.",
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function ItemCard({ item }: { item: MenuItem }) {
  return (
    <div className="card-flat">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">
          {item.name}
          {item.is_alcohol && <span className="ml-2 chip !px-1.5 !py-0.5 align-middle text-[10px]">21+</span>}
        </span>
        <span className="whitespace-nowrap text-sm font-semibold text-[var(--accent)]">{money(item.price)}</span>
      </div>
      {item.modifier_groups.length > 0 && (
        <div className="mt-1 text-xs text-[var(--muted)]">{item.modifier_groups.map((g) => g.label).join(" · ")}</div>
      )}
    </div>
  );
}

function CategorySection({ category }: { category: MenuCategory }) {
  return (
    <section className="mb-12">
      <h2 className="font-display mb-4 border-b border-[var(--border)] pb-2 text-2xl font-semibold">{category.label}</h2>
      {category.subcategories.length > 0 ? (
        <div className="space-y-6">
          {category.subcategories.map((sub) => (
            <div key={sub.id}>
              <h3 className="eyebrow mb-2">{sub.label}</h3>
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
      <h1 className="font-display mb-8 text-3xl font-semibold">Menu</h1>
      {categories
        .filter((c) => c.key !== "tickets")
        .map((cat) => (
          <CategorySection key={cat.id} category={cat} />
        ))}
    </div>
  );
}

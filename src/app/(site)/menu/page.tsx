import type { Metadata } from "next";
import Image from "next/image";
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

function ItemRow({ item }: { item: MenuItem }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--border)] py-2.5 last:border-b-0">
      <span className="min-w-0 font-medium">
        {item.name}
        {item.is_alcohol && <span className="ml-2 chip !px-1.5 !py-0.5 align-middle text-[10px]">21+</span>}
      </span>
      <span className="whitespace-nowrap text-sm font-semibold text-[var(--accent)]">{money(item.price)}</span>
    </div>
  );
}

function CategorySection({ category, photos }: { category: MenuCategory; photos?: { src: string; alt: string }[] }) {
  return (
    <section className="mb-12">
      {photos && photos.length > 0 && (
        <div className="mb-4 grid gap-2 sm:gap-3" style={{ gridTemplateColumns: `repeat(${photos.length}, minmax(0, 1fr))` }}>
          {photos.map((p) => (
            <div key={p.src} className="relative aspect-[4/3] overflow-hidden rounded-xl">
              <Image src={p.src} alt={p.alt} fill sizes={`(min-width: 1024px) ${Math.round(900 / photos.length)}px, ${Math.round(100 / photos.length)}vw`} className="object-cover" priority />
            </div>
          ))}
        </div>
      )}
      <h2 className="font-display mb-4 border-b border-[var(--border)] pb-2 text-2xl font-semibold">{category.label}</h2>
      {category.subcategories.length > 0 ? (
        <div className="space-y-6">
          {category.subcategories.map((sub) => (
            <div key={sub.id}>
              <h3 className="eyebrow mb-1">{sub.label}</h3>
              <div className="card !p-4 sm:columns-2 sm:gap-x-8">
                {sub.items.map((item) => (
                  <div key={item.id} className="break-inside-avoid">
                    <ItemRow item={item} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card !p-4 sm:columns-2 sm:gap-x-8">
          {category.items.map((item) => (
            <div key={item.id} className="break-inside-avoid">
              <ItemRow item={item} />
            </div>
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
      <h1 className="font-display mb-2 text-3xl font-semibold">Menu</h1>
      <p className="mb-8 max-w-2xl text-sm text-[var(--muted)]">
        Everything below is available at the counter -- this page is for browsing and pricing, not ordering online.
      </p>

      {categories
        .filter((c) => c.key !== "tickets")
        .map((cat) => (
          <CategorySection
            key={cat.id}
            category={cat}
            photos={
              cat.key === "grub"
                ? [
                    { src: "/photos/popcorn-pink.jpg", alt: "Fresh popcorn at Royale Cinema Lounge" },
                    { src: "/photos/hot-dog.jpg", alt: "Hot dog with mustard and ketchup" },
                    { src: "/photos/pizza.jpg", alt: "Pizza with mozzarella, cherry tomatoes, and basil" },
                  ]
                : cat.key === "spirits"
                  ? [
                      { src: "/photos/cocktail.jpg", alt: "Cocktail with lime and rosemary garnish" },
                      { src: "/photos/cocktails-bar.jpg", alt: "Three cocktails on the bar" },
                    ]
                  : undefined
            }
          />
        ))}
    </div>
  );
}

import Image from "next/image";
import { getMenuTree, withoutHiddenItems } from "@/lib/data/menu";
import { createPublicClient } from "@/lib/supabase/public";
import type { MenuCategory, MenuItem } from "@/lib/types";
import { PageMasthead } from "@/components/print";
import { pageMeta } from "@/lib/seo/page-meta";

// The same page for everyone, rebuilt at most every five minutes (and at
// once when a manager edits the menu: admin/menu/actions.ts and the
// register's item settings revalidate "/menu").
export const revalidate = 300;

export const metadata = pageMeta({
  title: "Menu",
  description: "The Royale Cinema Lounge menu: snacks, popcorn, pizza, soft drinks, draft beer, wine, specialty cocktails and movie-themed coffee drinks in Joplin, MO.",
  path: "/menu",
});

// What the register sells, as the register sees it: items a manager hid
// ("Hide from register") stay off the public menu too, and a section left
// with nothing in it isn't printed as an empty heading.
function withoutEmptySections(categories: MenuCategory[]): MenuCategory[] {
  return categories
    .map((c) => ({ ...c, subcategories: withoutEmptySections(c.subcategories) }))
    .filter((c) => c.items.length > 0 || c.subcategories.length > 0);
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// A printed-menu line: the name, a dotted leader, the price.
function ItemRow({ item }: { item: MenuItem }) {
  return (
    <div className="flex items-baseline gap-2 py-2">
      <span className="min-w-0 font-bold">
        {item.name}
        {item.is_alcohol && <span className="spec-code ml-2 rounded-[2px] border border-current px-1 align-middle">21+</span>}
      </span>
      <span aria-hidden="true" className="min-w-4 flex-1 -translate-y-1 border-b-2 border-dotted border-[rgba(20,17,12,0.3)]" />
      <span className="font-display whitespace-nowrap tabular-nums">{money(item.price)}</span>
    </div>
  );
}

function CategorySection({ category, photos }: { category: MenuCategory; photos?: { src: string; alt: string }[] }) {
  return (
    <section className="mb-12">
      {photos && photos.length > 0 && (
        <div className="mb-4 grid gap-2 sm:gap-3" style={{ gridTemplateColumns: `repeat(${photos.length}, minmax(0, 1fr))` }}>
          {photos.map((p) => (
            <div key={p.src} className="relative aspect-[4/3] overflow-hidden rounded-[4px] border-2 border-[var(--foreground)]">
              <Image src={p.src} alt={p.alt} fill sizes={`(min-width: 1024px) ${Math.round(900 / photos.length)}px, ${Math.round(100 / photos.length)}vw`} className="object-cover" priority />
            </div>
          ))}
        </div>
      )}
      <h2 className="font-display mb-4 text-3xl">{category.label}</h2>
      {category.subcategories.length > 0 ? (
        <div className="space-y-6">
          {category.subcategories.map((sub) => (
            <div key={sub.id}>
              <div className="sheet crop">
              <h3 className="spec-head rounded-t-[4px]">{sub.label}</h3>
              <div className="px-4 py-2 sm:columns-2 sm:gap-x-10">
                {sub.items.map((item) => (
                  <div key={item.id} className="break-inside-avoid">
                    <ItemRow item={item} />
                  </div>
                ))}
              </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="sheet crop px-4 py-2 sm:columns-2 sm:gap-x-10">
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
  const categories = withoutEmptySections(withoutHiddenItems(await getMenuTree(createPublicClient())));
  return (
    <div>
      <PageMasthead eyebrow="Food & drink" title="Menu" intro="Order at the counter. This page is for browsing and prices." />

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

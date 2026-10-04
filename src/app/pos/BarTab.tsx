"use client";

import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { MenuCategory, MenuItem, Recipe } from "@/lib/types";
import type { RegisterOut } from "@/lib/ops/shared";
import CategoryIcon from "@/components/menu/CategoryIcon";
import DrinkIcon from "@/components/bar/DrinkIcon";
import { useMenuTileExtras } from "./item-settings/ItemSettings";
import { FAMILY_COLOR, type BarSection, type IconSpec } from "@/lib/bar/icons";
import { barSectionOf, itemIconSpec, tintVars } from "@/lib/bar/menu";

function money(n: number) {
  return `$${Number(n).toFixed(2)}`;
}

type Placed = { item: MenuItem; sectionLabel: string | null; spec: IconSpec };

// The register's Bar tab (The Royale Bar Book, phase 1): everything the bar
// sells on one screen at the iPad's size, no scrolling. Beer and wine down
// the left with the Bar Book under them, cocktails as tiles tinted by their
// spirit with an icon drawn from the recipe, shots in a row along the
// bottom. A tap does exactly what any menu button does (onTap: its choices,
// or the Ran out question), and press and hold opens its settings. If the
// menu ever has more cocktails than fit, the tiles scroll inside their own
// box rather than the page.
export default function BarTab({
  category,
  recipesByItem,
  outs,
  onTap,
  onCustom,
  book,
}: {
  category: MenuCategory;
  recipesByItem: Record<string, Recipe>;
  outs: Map<string, RegisterOut>;
  onTap: (itemId: string) => void;
  onCustom: () => void;
  book?: ReactNode; // the Bar Book button, once the book is set up
}) {
  const tileExtras = useMenuTileExtras();

  const parts = useMemo(() => {
    const by: Record<BarSection, Placed[]> = { beer: [], wine: [], cocktails: [], shots: [], other: [] };
    const place = (items: MenuItem[], section: BarSection, sectionLabel: string | null) => {
      for (const item of items) by[section].push({ item, sectionLabel, spec: itemIconSpec(recipesByItem[item.id], section) });
    };
    // Anything on the bar category itself, or in a section nobody planned
    // for, sits with the cocktails so it's never lost.
    place(category.items, "other", null);
    for (const s of category.subcategories) place(s.items, barSectionOf(s), s.label);
    return by;
  }, [category, recipesByItem]);

  const tiles = [...parts.cocktails, ...parts.other];

  function extras(p: Placed) {
    const out = outs.get(p.item.id) ?? null;
    return { out, hold: tileExtras(p.item, category, p.sectionLabel, out).hold };
  }

  // A rail or shots-row button: name and price, tinted like its drink.
  function pick(p: Placed, wide = false) {
    const { out, hold } = extras(p);
    return (
      <button
        key={p.item.id}
        className={`bar-tint relative flex min-h-11 min-w-0 flex-col justify-center rounded-md border-[1.5px] px-2 py-1 text-left leading-tight ${wide ? "col-span-2" : ""}`}
        style={{ ...(tintVars(p.spec.base) as CSSProperties), ...(out ? { opacity: 0.5, borderStyle: "dashed" } : null) }}
        onClick={() => onTap(p.item.id)}
        {...hold}
        aria-label={out ? `${p.item.name}, ${out.reason}` : undefined}
      >
        <span className="text-[13px] font-bold" style={{ color: out ? "var(--muted)" : "var(--foreground)" }}>
          {p.item.name}
        </span>
        <span className="text-xs font-semibold" style={{ color: out ? "var(--danger-text)" : "var(--accent)" }}>
          {out ? "Ran out" : money(p.item.price)}
        </span>
      </button>
    );
  }

  function tile(p: Placed) {
    const { out, hold } = extras(p);
    const base = p.spec.base;
    return (
      <button
        key={p.item.id}
        className="bar-tint relative flex min-h-[118px] min-w-0 flex-col items-center gap-0.5 rounded-lg border-[1.5px] px-1.5 pb-2 pt-1.5 text-center"
        style={{ ...(tintVars(base) as CSSProperties), ...(out ? { opacity: 0.45, borderStyle: "dashed" } : null) }}
        onClick={() => onTap(p.item.id)}
        {...hold}
        aria-label={out ? `${p.item.name}, ${out.reason}` : undefined}
      >
        {base && <span className="absolute left-1.5 top-1.5 h-2.5 w-2.5 rounded-full" style={{ background: FAMILY_COLOR[base] }} aria-hidden />}
        <DrinkIcon spec={p.spec} size={56} />
        <span className="text-[13.5px] font-bold leading-tight" style={{ color: out ? "var(--muted)" : "var(--foreground)" }}>
          {p.item.name}
        </span>
        <span className="mt-auto text-xs font-semibold" style={{ color: out ? "var(--danger-text)" : "var(--accent)" }}>
          {out ? "Ran out" : money(p.item.price)}
        </span>
      </button>
    );
  }

  const heading = (key: string, text: string) => (
    <div className="eyebrow mb-1.5 flex items-center gap-1.5">
      <CategoryIcon category={key} size={16} />
      {text}
    </div>
  );

  return (
    <div className="grid gap-2.5 md:min-h-0 md:flex-1 md:grid-cols-[176px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] lg:grid-cols-[208px_minmax(0,1fr)]">
      {/* Left rail: beer, wine, the Bar Book. */}
      <div className="flex min-w-0 flex-col gap-2.5 md:min-h-0 md:overflow-y-auto md:overscroll-contain">
        {parts.beer.length > 0 && (
          <div className="rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
            {heading("beer", "Beer")}
            <div className="grid grid-cols-2 gap-1.5">{parts.beer.map((p) => pick(p))}</div>
          </div>
        )}
        {parts.wine.length > 0 && (
          <div className="rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
            {heading("wine", "Wine")}
            <div className="grid grid-cols-2 gap-1.5">{parts.wine.map((p) => pick(p, parts.wine.length === 1))}</div>
          </div>
        )}
        {book}
      </div>

      {/* Cocktails as tiles, then the shots row. */}
      <div className="flex min-w-0 flex-col gap-2.5 md:min-h-0">
        {tiles.length > 0 && (
          <div className="grid grid-cols-2 content-start gap-2 sm:grid-cols-3 md:min-h-0 md:flex-1 md:grid-cols-2 md:overflow-y-auto md:overscroll-contain lg:grid-cols-4">
            {tiles.map(tile)}
          </div>
        )}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
          {parts.shots.length > 0 && (
            <div className="eyebrow mr-1 flex items-center gap-1.5">
              <CategoryIcon category="shots" size={16} />
              Shots
            </div>
          )}
          {parts.shots.map((p) => pick(p))}
          {/* Anything the menu can't describe; each use files a dev note. */}
          <button className="ml-auto min-h-11 rounded-md border px-3 text-sm" style={{ borderStyle: "dashed", borderColor: "var(--border)", color: "var(--muted)" }} onClick={onCustom}>
            + Custom item
          </button>
        </div>
      </div>
    </div>
  );
}

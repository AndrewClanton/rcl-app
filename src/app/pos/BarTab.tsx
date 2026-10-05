"use client";

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { MenuCategory, MenuItem, Recipe } from "@/lib/types";
import type { RegisterOut } from "@/lib/ops/shared";
import CategoryIcon from "@/components/menu/CategoryIcon";
import DrinkIcon from "@/components/bar/DrinkIcon";
import { useMenuTileExtras } from "./item-settings/ItemSettings";
import { FAMILY_COLOR, type BarSection, type IconSpec } from "@/lib/bar/icons";
import { barSectionOf, gridPlan, itemIconSpec, quickPourName, tintVars, type GridPlan } from "@/lib/bar/menu";

function money(n: number) {
  return `$${Number(n).toFixed(2)}`;
}

type Placed = { item: MenuItem; sectionLabel: string | null; section: BarSection; spec: IconSpec };

// The Bar Book in the tab's header strip: "loading" until the register has
// read it, "off" before its migration (no strip at all).
// onWhatsInIt: "What's in it?" (WhatsInIt.tsx), from the same strip.
export type BarBookEntry = { state: "loading" | "ready" | "off"; count: number | null; onOpen: (query?: string) => void; onWhatsInIt?: () => void };

const GAP = 8;

// The register's Bar tab: everything the bar sells on one screen at the
// iPad's size, with nothing to scroll.
//   - Across the top, the Bar Book: its button ("37 we can make"), a
//     "Find a drink" box that opens it already searching, and "What's in
//     it?" for a drink the guest can only describe.
//   - Down the left, the quick pours (beer, wine, shots), one button each in
//     the same style, then "+ Custom item".
//   - The rest is cocktails, tinted by their spirit with an icon drawn from
//     the recipe, sized to fill the space edge to edge. More than fit, and
//     they page (‹ 1 / 2 ›, dots, or a swipe); the page is kept by the
//     register (page, onPage) so ringing a drink up doesn't lose it, and
//     only switching tabs starts it over.
// A tap does exactly what any menu button does (onTap: its choices, or the
// Ran out question), and press and hold opens its settings.
export default function BarTab({
  category,
  recipesByItem,
  outs,
  onTap,
  onCustom,
  book,
  page = 0,
  onPage,
}: {
  category: MenuCategory;
  recipesByItem: Record<string, Recipe>;
  outs: Map<string, RegisterOut>;
  onTap: (itemId: string) => void;
  onCustom: () => void;
  book?: BarBookEntry | null;
  page?: number;
  onPage?: (page: number) => void;
}) {
  const tileExtras = useMenuTileExtras();

  const parts = useMemo(() => {
    const by: Record<BarSection, Placed[]> = { beer: [], wine: [], cocktails: [], shots: [], other: [] };
    const place = (items: MenuItem[], section: BarSection, sectionLabel: string | null) => {
      for (const item of items) by[section].push({ item, sectionLabel, section, spec: itemIconSpec(recipesByItem[item.id], section) });
    };
    // Anything on the bar category itself, or in a section nobody planned
    // for, sits with the cocktails so it's never lost.
    place(category.items, "other", null);
    for (const s of category.subcategories) place(s.items, barSectionOf(s), s.label);
    return by;
  }, [category, recipesByItem]);

  const tiles = [...parts.cocktails, ...parts.other];
  const pours = (["beer", "wine", "shots"] as const).filter((s) => parts[s].length > 0);

  // Its settings (press and hold) show its icon large too.
  function extras(p: Placed) {
    const out = outs.get(p.item.id) ?? null;
    const hold = tileExtras(p.item, category, p.sectionLabel, out, p.spec).hold;
    // The finger going down pops the icon up (a quick 1.4×, none with
    // reduced motion; .bar-pop in globals.css); the tap still does what it did.
    const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
      hold?.onPointerDown(e);
      setPop({ id: p.item.id, n: Date.now() });
    };
    return { out, hold: hold ? { ...hold, onPointerDown } : { onPointerDown } };
  }
  const [pop, setPop] = useState<{ id: string; n: number } | null>(null);
  const popping = (id: string) => (pop?.id === id ? "bar-pop" : "");

  // The cocktails' column, measured, so the grid fills it exactly
  // (gridPlan leaves room for the pager when the tiles page).
  const boxRef = useRef<HTMLDivElement>(null);
  const [plan, setPlan] = useState<GridPlan | null>(null);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const next = gridPlan(el.clientWidth, el.clientHeight, tiles.length, GAP);
      setPlan((prev) => (prev && next && prev.cols === next.cols && prev.rows === next.rows && prev.pages === next.pages && Math.abs(prev.tileH - next.tileH) < 1 && Math.abs(prev.tileW - next.tileW) < 1 ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tiles.length]);

  const pages = plan?.pages ?? 1;
  const current = Math.min(Math.max(0, page), pages - 1);
  const shown = plan ? tiles.slice(current * plan.perPage, (current + 1) * plan.perPage) : [];
  const go = (p: number) => onPage?.(Math.min(Math.max(0, p), pages - 1));

  // A swipe across the tiles turns the page; the tap it ends in doesn't count.
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const swipedAt = useRef(0);
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (pages > 1) swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swipedAt.current = Date.now();
      go(current + (dx < 0 ? 1 : -1));
    }
  }

  // The icon takes what the tile has left after a two-line name and the price.
  const iconSize = plan ? Math.round(Math.max(36, Math.min(96, plan.tileH - 72, plan.tileW - 30))) : 56;
  // A narrow tile's name a size smaller, so "Rum or whiskey & coke" fits in two lines.
  const narrow = !!plan && plan.tileW < 125;

  // A quick pour: its glass, its name under its heading, its price.
  function pour(p: Placed) {
    const { out, hold } = extras(p);
    return (
      <button
        key={p.item.id}
        className="bar-tint relative flex min-h-11 min-w-0 flex-[1_1_0] items-center gap-2 rounded-lg border-[1.5px] px-2 text-left leading-tight"
        style={{ ...(tintVars(p.spec.base) as CSSProperties), maxHeight: 84, ...(out ? { opacity: 0.5, borderStyle: "dashed" } : null) }}
        onClick={() => onTap(p.item.id)}
        {...hold}
        aria-label={out ? `${p.item.name}, ${out.reason}` : p.item.name}
      >
        <span style={{ color: "var(--foreground)" }}>
          <DrinkIcon key={pop?.id === p.item.id ? pop.n : 0} spec={p.spec} size={30} className={popping(p.item.id)} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-bold" style={{ color: out ? "var(--muted)" : "var(--foreground)" }}>
          {quickPourName(p.item.name, p.section)}
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums" style={{ color: out ? "var(--danger-text)" : "var(--accent)" }}>
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
        className="bar-tint relative flex min-h-0 min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border-[1.5px] px-1.5 py-1.5 text-center"
        style={{ ...(tintVars(base) as CSSProperties), ...(out ? { opacity: 0.45, borderStyle: "dashed" } : null) }}
        onClick={() => onTap(p.item.id)}
        {...hold}
        aria-label={out ? `${p.item.name}, ${out.reason}` : undefined}
      >
        {base && <span className="absolute left-1.5 top-1.5 h-2.5 w-2.5 rounded-full" style={{ background: FAMILY_COLOR[base] }} aria-hidden />}
        <span style={{ color: "var(--foreground)" }}>
          <DrinkIcon key={pop?.id === p.item.id ? pop.n : 0} spec={p.spec} size={iconSize} className={popping(p.item.id)} />
        </span>
        <span className={`line-clamp-2 font-bold leading-tight ${narrow ? "text-[12.5px]" : "text-[13.5px]"}`} style={{ color: out ? "var(--muted)" : "var(--foreground)" }}>
          {p.item.name}
        </span>
        <span className="text-xs font-semibold" style={{ color: out ? "var(--danger-text)" : "var(--accent)" }}>
          {out ? "Ran out" : money(p.item.price)}
        </span>
      </button>
    );
  }

  const heading = (key: string, text: string) => (
    <div className="eyebrow flex shrink-0 items-center gap-1.5">
      <CategoryIcon category={key} size={16} />
      {text}
    </div>
  );

  return (
    <div className="flex flex-col gap-2.5 md:min-h-0 md:flex-1">
      {book && book.state !== "off" && <BookStrip book={book} />}

      <div className="grid gap-2.5 md:min-h-0 md:flex-1 md:grid-cols-[minmax(168px,31%)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
        {/* The quick pours, then a custom item. */}
        <div className="flex min-w-0 flex-col gap-2.5 md:min-h-0">
          {pours.map((s) => (
            <div key={s} className="flex min-h-0 flex-col gap-1.5" style={{ flex: `${parts[s].length} 1 0` }}>
              {heading(s, s === "beer" ? "Beer" : s === "wine" ? "Wine" : "Shots")}
              {parts[s].map((p) => pour(p))}
            </div>
          ))}
          {/* Anything the menu can't describe; each use files a dev note. */}
          <button
            className="mt-auto min-h-11 shrink-0 rounded-lg border-[1.5px] px-3 text-sm font-semibold"
            style={{ borderStyle: "dashed", borderColor: "var(--border)", color: "var(--muted)" }}
            onClick={onCustom}
          >
            + Custom item
          </button>
        </div>

        {/* Cocktails, filling the rest; a pager under them when they don't all fit. */}
        {/* Measured whole (tiles and pager), so the pager showing doesn't change the plan. */}
        <div ref={boxRef} className="flex min-w-0 flex-col md:min-h-0" style={{ gap: GAP }}>
          <div
            className="min-h-0 flex-1"
            style={{ touchAction: pages > 1 ? "pan-y" : undefined }}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => (swipe.current = null)}
            onClickCapture={(e) => {
              if (Date.now() - swipedAt.current < 400) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            {plan && (
              <div
                className="grid h-full"
                style={{
                  gap: GAP,
                  gridTemplateColumns: `repeat(${plan.cols}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${pages > 1 ? plan.rows : Math.max(1, Math.ceil(shown.length / plan.cols))}, ${pages > 1 ? `${plan.tileH}px` : "minmax(0, 1fr)"})`,
                }}
              >
                {shown.map(tile)}
              </div>
            )}
          </div>
          {pages > 1 && (
            <div className="flex shrink-0 items-center justify-between gap-2" style={{ height: 48 }}>
              <button className="btn-secondary min-h-11 min-w-14 !px-4 !text-xl leading-none" disabled={current === 0} onClick={() => go(current - 1)} aria-label="Previous page of cocktails">
                ‹
              </button>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold tabular-nums" style={{ color: "var(--foreground)" }}>
                  {current + 1} / {pages}
                </span>
                <span className="flex items-center gap-1.5">
                  {Array.from({ length: pages }, (_, i) => (
                    <button
                      key={i}
                      className="flex h-11 w-6 items-center justify-center"
                      onClick={() => go(i)}
                      aria-label={`Cocktails page ${i + 1}`}
                      aria-current={i === current || undefined}
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: i === current ? "var(--foreground)" : "var(--border)" }} />
                    </button>
                  ))}
                </span>
              </div>
              <button className="btn-secondary min-h-11 min-w-14 !px-4 !text-xl leading-none" disabled={current >= pages - 1} onClick={() => go(current + 1)} aria-label="Next page of cocktails">
                ›
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// The Bar Book's home on the tab: open it, or type a drink (or what's in
// it) and open it already searching. Typing stays in this box, so the
// iPad's keyboard comes up the usual way; Search opens the book.
function BookStrip({ book }: { book: BarBookEntry }) {
  const [q, setQ] = useState("");
  const ready = book.state === "ready";
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        className="flex min-h-12 shrink-0 items-center gap-2 rounded-lg border-2 px-3 text-left disabled:opacity-60"
        style={{ borderColor: "var(--foreground)", background: "var(--surface)", color: "var(--foreground)" }}
        disabled={!ready}
        onClick={() => book.onOpen()}
      >
        <span className="font-display text-lg leading-none">Bar Book</span>
        <span className="whitespace-nowrap rounded-full px-2 py-1 text-xs font-bold" style={{ background: "var(--gold)", color: "var(--gold-foreground)" }}>
          {ready && book.count !== null ? `${book.count} we can make` : "Checking…"}
        </span>
      </button>
      <form
        className="flex min-w-0 flex-1 items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) book.onOpen(q.trim() || undefined);
        }}
      >
        <input
          className="input min-h-12 min-w-0 flex-1 !text-base"
          type="search"
          enterKeyHint="search"
          placeholder="Find a drink"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Find a drink in the Bar Book"
        />
        <button className="btn-secondary flex min-h-12 w-12 shrink-0 items-center justify-center !p-0" disabled={!ready} aria-label="Find">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="M15.5 15.5 21 21" />
          </svg>
        </button>
      </form>
      {book.onWhatsInIt && (
        <button className="btn-secondary min-h-12 shrink-0 whitespace-nowrap !px-3.5" disabled={!ready} onClick={book.onWhatsInIt}>
          What&apos;s in it?
        </button>
      )}
    </div>
  );
}

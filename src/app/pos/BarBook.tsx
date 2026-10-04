"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import DrinkIcon from "@/components/bar/DrinkIcon";
import type { RegisterOut } from "@/lib/ops/shared";
import { FAMILY_COLOR, FAMILY_LABEL, GLASS_LABEL, SPIRITS, type Family } from "@/lib/bar/icons";
import {
  buildBook,
  drinkStatus,
  formatAmount,
  LINE_LABEL,
  letterOf,
  lineState,
  mainIngredients,
  nameKey,
  recipeCard,
  sortByWhatWeHave,
  stockMap,
  type BookDrink,
  type BookRecipe,
  type BookStock,
  type DrinkStatus,
  type MenuRef,
} from "@/lib/bar/book";

function money(n: number) {
  return `$${Number(n).toFixed(2)}`;
}

const STATUS_STYLE: Record<DrinkStatus["state"], { background: string; color: string }> = {
  ok: { background: "var(--success-bg)", color: "var(--success-text)" },
  missing: { background: "var(--warn-bg)", color: "var(--warn-text)" },
  out: { background: "var(--accent-soft)", color: "var(--danger-text)" },
};

function StatusChip({ status, big = false }: { status: DrinkStatus; big?: boolean }) {
  return (
    <span className={`whitespace-nowrap rounded-full font-bold ${big ? "px-3 py-1.5 text-sm" : "px-2 py-0.5 text-[11px]"}`} style={STATUS_STYLE[status.state]}>
      {status.label}
    </span>
  );
}

type Filter = "all" | "makeable" | "menu";

// The Bar Book on the register (The Royale Bar Book, phase 3): every drink
// we could make, A–Z, with its recipe card and a plain answer to "can we
// make it?" from what's carried, Ran out and the latest counts. Opened from
// the Bar tab, over the whole register. "Ring it up" shows only for drinks
// on our menu and rings up that menu item exactly as its button does
// (onRingUp, the register's own tap), so its choices, Ran out question,
// price and the ID check all still apply. Drinks off the menu can't be rung
// up yet: Andrew hasn't set off-menu prices.
export default function BarBook({
  recipes,
  stock,
  menuItems,
  outs,
  updating,
  onRingUp,
  onClose,
}: {
  recipes: BookRecipe[];
  stock: BookStock[];
  menuItems: MenuRef[];
  outs: Map<string, RegisterOut>;
  updating: boolean;
  onRingUp: (menuItemId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [byStock, setByStock] = useState(false); // "Uses what we have"
  const [spirit, setSpirit] = useState<Family | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const stockById = useMemo(() => stockMap(stock), [stock]);
  const book = useMemo(() => buildBook(recipes, menuItems), [recipes, menuItems]);
  const statusOf = useMemo(() => {
    const m = new Map<string, DrinkStatus>();
    for (const d of book) m.set(d.key, drinkStatus(d, stockById));
    return (d: BookDrink) => m.get(d.key) ?? drinkStatus(d, stockById);
  }, [book, stockById]);
  const makeableCount = useMemo(() => book.filter((d) => statusOf(d).state === "ok").length, [book, statusOf]);
  const spirits = useMemo<Family[]>(() => [...SPIRITS, "liqueur" as Family].filter((s) => book.some((d) => d.base === s)), [book]);

  const shown = useMemo(() => {
    const q = nameKey(query);
    let list = book.filter((d) => {
      if (filter === "makeable" && statusOf(d).state !== "ok") return false;
      if (filter === "menu" && !d.menu) return false;
      if (spirit && d.base !== spirit) return false;
      if (q && !d.key.includes(q) && !d.lines.some((l) => nameKey(l.name).includes(q))) return false;
      return true;
    });
    if (byStock) list = sortByWhatWeHave(list, stockById);
    return list;
  }, [book, filter, spirit, query, byStock, stockById, statusOf]);

  const selected = shown.find((d) => d.key === selectedKey) ?? shown[0] ?? null;

  // Escape closes, like the register's other panels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A–Z groups (not while sorted by what we have).
  const groups = useMemo(() => {
    if (byStock) return [{ letter: null as string | null, drinks: shown }];
    const g: { letter: string | null; drinks: BookDrink[] }[] = [];
    for (const d of shown) {
      const L = letterOf(d.name);
      if (!g.length || g[g.length - 1].letter !== L) g.push({ letter: L, drinks: [] });
      g[g.length - 1].drinks.push(d);
    }
    return g;
  }, [shown, byStock]);
  const letters = groups.map((g) => g.letter).filter((l): l is string => !!l);

  function jumpTo(letter: string) {
    // The group, not its sticky heading: a stuck heading reports where it's stuck.
    const el = listRef.current?.querySelector<HTMLElement>(`[data-letter="${letter}"]`);
    if (el && listRef.current) listRef.current.scrollTo({ top: el.offsetTop });
  }
  // Slide a finger down the letters to scrub, like the phone's contacts.
  function scrub(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.type === "pointermove" && e.buttons === 0 && e.pointerType === "mouse") return;
    const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const letter = hit?.dataset?.jump;
    if (letter) jumpTo(letter);
  }

  const chip = (on: boolean) => `chip min-h-11 !px-3.5 !text-sm font-bold ${on ? "chip-selected" : ""}`;

  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ background: "var(--background)" }} role="dialog" aria-modal="true" aria-label="Bar Book">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <h2 className="font-display text-2xl" style={{ color: "var(--foreground)" }}>
          Bar Book
        </h2>
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          {book.length} drinks{updating ? " · checking stock…" : ""}
        </span>
        <input
          className="input ml-auto !h-11 max-w-sm !text-base"
          type="search"
          placeholder="Find a drink or ingredient"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Find a drink or ingredient"
        />
        <button className="btn-secondary min-h-11 !px-6" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="grid min-h-0 flex-1 md:grid-cols-[400px_minmax(0,1fr)]">
        {/* The list: filters, then A–Z with a letter index. */}
        <div className="flex min-h-0 flex-col border-r" style={{ borderColor: "var(--border)" }}>
          <div className="flex shrink-0 flex-wrap gap-1.5 border-b p-2.5" style={{ borderColor: "var(--border)" }}>
            <button className={chip(filter === "makeable")} onClick={() => setFilter(filter === "makeable" ? "all" : "makeable")}>
              Makeable now · {makeableCount}
            </button>
            <button className={chip(byStock)} onClick={() => setByStock(!byStock)}>
              Uses what we have
            </button>
            <button className={chip(filter === "menu")} onClick={() => setFilter(filter === "menu" ? "all" : "menu")}>
              On our menu
            </button>
            {spirits.map((s) => (
              <button key={s} className={`${chip(spirit === s)} inline-flex items-center gap-1.5`} onClick={() => setSpirit(spirit === s ? null : s)}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: FAMILY_COLOR[s] }} aria-hidden />
                {FAMILY_LABEL[s]}
              </button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1">
            <div ref={listRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {shown.length === 0 && (
                <div className="p-6 text-center text-sm" style={{ color: "var(--muted)" }}>
                  Nothing matches.{" "}
                  <button
                    className="font-bold underline"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                      setSpirit(null);
                    }}
                  >
                    Show every drink
                  </button>
                </div>
              )}
              {groups.map((g) => (
                <div key={g.letter ?? "all"} data-letter={g.letter ?? undefined}>
                  {g.letter && (
                    <div className="sticky top-0 z-[1] px-3 py-1 font-display text-sm" style={{ background: "var(--surface-hover)", color: "var(--foreground)" }}>
                      {g.letter}
                    </div>
                  )}
                  {g.drinks.map((d) => {
                    const status = statusOf(d);
                    const on = selected?.key === d.key;
                    return (
                      <button
                        key={d.key}
                        className="grid min-h-[52px] w-full grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2.5 border-b px-3 py-1.5 text-left"
                        style={{ borderColor: "var(--border)", background: on ? "var(--warn-bg)" : undefined, color: "var(--foreground)" }}
                        onClick={() => setSelectedKey(d.key)}
                        aria-current={on || undefined}
                      >
                        <DrinkIcon spec={d.spec} size={40} />
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] font-bold leading-tight">{d.name}</span>
                          <span className="block truncate text-xs" style={{ color: "var(--muted)" }}>
                            {d.menu ? "On our menu · " : ""}
                            {mainIngredients(d) || "No ingredients listed"}
                          </span>
                        </span>
                        <StatusChip status={status} />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            {letters.length > 1 && (
              <div
                className="flex w-9 shrink-0 touch-none select-none flex-col border-l py-1"
                style={{ borderColor: "var(--border)" }}
                onPointerDown={scrub}
                onPointerMove={scrub}
                aria-label="Jump to a letter"
              >
                {letters.map((L) => (
                  <button key={L} data-jump={L} className="flex min-h-0 flex-1 items-center justify-center text-xs font-bold" style={{ color: "var(--accent)" }} onClick={() => jumpTo(L)}>
                    {L}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* The recipe card. */}
        <div className="min-h-0 overflow-y-auto overscroll-contain p-5 md:p-6">
          {selected ? <Card drink={selected} status={statusOf(selected)} stockById={stockById} outs={outs} onRingUp={onRingUp} /> : null}
        </div>
      </div>
    </div>
  );
}

function Card({
  drink,
  status,
  stockById,
  outs,
  onRingUp,
}: {
  drink: BookDrink;
  status: DrinkStatus;
  stockById: Map<string, BookStock>;
  outs: Map<string, RegisterOut>;
  onRingUp: (menuItemId: string) => void;
}) {
  const card = recipeCard(drink);
  const glass = card.glass ?? (drink.glass ? GLASS_LABEL[drink.glass] : null);
  const kicker = ["Recipe card", card.method, glass].filter(Boolean).join(" · ");
  const menuOut = drink.menu ? (outs.get(drink.menu.id) ?? null) : null;
  return (
    <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      <div className="flex flex-col items-center gap-3">
        <span style={{ color: "var(--foreground)" }}>
          <DrinkIcon spec={drink.spec} size={180} label={drink.name} />
        </span>
        <StatusChip status={status} big />
      </div>
      <div className="flex min-w-0 flex-col gap-4" style={{ color: "var(--foreground)" }}>
        <div>
          <div className="label-xs font-bold uppercase tracking-wider">{kicker}</div>
          <h3 className="font-display text-3xl leading-tight">{drink.name}</h3>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {drink.menu ? `On our menu as ${drink.menu.name}, ${money(drink.menu.price)}.` : "Not on our menu yet."}
            {menuOut ? ` ${menuOut.reason}.` : ""}
            {card.garnish ? ` Garnish: ${card.garnish}.` : ""}
          </p>
          {card.description && <p className="mt-2 text-[15px]">{card.description}</p>}
        </div>

        <div>
          <div className="label-xs font-bold uppercase tracking-wider">Ingredients</div>
          {drink.lines.length === 0 && (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              None listed yet.
            </p>
          )}
          {drink.lines.map((l, i) => {
            const st = lineState(l, stockById);
            const good = st === "ok";
            return (
              <div key={`${l.ingredientId}-${i}`} className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2.5 border-b py-2 text-[15px]" style={{ borderColor: "var(--border)" }}>
                <span className="h-3.5 w-3.5 rounded" style={{ background: l.family ? FAMILY_COLOR[l.family] : "var(--border)" }} aria-hidden />
                <span className="min-w-0">
                  {l.name}
                  {l.optional && (
                    <span className="ml-1.5 text-xs" style={{ color: "var(--muted)" }}>
                      optional
                    </span>
                  )}
                </span>
                <span className="whitespace-nowrap text-sm tabular-nums">
                  {formatAmount(l.quantity, l.unit)}
                  {" · "}
                  <span className="font-bold" style={{ color: good ? "var(--success-text)" : l.optional ? "var(--muted)" : st === "missing" ? "var(--warn-text)" : "var(--danger-text)" }}>
                    {LINE_LABEL[st]}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        {card.instructions && (
          <div>
            <div className="label-xs font-bold uppercase tracking-wider">Method</div>
            <p className="text-[15px]">{card.instructions}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          {drink.menu ? (
            <button className="btn-primary min-h-12 !px-6 !text-base" onClick={() => onRingUp(drink.menu!.id)}>
              Ring it up · {money(drink.menu.price)}
            </button>
          ) : (
            <span className="rounded-lg border-2 border-dashed px-4 py-3 text-sm font-bold" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
              Not on our menu yet
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import DrinkIcon from "@/components/bar/DrinkIcon";
import ManagerPinModal from "@/components/ManagerPinModal";
import { approvalText } from "@/lib/pin-rules";
import { approveBelowCost } from "./bar-book-actions";
import { makeMenuItemFromRecipe } from "@/app/admin/bar-book/actions";
import {
  bookOrderLine,
  dollars,
  isBelowCost,
  money as costMoney,
  offMenuPricing,
  priceSummary,
  readPrice,
  type BarPrices,
  type BookOrderLine,
  type DrinkCost,
  type ManagersCheck,
} from "@/lib/bar/pricing";
import { doubledLines, doubleUpcharge, plus, type DoubleSettings } from "@/lib/bar/double";
import type { RegisterOut } from "@/lib/ops/shared";
import { FAMILY_COLOR, FAMILY_LABEL, GLASS_LABEL, SPIRITS, type Family } from "@/lib/bar/icons";
import {
  buildBook,
  cocktailAverage,
  costOf,
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
// the Bar tab, over the whole register. "Ring it up" shows for drinks on
// our menu and rings up that menu item exactly as its button does
// (onRingUp, the register's own tap), so its choices, Ran out question,
// price and the ID check all still apply. A drink off the menu has "Add to
// order" instead: a one-off line at the rule price (or one staff type), the
// same line as "+ Custom item" (onAddLine), always alcohol for the ID
// check, and a manager PIN below what it costs. A menu drink's card shows
// what it costs and its pour cost; an off-menu drink's shows the rule price
// and the manager's check (src/lib/bar/pricing.ts).
export default function BarBook({
  initialQuery = "",
  recipes,
  stock,
  menuItems,
  target,
  outs,
  updating,
  canMakeMenuItems,
  doubleSettings,
  prices,
  onRingUp,
  onAddLine,
  onMenuChanged,
  onClose,
}: {
  initialQuery?: string; // opened from the Bar tab's "Find a drink" box
  recipes: BookRecipe[];
  stock: BookStock[];
  menuItems: MenuRef[];
  target: number; // the target pour cost
  outs: Map<string, RegisterOut>;
  updating: boolean;
  canMakeMenuItems: boolean; // an owner or admin is signed in
  doubleSettings: DoubleSettings;
  prices: BarPrices; // the Prices sheet: the rule an off-menu drink is priced by
  onRingUp: (menuItemId: string, double?: boolean) => void;
  onAddLine: (line: BookOrderLine, note?: string) => void;
  onMenuChanged: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
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
  const average = useMemo(() => cocktailAverage(book, stockById), [book, stockById]);
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
          {selected ? (
            <Card
              key={selected.key}
              drink={selected}
              status={statusOf(selected)}
              stockById={stockById}
              outs={outs}
              target={target}
              average={average}
              canMakeMenuItems={canMakeMenuItems}
              doubleSettings={doubleSettings}
              prices={prices}
              onRingUp={onRingUp}
              onAddLine={onAddLine}
              onMenuChanged={onMenuChanged}
            />
          ) : null}
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
  target,
  average,
  canMakeMenuItems,
  doubleSettings,
  prices,
  onRingUp,
  onAddLine,
  onMenuChanged,
}: {
  drink: BookDrink;
  status: DrinkStatus;
  stockById: Map<string, BookStock>;
  outs: Map<string, RegisterOut>;
  target: number;
  average: number | null;
  canMakeMenuItems: boolean;
  doubleSettings: DoubleSettings;
  prices: BarPrices;
  onRingUp: (menuItemId: string, double?: boolean) => void;
  onAddLine: (line: BookOrderLine, note?: string) => void;
  onMenuChanged: () => void;
}) {
  const [sheet, setSheet] = useState<"add" | "menu" | null>(null);
  // A double, picked before ringing it up: twice the spirit in the amounts
  // shown and the cost, the upcharge on the price (lib/bar/double.ts).
  const [dbl, setDbl] = useState(false);
  const single = costOf(drink, stockById);
  const upcharge = doubleUpcharge({ isAlcohol: true, section: drink.menu?.section ?? "cocktails", ownDouble: false, recipe: drink.lines, name: drink.menu?.name ?? drink.name }, doubleSettings);
  const doubled = dbl && upcharge !== null;
  const shownLines = doubled ? doubledLines(drink.lines) : drink.lines;
  const cost = doubled ? costOf({ lines: shownLines }, stockById) : single;
  // On the menu: its menu price and pour cost. Off it: the rule price and
  // the manager's check (the single's for "Make this a menu item").
  const menuPricing = drink.menu ? priceSummary({ cost, target, menuPrice: drink.menu.price + (doubled ? upcharge! : 0), average }) : null;
  const offMenu = drink.menu ? null : offMenuPricing(drink.lines, cost, prices, { double: doubled });
  const offMenuSingle = drink.menu ? null : offMenuPricing(drink.lines, single, prices);
  const startPrice = offMenu?.price ?? null;
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
          <PriceLine text={menuPricing?.text ?? offMenu?.text ?? ""} flag={offMenu?.flag ?? null} />
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <div className="label-xs font-bold uppercase tracking-wider">Ingredients{doubled ? " (a double)" : ""}</div>
            {upcharge !== null && (
              <button className={`chip min-h-11 !px-3.5 !text-sm font-bold ${doubled ? "chip-selected" : ""}`} aria-pressed={doubled} onClick={() => setDbl(!doubled)}>
                {doubled ? "✓ " : ""}Double {plus(upcharge)}
              </button>
            )}
          </div>
          {drink.lines.length === 0 && (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              None listed yet.
            </p>
          )}
          {shownLines.map((l, i) => {
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
            <button className="btn-primary min-h-12 !px-6 !text-base" onClick={() => onRingUp(drink.menu!.id, doubled)}>
              Ring it up{doubled ? " a double" : ""} · {money(drink.menu.price + (doubled ? upcharge! : 0))}
            </button>
          ) : (
            <>
              <button className="btn-primary min-h-12 !px-6 !text-base" onClick={() => setSheet("add")}>
                Add to order{startPrice !== null ? ` · ${dollars(startPrice)}` : ""}
              </button>
              <span className="text-sm" style={{ color: "var(--muted)" }}>
                Not on our menu yet
              </span>
              {canMakeMenuItems && (
                <button className="btn-secondary ml-auto min-h-11 !px-4 !text-sm" onClick={() => setSheet("menu")}>
                  Make this a menu item
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {sheet && (
        <PriceSheet
          mode={sheet}
          title={sheet === "add" && doubled ? `${drink.name} · Double` : drink.name}
          suggested={sheet === "add" ? startPrice : (offMenuSingle?.price ?? null)}
          check={(sheet === "add" ? offMenu : offMenuSingle)?.rule ? (sheet === "add" ? offMenu : offMenuSingle) : null}
          cost={sheet === "add" ? cost : single}
          approvalTarget={drink.id}
          onClose={() => setSheet(null)}
          onAdd={(price, note) => {
            setSheet(null);
            onAddLine(bookOrderLine({ recipeId: drink.id, name: drink.name }, price, doubled), note);
          }}
          onMakeMenuItem={(price) => makeMenuItemFromRecipe(drink.id, price)}
          onMadeMenuItem={() => {
            setSheet(null);
            onMenuChanged();
          }}
        />
      )}
    </div>
  );
}

// A card's money line: a menu drink's cost and pour cost, or an off-menu
// drink's rule price and the manager's check, with its gentle flag when the
// rule price is over the target pour cost.
export function PriceLine({ text, flag }: { text: string; flag: string | null }) {
  return (
    <div className="mt-2 rounded-md px-2.5 py-1.5 text-sm tabular-nums" style={{ background: "var(--surface-hover)" }}>
      <div className="font-semibold">{text}</div>
      {flag && (
        <div className="mt-0.5 text-xs font-semibold" style={{ color: "var(--warn-text)" }}>
          {flag}
        </div>
      )}
    </div>
  );
}

// "Add to order" (a one-off line at this price) or "Make this a menu item"
// (owners and admins), named after the drink. The price starts at the rule
// price (with the manager's check under it), or with no spirit in it at the
// suggested one; with no costs to suggest from, staff type it. Below what
// it's known to cost, adding it takes a manager's PIN (approveBelowCost,
// for this recipe or "custom"). Used by the Bar Book's cards and by
// "What's in it?" (WhatsInIt.tsx), so both ring drinks up the same way.
export function PriceSheet({
  mode,
  title,
  blurb,
  suggested,
  check,
  cost,
  approvalTarget,
  onClose,
  onAdd,
  onMakeMenuItem,
  onMadeMenuItem,
}: {
  mode: "add" | "menu";
  title: string; // the drink's name
  blurb?: string;
  suggested: number | null; // what the price starts at
  check?: ManagersCheck | null; // the rule price's manager's check
  cost: DrinkCost;
  approvalTarget: string; // the recipe's id, or "custom"
  onClose: () => void;
  onAdd?: (price: number, note?: string) => void;
  onMakeMenuItem?: (price: number) => Promise<{ ok: true } | { ok: false; error: string }>;
  onMadeMenuItem?: () => void;
}) {
  const [text, setText] = useState(suggested !== null ? String(suggested) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askPin, setAskPin] = useState(false);
  const read = readPrice(text);
  const below = read.ok && isBelowCost(read.price, cost);

  async function submit() {
    if (!read.ok) {
      setError(read.error);
      return;
    }
    setError(null);
    if (mode === "add") {
      if (below) setAskPin(true);
      else onAdd?.(read.price);
      return;
    }
    if (!onMakeMenuItem) return;
    setBusy(true);
    const r = await onMakeMenuItem(read.price).catch(() => ({ ok: false as const, error: "Couldn't reach the website. Try again." }));
    setBusy(false);
    if (r.ok) onMadeMenuItem?.();
    else setError(r.error);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        className="card w-full max-w-sm space-y-3 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          {mode === "add" ? title : `Put ${title} on the menu`}
        </h3>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {blurb ??
            (mode === "add"
              ? "Goes on the order like a custom item, at this price. It counts as alcohol, so the ID check applies."
              : "Adds it to Cocktails under Alcohol at this price. It shows as a button on the Bar tab and rings up like any drink.")}
        </p>
        <label className="block">
          <div className="label-xs">Price</div>
          <input
            autoFocus
            className="input !text-lg"
            inputMode="decimal"
            placeholder={suggested !== null ? String(suggested) : "Type a price"}
            value={text}
            onChange={(e) => setText(e.target.value.replace(/[^0-9.$]/g, ""))}
          />
        </label>
        <p className="text-xs" style={{ color: below ? "var(--danger-text)" : "var(--muted)" }}>
          {check ? (
            `${check.text}.`
          ) : (
            <>
              {suggested !== null ? `Suggested $${suggested}. ` : "No suggested price: its costs aren't all in yet. "}
              {cost.anyCost ? `Costs ${cost.cost !== null ? costMoney(cost.cost) : `at least ${costMoney(cost.known)}`} to make.` : ""}
            </>
          )}
          {below ? (mode === "add" ? " That's below cost, so it needs a manager's PIN." : " That's below cost.") : ""}
        </p>
        {check?.flag && (
          <p className="text-xs font-semibold" style={{ color: "var(--warn-text)" }}>
            {check.flag}
          </p>
        )}
        {error && (
          <p className="text-sm font-semibold" style={{ color: "var(--danger-text)" }}>
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary min-h-11" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary min-h-11" disabled={busy || !text.trim()}>
            {busy ? "Adding…" : mode === "add" ? (below ? "Manager PIN" : `Add${read.ok ? ` $${read.price.toFixed(2)}` : ""}`) : `Add to the menu${read.ok ? ` at $${read.price.toFixed(2)}` : ""}`}
          </button>
        </div>
      </form>
      {askPin && read.ok && (
        <ManagerPinModal
          title="Below cost"
          description={`${title} at $${read.price.toFixed(2)} is less than it costs to make. A manager's PIN puts it on the order.`}
          onCancel={() => setAskPin(false)}
          onSubmit={async (pin) => {
            const r = await approveBelowCost(pin, approvalTarget);
            if (!r.ok) throw new Error(r.error);
            setAskPin(false);
            onAdd?.(read.price, `${title} added below cost. ${approvalText(r)}`);
          }}
        />
      )}
    </div>
  );
}

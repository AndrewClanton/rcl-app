"use client";

import { useEffect, useMemo, useState } from "react";
import DrinkIcon from "@/components/bar/DrinkIcon";
import type { RegisterOut } from "@/lib/ops/shared";
import { FAMILY_COLOR, FAMILY_LABEL, SPIRITS, familyFor, isFamily, isKind, kindFor, type Family } from "@/lib/bar/icons";
import { buildBook, costOf, drinkStatus, cocktailAverage, formatAmount, nameKey, stockMap, type BookDrink, type BookRecipe, type BookStock, type MenuRef } from "@/lib/bar/book";
import { bookOrderLine, drinkCost, priceSummary, type BookOrderLine } from "@/lib/bar/pricing";
import {
  amountStep,
  customName,
  customOrderLine,
  customSpec,
  defaultAmount,
  diffText,
  matchDrinks,
  MAX_LINES,
  nudge,
  bestText,
  type CustomOrderLine,
  type PickedIngredient,
} from "@/lib/bar/match";
import { PriceSheet } from "./BarBook";

function money(n: number) {
  return `$${Number(n).toFixed(2)}`;
}

const GROUPS: { kind: string; label: string }[] = [
  { kind: "liqueur", label: "Liqueurs" },
  { kind: "mixer", label: "Mixers" },
  { kind: "juice", label: "Juices" },
  { kind: "syrup", label: "Syrups" },
  { kind: "bitters", label: "Bitters" },
];

const SPIRIT_FAMILIES: Family[] = ["vodka", "rum", "gin", "tequila", "whiskey", "brandy"];

const kindOf = (s: BookStock) => (isKind(s.kind) ? s.kind : kindFor(s.name));
const familyOf = (s: BookStock) => (isFamily(s.family) ? s.family : familyFor(s.name, { kind: s.kind }));

// "What's in it?" (the Bar tab): a guest describes a drink, staff tap in
// what's in it, and it says which drink that is (src/lib/bar/match.ts), with
// up to three near misses. A match rings up exactly as the Bar Book does: a
// drink on our menu through its button's tap (onRingUp), one off the menu
// through the price sheet with its recipe (onAddLine). Nothing matched, it's
// a custom drink: named for what's in it, costed from the list, and on the
// order like "+ Custom item" carrying that list (onAddCustom). Below what it
// costs takes a manager's PIN either way.
export default function WhatsInIt({
  recipes,
  stock,
  menuItems,
  target,
  outs,
  onRingUp,
  onAddLine,
  onAddCustom,
  onClose,
}: {
  recipes: BookRecipe[];
  stock: BookStock[];
  menuItems: MenuRef[];
  target: number;
  outs: Map<string, RegisterOut>;
  onRingUp: (menuItemId: string) => void;
  onAddLine: (line: BookOrderLine, note?: string) => void;
  onAddCustom: (line: CustomOrderLine, note?: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<PickedIngredient[]>([]);
  const [shownKey, setShownKey] = useState<string | null>(null); // an alternative tapped
  const [name, setName] = useState<string | null>(null); // the custom drink's name, once typed
  const [sheet, setSheet] = useState<"drink" | "custom" | null>(null);

  const stockById = useMemo(() => stockMap(stock), [stock]);
  const book = useMemo(() => buildBook(recipes, menuItems), [recipes, menuItems]);
  const average = useMemo(() => cocktailAverage(book, stockById), [book, stockById]);
  const usable = useMemo(() => stock.filter((s) => s.name.trim()), [stock]);

  // One chip per spirit: the bar's pour of it (carried, a well or house
  // bottle first). Any vodka matches as vodka.
  const spiritChips = useMemo(() => {
    const out: { family: Family; ing: BookStock }[] = [];
    for (const f of SPIRIT_FAMILIES) {
      const all = usable.filter((s) => kindOf(s) === "spirit" && familyOf(s) === f);
      if (!all.length) continue;
      const rank = (s: BookStock) => (s.carried ? 0 : 10) + (/^(well|house)\b/i.test(s.name) ? 0 : 2) + s.name.length / 100;
      out.push({ family: f, ing: [...all].sort((a, b) => rank(a) - rank(b))[0] });
    }
    return out;
  }, [usable]);
  const groups = useMemo(
    () =>
      GROUPS.map((g) => ({ ...g, items: usable.filter((s) => s.carried && kindOf(s) === g.kind).sort((a, b) => a.name.localeCompare(b.name)) })).filter((g) => g.items.length),
    [usable],
  );
  const found = useMemo(() => {
    const q = nameKey(query);
    if (!q) return [];
    return usable
      .filter((s) => nameKey(s.name).includes(q))
      .sort((a, b) => Number(b.carried) - Number(a.carried) || a.name.localeCompare(b.name))
      .slice(0, 24);
  }, [usable, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isPicked = (id: string) => picked.some((p) => p.id === id);
  function toggle(s: BookStock) {
    setShownKey(null);
    setPicked((prev) => {
      if (prev.some((p) => p.id === s.id)) return prev.filter((p) => p.id !== s.id);
      if (prev.length >= MAX_LINES) return prev;
      const kind = kindOf(s);
      return [...prev, { id: s.id, name: s.name, unit: s.unit ?? "oz", family: familyOf(s), kind, amount: s.unit === "count" ? 1 : defaultAmount(kind) }];
    });
  }
  function step(id: string, dir: 1 | -1) {
    setPicked((prev) => prev.map((p) => (p.id === id ? { ...p, amount: nudge(p.amount, amountStep(p.kind, p.unit), dir) } : p)));
  }

  const result = useMemo(() => (picked.length ? matchDrinks(picked, book) : { best: null, alternatives: [] }), [picked, book]);
  const alt = shownKey ? result.alternatives.find((a) => a.drink.key === shownKey) : undefined;
  const shown: BookDrink | null = alt?.drink ?? result.best?.drink ?? null;

  const customCost = useMemo(() => drinkCost(picked.map((p) => ({ name: p.name, quantity: p.amount, unitCost: stockById.get(p.id)?.unitCost ?? null }))), [picked, stockById]);
  const customLabel = name ?? customName(picked);

  const chip = (s: BookStock, label?: string, swatch?: string) => {
    const on = isPicked(s.id);
    return (
      <button
        key={s.id}
        className={`chip inline-flex min-h-11 items-center gap-1.5 !px-3.5 !text-sm font-semibold ${on ? "chip-selected" : ""}`}
        onClick={() => toggle(s)}
        aria-pressed={on}
      >
        {swatch && <span className="h-2.5 w-2.5 rounded-full" style={{ background: swatch }} aria-hidden />}
        {label ?? s.name}
        {!s.carried && <span className="text-[11px] font-normal" style={{ color: "var(--muted)" }}>not carried</span>}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ background: "var(--background)" }} role="dialog" aria-modal="true" aria-label="What's in it?">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <h2 className="font-display text-2xl" style={{ color: "var(--foreground)" }}>
          What&apos;s in it?
        </h2>
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          Tap what the guest says is in it.
        </span>
        <button className="btn-secondary ml-auto min-h-11 !px-6" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_minmax(360px,42%)]">
        {/* What could be in it. */}
        <div className="flex min-h-0 flex-col border-r" style={{ borderColor: "var(--border)" }}>
          <div className="shrink-0 border-b p-3" style={{ borderColor: "var(--border)" }}>
            <input
              className="input min-h-11 !text-base"
              type="search"
              placeholder="Find anything else (Galliano, grapefruit soda…)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Find an ingredient"
            />
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3">
            {query.trim() !== "" && (
              <section>
                <div className="eyebrow mb-2">Found</div>
                <div className="flex flex-wrap gap-2">
                  {found.length ? found.map((s) => chip(s)) : <span className="text-sm" style={{ color: "var(--muted)" }}>Nothing by that name.</span>}
                </div>
              </section>
            )}
            {spiritChips.length > 0 && (
              <section>
                <div className="eyebrow mb-2">Spirits</div>
                <div className="flex flex-wrap gap-2">{spiritChips.map(({ family, ing }) => chip(ing, FAMILY_LABEL[family], FAMILY_COLOR[family]))}</div>
              </section>
            )}
            {groups.map((g) => (
              <section key={g.kind}>
                <div className="eyebrow mb-2">{g.label}</div>
                <div className="flex flex-wrap gap-2">{g.items.map((s) => chip(s, undefined, isFamily(familyOf(s)) ? FAMILY_COLOR[familyOf(s) as Family] : undefined))}</div>
              </section>
            ))}
          </div>
        </div>

        {/* What's in it so far, and what it is. */}
        <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4" style={{ color: "var(--foreground)" }}>
          <section>
            <div className="label-xs font-bold uppercase tracking-wider">In it</div>
            {picked.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                Nothing yet. Start with the spirit.
              </p>
            ) : (
              <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                {picked.map((p) => {
                  const fam = isFamily(p.family) ? p.family : null;
                  const isSpirit = p.kind === "spirit" && fam && (SPIRITS as readonly string[]).includes(fam);
                  return (
                    <div key={p.id} className="flex items-center gap-2 py-1.5">
                      <span className="h-3.5 w-3.5 shrink-0 rounded" style={{ background: fam ? FAMILY_COLOR[fam] : "var(--border)" }} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{isSpirit ? `${FAMILY_LABEL[fam!]} (${p.name})` : p.name}</span>
                      <button className="btn-secondary h-11 w-11 !p-0 text-lg" onClick={() => step(p.id, -1)} aria-label={`Less ${p.name}`}>
                        −
                      </button>
                      <span className="w-16 text-center text-sm font-bold tabular-nums">{formatAmount(p.amount, p.unit)}</span>
                      <button className="btn-secondary h-11 w-11 !p-0 text-lg" onClick={() => step(p.id, 1)} aria-label={`More ${p.name}`}>
                        +
                      </button>
                      <button className="h-11 w-9 text-lg" style={{ color: "var(--danger-text)" }} onClick={() => setPicked((prev) => prev.filter((x) => x.id !== p.id))} aria-label={`Take out ${p.name}`}>
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {picked.length > 0 && shown && (
            <DrinkCard
              drink={shown}
              headline={alt ? alt.text : result.best ? bestText(result.best) : shown.name}
              statusLabel={drinkStatus(shown, stockById)}
              priceText={priceSummary({ cost: costOf(shown, stockById), target, menuPrice: shown.menu?.price ?? null, average }).text}
              menuOut={shown.menu ? (outs.get(shown.menu.id)?.reason ?? null) : null}
              onRingUp={() => shown.menu && onRingUp(shown.menu.id)}
              onAdd={() => setSheet("drink")}
              suggested={priceSummary({ cost: costOf(shown, stockById), target }).suggested}
              onBack={alt ? () => setShownKey(null) : null}
              backLabel={result.best ? "Back to the best match" : "Back to a custom drink"}
            />
          )}

          {picked.length > 0 && !shown && (
            <section className="rounded-xl border-2 p-4" style={{ borderColor: "var(--foreground)", background: "var(--surface)" }}>
              <div className="label-xs font-bold uppercase tracking-wider">No drink in the book is quite that. A custom drink:</div>
              <div className="mt-2 flex items-start gap-4">
                <DrinkIcon spec={customSpec(picked)} size={110} label={customLabel} />
                <div className="min-w-0 flex-1 space-y-2">
                  <label className="block">
                    <span className="label-xs block">Name on the order</span>
                    <input className="input min-h-11 !text-base font-bold" value={customLabel} maxLength={80} onChange={(e) => setName(e.target.value)} />
                  </label>
                  <p className="rounded-md px-2.5 py-1.5 text-sm font-semibold" style={{ background: "var(--surface-hover)" }}>
                    {priceSummary({ cost: customCost, target }).text}
                  </p>
                  <button className="btn-primary min-h-12 !px-6 !text-base" onClick={() => setSheet("custom")}>
                    Add to order{priceSummary({ cost: customCost, target }).suggested !== null ? ` · $${priceSummary({ cost: customCost, target }).suggested}` : ""}
                  </button>
                </div>
              </div>
            </section>
          )}

          {picked.length > 0 && result.alternatives.length > 0 && (
            <section>
              <div className="label-xs font-bold uppercase tracking-wider">{shown ? "Or close to" : "Close to"}</div>
              <div className="space-y-1.5">
                {result.alternatives.map((a) => (
                  <button
                    key={a.drink.key}
                    className="flex min-h-12 w-full items-center gap-3 rounded-lg border px-2.5 py-1.5 text-left"
                    style={{ borderColor: a.drink.key === shownKey ? "var(--accent)" : "var(--border)", background: a.drink.key === shownKey ? "var(--accent-soft)" : "var(--surface)" }}
                    onClick={() => setShownKey(a.drink.key === shownKey ? null : a.drink.key)}
                  >
                    <DrinkIcon spec={a.drink.spec} size={36} />
                    <span className="min-w-0 flex-1 text-sm">
                      <strong>{a.drink.name}</strong>
                      <span className="block" style={{ color: "var(--muted)" }}>
                        {diffText(a)}
                      </span>
                    </span>
                    {a.drink.menu && <span className="shrink-0 text-xs font-bold" style={{ color: "var(--accent)" }}>{money(a.drink.menu.price)}</span>}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {sheet === "drink" && shown && !shown.menu && (
        <PriceSheet
          mode="add"
          title={shown.name}
          suggested={priceSummary({ cost: costOf(shown, stockById), target }).suggested}
          cost={costOf(shown, stockById)}
          approvalTarget={shown.id}
          onClose={() => setSheet(null)}
          onAdd={(price, note) => {
            setSheet(null);
            onAddLine(bookOrderLine({ recipeId: shown.id, name: shown.name }, price), note);
          }}
        />
      )}
      {sheet === "custom" && picked.length > 0 && (
        <PriceSheet
          mode="add"
          title={customLabel}
          blurb={`Goes on the order like a custom item, at this price, with what's in it.${customOrderLine(customLabel, 1, picked).isAlcohol ? " It counts as alcohol, so the ID check applies." : ""}`}
          suggested={priceSummary({ cost: customCost, target }).suggested}
          cost={customCost}
          approvalTarget="custom"
          onClose={() => setSheet(null)}
          onAdd={(price, note) => {
            setSheet(null);
            onAddCustom(customOrderLine(customLabel, price, picked), note);
          }}
        />
      )}
    </div>
  );
}

function DrinkCard({
  drink,
  headline,
  statusLabel,
  priceText,
  menuOut,
  suggested,
  onRingUp,
  onAdd,
  onBack,
  backLabel,
}: {
  drink: BookDrink;
  headline: string;
  statusLabel: ReturnType<typeof drinkStatus>;
  priceText: string;
  menuOut: string | null;
  suggested: number | null;
  onRingUp: () => void;
  onAdd: () => void;
  onBack: (() => void) | null;
  backLabel: string;
}) {
  const ok = statusLabel.state === "ok";
  return (
    <section className="rounded-xl border-2 p-4" style={{ borderColor: "var(--foreground)", background: "var(--surface)" }}>
      <div className="flex items-start gap-4">
        <DrinkIcon spec={drink.spec} size={110} label={drink.name} />
        <div className="min-w-0 flex-1 space-y-2">
          <h3 className="font-display text-2xl leading-tight">{headline}</h3>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span
              className="rounded-full px-2.5 py-1 text-xs font-bold"
              style={ok ? { background: "var(--success-bg)", color: "var(--success-text)" } : { background: "var(--warn-bg)", color: "var(--warn-text)" }}
            >
              {statusLabel.label}
            </span>
            <span style={{ color: "var(--muted)" }}>
              {drink.menu ? `On our menu as ${drink.menu.name}, ${money(drink.menu.price)}.` : "Not on our menu yet."}
              {menuOut ? ` ${menuOut}.` : ""}
            </span>
          </div>
          <p className="rounded-md px-2.5 py-1.5 text-sm font-semibold" style={{ background: "var(--surface-hover)" }}>
            {priceText}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {drink.menu ? (
              <button className="btn-primary min-h-12 !px-6 !text-base" onClick={onRingUp}>
                Ring it up · {money(drink.menu.price)}
              </button>
            ) : (
              <button className="btn-primary min-h-12 !px-6 !text-base" onClick={onAdd}>
                Add to order{suggested !== null ? ` · $${suggested}` : ""}
              </button>
            )}
            {onBack && (
              <button className="min-h-11 px-2 text-sm font-semibold underline" onClick={onBack}>
                {backLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

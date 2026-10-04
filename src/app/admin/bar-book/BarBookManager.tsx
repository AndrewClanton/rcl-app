"use client";

import { useMemo, useState } from "react";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import DrinkIcon from "@/components/bar/DrinkIcon";
import type { BarIngredient } from "@/lib/data/barBook";
import { mainIngredients, nameKey, type BookRecipe } from "@/lib/bar/book";
import {
  FAMILIES,
  FAMILY_COLOR,
  FAMILY_LABEL,
  GLASSES,
  GLASS_LABEL,
  ICE,
  KINDS,
  METHODS,
  METHOD_LABEL,
  iconSpecFor,
  isFamily,
  normalizeGlass,
  type GlassKey,
  type Ice,
  type Method,
} from "@/lib/bar/icons";
import { deleteBookDrink, saveBookDrink, setIngredientBar } from "./actions";

const KIND_LABEL: Record<string, string> = {
  spirit: "Spirit",
  liqueur: "Liqueur",
  mixer: "Mixer",
  juice: "Juice",
  syrup: "Syrup",
  bitters: "Bitters",
  garnish: "Garnish",
  beer: "Beer",
  wine: "Wine",
  other: "Other",
};
const ICE_LABEL: Record<Ice, string> = { none: "No ice", cubes: "Ice cubes", crushed: "Crushed ice" };

export default function BarBookManager({ ingredients, drinks }: { ingredients: BarIngredient[]; drinks: BookRecipe[] }) {
  return (
    <div className="space-y-6">
      <Drinks drinks={drinks} ingredients={ingredients} />
      <Ingredients ingredients={ingredients} />
    </div>
  );
}

// ---------- ingredients ----------

function Ingredients({ ingredients }: { ingredients: BarIngredient[] }) {
  const [query, setQuery] = useState("");
  const [onlyUnset, setOnlyUnset] = useState(false);
  const shown = useMemo(() => {
    const q = nameKey(query);
    return ingredients.filter((i) => i.active && (!q || nameKey(i.name).includes(q)) && (!onlyUnset || !i.kind || !i.family));
  }, [ingredients, query, onlyUnset]);
  const notCarried = ingredients.filter((i) => i.active && !i.carried).length;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Ingredients</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Untick <strong>Carried</strong> for anything the bar doesn&apos;t stock: the book then says &quot;No …&quot; on every drink that needs it. {notCarried} not carried.
        The color is what the drink icons fill the glass with.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input className="input max-w-xs" type="search" placeholder="Find an ingredient" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
          <input type="checkbox" checked={onlyUnset} onChange={(e) => setOnlyUnset(e.target.checked)} />
          Only ones missing a kind or color
        </label>
      </div>
      <div className="mt-3 divide-y divide-[var(--border)]">
        {shown.map((i) => (
          <IngredientRow key={i.id} ingredient={i} />
        ))}
        {shown.length === 0 && <p className="py-3 text-sm text-[var(--muted)]">No ingredients match.</p>}
      </div>
    </section>
  );
}

function IngredientRow({ ingredient }: { ingredient: BarIngredient }) {
  const [pending, run] = useRefreshingAction();
  const family = isFamily(ingredient.family) ? ingredient.family : null;
  return (
    <div className="flex flex-wrap items-center gap-2 py-2" style={pending ? { opacity: 0.6 } : undefined}>
      <span className="h-4 w-4 shrink-0 rounded" style={{ background: family ? FAMILY_COLOR[family] : "var(--border)" }} aria-hidden />
      <span className="min-w-[160px] flex-1 text-sm font-medium">
        {ingredient.name}
        {ingredient.category && <span className="ml-1.5 text-xs text-[var(--muted)]">{ingredient.category}</span>}
      </span>
      <select
        className="input !w-auto !py-1.5"
        value={ingredient.kind ?? ""}
        aria-label={`What ${ingredient.name} is`}
        onChange={(e) => run(() => setIngredientBar(ingredient.id, { kind: e.target.value || null }))}
      >
        <option value="">Kind…</option>
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>
      <select
        className="input !w-auto !py-1.5"
        value={family ?? ""}
        aria-label={`${ingredient.name}'s color on the drink icons`}
        onChange={(e) => run(() => setIngredientBar(ingredient.id, { family: e.target.value || null }))}
      >
        <option value="">Color…</option>
        {FAMILIES.map((f) => (
          <option key={f} value={f}>
            {FAMILY_LABEL[f]}
          </option>
        ))}
      </select>
      <label className="flex min-h-9 items-center gap-1.5 text-sm">
        <input type="checkbox" checked={ingredient.carried} onChange={(e) => run(() => setIngredientBar(ingredient.id, { carried: e.target.checked }))} />
        Carried
      </label>
    </div>
  );
}

// ---------- drinks ----------

function Drinks({ drinks, ingredients }: { drinks: BookRecipe[]; ingredients: BarIngredient[] }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [showSeed, setShowSeed] = useState(false);
  const house = drinks.filter((d) => d.source !== "seed");
  const seed = drinks.filter((d) => d.source === "seed");
  const list = showSeed ? drinks : house;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Our drinks (not on the menu)</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            House drinks for the book: the register shows them with &quot;Not on our menu yet&quot; and can&apos;t ring them up. Drinks on the menu get their recipe in Menu → the item → Recipe.
            {seed.length > 0 && ` Plus ${seed.length} from the starter list.`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {seed.length > 0 && (
            <label className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
              <input type="checkbox" checked={showSeed} onChange={(e) => setShowSeed(e.target.checked)} />
              Show the starter list
            </label>
          )}
          <button className="btn-primary" onClick={() => setEditing("new")}>
            Add a drink
          </button>
        </div>
      </div>
      {editing === "new" && <DrinkForm ingredients={ingredients} onDone={() => setEditing(null)} />}
      <div className="mt-3 divide-y divide-[var(--border)]">
        {list.map((d) =>
          editing === d.id ? (
            <DrinkForm key={d.id} drink={d} ingredients={ingredients} onDone={() => setEditing(null)} />
          ) : (
            <div key={d.id} className="flex items-center gap-3 py-2">
              <span className="text-[var(--foreground)]">
                <DrinkIcon
                  spec={iconSpecFor({ glassware: d.glassware, garnishes: d.garnishes, ice: d.ice, ingredients: d.lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, family: l.family, kind: l.kind })) })}
                  size={40}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">
                  {d.name}
                  {d.source === "seed" && <span className="ml-2 text-xs font-normal text-[var(--muted)]">starter list</span>}
                </span>
                <span className="block truncate text-xs text-[var(--muted)]">{mainIngredients(d, 5) || "No ingredients yet"}</span>
              </span>
              <button className="btn-secondary !px-3 !py-1.5" onClick={() => setEditing(d.id)}>
                Edit
              </button>
            </div>
          ),
        )}
        {list.length === 0 && <p className="py-3 text-sm text-[var(--muted)]">No house drinks yet.</p>}
      </div>
    </section>
  );
}

type FormLine = { ingredientId: string; quantity: string; optional: boolean };

function DrinkForm({ drink, ingredients, onDone }: { drink?: BookRecipe; ingredients: BarIngredient[]; onDone: () => void }) {
  const [pending, run, error] = useRefreshingAction();
  const [name, setName] = useState(drink?.name ?? "");
  const [glass, setGlass] = useState<GlassKey>(normalizeGlass(drink?.glassware) ?? "rocks");
  const [method, setMethod] = useState<Method>(drink?.method ?? "shake");
  const [ice, setIce] = useState<Ice>(drink?.ice === "none" || drink?.ice === "cubes" || drink?.ice === "crushed" ? drink.ice : "cubes");
  const [garnishes, setGarnishes] = useState((drink?.garnishes ?? []).join(", "));
  const [description, setDescription] = useState(drink?.description ?? "");
  const [instructions, setInstructions] = useState(drink?.instructions ?? "");
  const [lines, setLines] = useState<FormLine[]>(
    drink?.lines.length ? drink.lines.map((l) => ({ ingredientId: l.ingredientId, quantity: String(l.quantity), optional: l.optional })) : [{ ingredientId: "", quantity: "", optional: false }],
  );
  const choices = useMemo(() => ingredients.filter((i) => i.active), [ingredients]);
  const unitOf = (id: string) => ingredients.find((i) => i.id === id)?.unit ?? "oz";

  function save() {
    run(async () => {
      const r = await saveBookDrink({
        id: drink?.id ?? null,
        name,
        glass,
        method,
        ice,
        garnishes: garnishes.split(",").map((g) => g.trim()).filter(Boolean),
        description,
        instructions,
        lines: lines.filter((l) => l.ingredientId).map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity), optional: l.optional })),
      });
      if (r.ok) onDone();
      return r;
    });
  }

  return (
    <div className="my-3 space-y-3 rounded-lg border-2 border-[var(--foreground)] p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label-xs block">Name</span>
          <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="label-xs block">Garnishes (commas between)</span>
          <input className="input" value={garnishes} placeholder="Salt rim, lime wheel" onChange={(e) => setGarnishes(e.target.value)} />
        </label>
        <label className="block">
          <span className="label-xs block">Glass</span>
          <select className="input" value={glass} onChange={(e) => setGlass(e.target.value as GlassKey)}>
            {GLASSES.map((g) => (
              <option key={g} value={g}>
                {GLASS_LABEL[g]}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label-xs block">How it&apos;s made</span>
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value as Method)}>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label-xs block">Ice</span>
            <select className="input" value={ice} onChange={(e) => setIce(e.target.value as Ice)}>
              {ICE.map((i) => (
                <option key={i} value={i}>
                  {ICE_LABEL[i]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <label className="block">
        <span className="label-xs block">One line about it (shown on the recipe card)</span>
        <input className="input" value={description} maxLength={400} onChange={(e) => setDescription(e.target.value)} />
      </label>

      <div>
        <span className="label-xs block">Ingredients</span>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select
                className="input !w-auto min-w-[200px] flex-1"
                value={l.ingredientId}
                onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, ingredientId: e.target.value } : x)))}
                aria-label="Ingredient"
              >
                <option value="">Pick an ingredient…</option>
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.carried ? "" : " (not carried)"}
                  </option>
                ))}
              </select>
              <input
                className="input !w-24"
                inputMode="decimal"
                value={l.quantity}
                placeholder="Amount"
                onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                aria-label="Amount"
              />
              <span className="w-10 text-xs text-[var(--muted)]">{l.ingredientId ? (unitOf(l.ingredientId) === "count" ? "ct" : unitOf(l.ingredientId)) : ""}</span>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={l.optional} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, optional: e.target.checked } : x)))} />
                Optional
              </label>
              <button className="text-sm text-[var(--danger-text)]" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove this ingredient">
                Remove
              </button>
            </div>
          ))}
        </div>
        <button className="btn-secondary mt-2 !px-3 !py-1.5" onClick={() => setLines([...lines, { ingredientId: "", quantity: "", optional: false }])}>
          + Ingredient
        </button>
        <p className="mt-1 text-xs text-[var(--muted)]">Not in the list? Add it on Ingredients &amp; counts first. Optional ones (a garnish, a float) never stop the drink being made.</p>
      </div>

      <label className="block">
        <span className="label-xs block">How to make it</span>
        <textarea className="input min-h-20" value={instructions} maxLength={1000} onChange={(e) => setInstructions(e.target.value)} />
      </label>

      {error && <p className="text-sm font-semibold text-[var(--danger-text)]">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={pending} onClick={save}>
          {pending ? "Saving…" : drink ? "Save" : "Add to the book"}
        </button>
        <button className="btn-secondary" disabled={pending} onClick={onDone}>
          Cancel
        </button>
        {drink && (
          <button
            className="ml-auto text-sm font-semibold text-[var(--danger-text)]"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Take ${drink.name} out of the book?`)) run(async () => {
                const r = await deleteBookDrink(drink.id);
                if (r.ok) onDone();
                return r;
              });
            }}
          >
            Take it out of the book
          </button>
        )}
      </div>
    </div>
  );
}

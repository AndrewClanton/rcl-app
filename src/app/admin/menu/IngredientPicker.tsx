"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Ingredient, IngredientUnit, ParItemRef } from "@/lib/types";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { guessUnit, parPlace, parPlaceAndSource, searchPicker, suggestCategory, suggestParPlacement } from "@/lib/ingredient-search";
import { addNewRecipeIngredient, addRecipeIngredient, addRecipeIngredientFromPar } from "./actions";

// Adds a line to a recipe. One search box covers the ingredient list and the
// par sheet, so a recipe can use anything we buy (popping oil, the paper
// bag), not only what's already an ingredient. Three ways out of it:
//   - an ingredient: say how much, Add.
//   - a par sheet line: say how it's measured, and it becomes an ingredient.
//   - something we don't have at all: "Add ... as a new ingredient", which
//     can also put it on the par sheet so it gets counted and bought.

type Choice = { kind: "ingredient"; ingredient: Ingredient } | { kind: "par"; par: ParItemRef } | { kind: "new"; name: string };

const input = "rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
const label = "mb-1 block text-xs text-[var(--muted)]";
const addButton = "rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50";
const quietButton = "rounded border border-[var(--border)] px-2 py-1.5 text-xs";

function unitLabel(unit: IngredientUnit) {
  return unit === "count" ? "ct" : unit;
}

export default function IngredientPicker({
  menuItemId,
  ingredients,
  parItems,
  usedIngredientIds,
}: {
  menuItemId: string;
  ingredients: Ingredient[];
  parItems: ParItemRef[];
  usedIngredientIds: string[];
}) {
  const [query, setQuery] = useState("");
  const [choice, setChoice] = useState<Choice | null>(null);

  function done() {
    setChoice(null);
    setQuery("");
  }

  if (!choice) {
    return (
      <SearchBox
        query={query}
        setQuery={setQuery}
        ingredients={ingredients}
        parItems={parItems}
        usedIngredientIds={usedIngredientIds}
        onPick={setChoice}
      />
    );
  }
  const back = () => setChoice(null);
  if (choice.kind === "ingredient") return <AddExisting menuItemId={menuItemId} ingredient={choice.ingredient} parItems={parItems} onBack={back} onDone={done} />;
  if (choice.kind === "par") return <AddFromPar menuItemId={menuItemId} par={choice.par} onBack={back} onDone={done} />;
  return <AddNew menuItemId={menuItemId} initialName={choice.name} ingredients={ingredients} parItems={parItems} onBack={back} onDone={done} />;
}

// ---------- the search box (a combobox) ----------

type Option = { key: string; choice: Choice };
type Group = { heading: string; options: Option[]; more?: number };

function SearchBox({
  query,
  setQuery,
  ingredients,
  parItems,
  usedIngredientIds,
  onPick,
}: {
  query: string;
  setQuery: (q: string) => void;
  ingredients: Ingredient[];
  parItems: ParItemRef[];
  usedIngredientIds: string[];
  onPick: (c: Choice) => void;
}) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const parById = useMemo(() => new Map(parItems.map((p) => [p.id, p])), [parItems]);
  const results = useMemo(
    () => searchPicker(query, { ingredients, parItems, usedIngredientIds }),
    [query, ingredients, parItems, usedIngredientIds],
  );

  const groups: Group[] = useMemo(() => {
    const ing = (i: Ingredient): Option => ({ key: `i-${i.id}`, choice: { kind: "ingredient", ingredient: i } });
    if (!query.trim()) {
      const byCategory = new Map<string, Option[]>();
      for (const i of results.ingredients) {
        const heading = i.category || "No category";
        byCategory.set(heading, [...(byCategory.get(heading) ?? []), ing(i)]);
      }
      return [...byCategory.entries()].map(([heading, options]) => ({ heading, options }));
    }
    const out: Group[] = [];
    if (results.ingredients.length) out.push({ heading: "Ingredients", options: results.ingredients.map(ing), more: results.moreIngredients });
    if (results.parItems.length)
      out.push({
        heading: "On the par sheet",
        options: results.parItems.map((p) => ({ key: `p-${p.id}`, choice: { kind: "par", par: p } })),
        more: results.moreParItems,
      });
    if (!results.exact) out.push({ heading: "Not on either list?", options: [{ key: "new", choice: { kind: "new", name: query.trim().replace(/\s+/g, " ") } }] });
    return out;
  }, [query, results]);

  const options = groups.flatMap((g) => g.options);
  const activeIndex = options.length ? Math.min(active, options.length - 1) : -1;
  // Where each group's options start in the flat list the arrow keys walk.
  const starts = groups.map((_, gi) => groups.slice(0, gi).reduce((sum, g) => sum + g.options.length, 0));

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    document.getElementById(`${baseId}-opt-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, baseId]);

  function pick(i: number) {
    const o = options[i];
    if (!o) return;
    setOpen(false);
    onPick(o.choice);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(e.key === "ArrowDown" ? 0 : Math.max(0, options.length - 1));
        return;
      }
      if (options.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + options.length) % options.length);
    } else if (e.key === "Enter") {
      if (open && activeIndex >= 0) {
        e.preventDefault();
        pick(activeIndex);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      } else if (query) {
        e.preventDefault();
        setQuery("");
      }
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative mt-2">
      <label htmlFor={`${baseId}-input`} className={label}>
        Add an ingredient
      </label>
      <input
        id={`${baseId}-input`}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className={`${input} w-full`}
        placeholder="Search ingredients and the par sheet…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          // A tap on the list (iPad) can move focus into it; that isn't leaving.
          if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Ingredients and par sheet"
          tabIndex={-1}
          className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 text-sm shadow-lg"
          // Clicking the list keeps the typing focus in the box.
          onMouseDown={(e) => e.preventDefault()}
          onBlur={(e) => {
            if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
          }}
        >
          {groups.length === 0 && (
            <div className="px-3 py-2 text-[var(--muted)]">
              {results.alreadyInRecipe
                ? `${results.alreadyInRecipe} is already in this recipe.`
                : query.trim()
                  ? "Nothing matches."
                  : "Every ingredient is already in this recipe. Type a name to add a new one."}
            </div>
          )}
          {groups.map((g, gi) => (
            <div key={g.heading} role="group" aria-labelledby={`${baseId}-group-${gi}`}>
              <div id={`${baseId}-group-${gi}`} className="px-3 pb-0.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                {g.heading}
              </div>
              {g.options.map((o, oi) => {
                const i = starts[gi] + oi;
                return (
                  <div
                    key={o.key}
                    id={optionId(i)}
                    role="option"
                    tabIndex={-1}
                    aria-selected={i === activeIndex}
                    className={`flex cursor-pointer flex-wrap items-baseline gap-x-2 px-3 py-2 ${i === activeIndex ? "bg-[var(--surface-hover)]" : ""}`}
                    onMouseMove={() => i !== activeIndex && setActive(i)}
                    onClick={() => pick(i)}
                  >
                    <OptionText choice={o.choice} parById={parById} />
                  </div>
                );
              })}
              {!!g.more && <div className="px-3 py-1 text-xs text-[var(--muted)]">{g.more} more. Keep typing to narrow it down.</div>}
            </div>
          ))}
          {results.alreadyInRecipe && groups.length > 0 && (
            <div className="px-3 py-1.5 text-xs text-[var(--muted)]">{results.alreadyInRecipe} is already in this recipe.</div>
          )}
        </div>
      )}
    </div>
  );
}

function OptionText({ choice, parById }: { choice: Choice; parById: Map<string, ParItemRef> }) {
  if (choice.kind === "ingredient") {
    const i = choice.ingredient;
    const par = i.par_item_id ? parById.get(i.par_item_id) : undefined;
    return (
      <>
        <span>{i.name}</span>
        <span className="text-xs text-[var(--muted)]">
          {[i.category, unitLabel(i.unit), par ? parPlace(par) : null].filter(Boolean).join(" · ")}
        </span>
      </>
    );
  }
  if (choice.kind === "par") {
    return (
      <>
        <span>{choice.par.name}</span>
        <span className="text-xs text-[var(--muted)]">{parPlaceAndSource(choice.par)}</span>
      </>
    );
  }
  return (
    <span className="font-medium text-[var(--accent)]">
      ＋ Add &ldquo;{choice.name}&rdquo; as a new ingredient
    </span>
  );
}

// ---------- shared bits ----------

function UnitToggle({ value, onChange }: { value: IngredientUnit; onChange: (u: IngredientUnit) => void }) {
  const units: { value: IngredientUnit; text: string }[] = [
    { value: "oz", text: "oz" },
    { value: "ml", text: "ml" },
    { value: "count", text: "count" },
  ];
  return (
    <div role="radiogroup" aria-label="Measured in" className="inline-flex overflow-hidden rounded border border-[var(--border)]">
      {units.map((u, idx) => (
        <button
          key={u.value}
          type="button"
          role="radio"
          aria-checked={value === u.value}
          className={`px-3 py-1.5 text-sm ${idx > 0 ? "border-l border-[var(--border)]" : ""} ${
            value === u.value ? "bg-[var(--foreground)] text-[var(--surface)]" : "bg-[var(--surface)]"
          }`}
          onClick={() => onChange(u.value)}
        >
          {u.text}
        </button>
      ))}
    </div>
  );
}

function QuantityField({ unit, value, onChange, autoFocus }: { unit: IngredientUnit; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={label}>
        How much ({unitLabel(unit)})
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step="any"
        min="0"
        className={`${input} w-24`}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p className="mt-2 text-sm text-[var(--danger-text)]">{error}</p> : null;
}

const panel = "mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3";

// ---------- an ingredient we already have ----------

function AddExisting({
  menuItemId,
  ingredient,
  parItems,
  onBack,
  onDone,
}: {
  menuItemId: string;
  ingredient: Ingredient;
  parItems: ParItemRef[];
  onBack: () => void;
  onDone: () => void;
}) {
  const [pending, run, error] = useRefreshingAction();
  const [quantity, setQuantity] = useState("");
  const qty = parseFloat(quantity);
  const par = ingredient.par_item_id ? parItems.find((p) => p.id === ingredient.par_item_id) : undefined;

  return (
    <form
      className={panel}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending || !(qty > 0)) return;
        run(async () => {
          const r = await addRecipeIngredient(menuItemId, ingredient.id, qty);
          if (r.ok) onDone();
          return r;
        }, { quiet: true });
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[160px] flex-1">
          <div className="text-sm font-medium">{ingredient.name}</div>
          <div className="text-xs text-[var(--muted)]">{[ingredient.category, par ? parPlace(par) : null].filter(Boolean).join(" · ")}</div>
        </div>
        <QuantityField unit={ingredient.unit} value={quantity} onChange={setQuantity} autoFocus />
        <button type="submit" className={addButton} disabled={pending || !(qty > 0)}>
          {pending ? "Adding…" : "Add"}
        </button>
        <button type="button" className={quietButton} onClick={onBack}>
          Back
        </button>
      </div>
      <ErrorLine error={error} />
    </form>
  );
}

// ---------- a par sheet line becomes an ingredient ----------

function AddFromPar({ menuItemId, par, onBack, onDone }: { menuItemId: string; par: ParItemRef; onBack: () => void; onDone: () => void }) {
  const [pending, run, error] = useRefreshingAction();
  const [unit, setUnit] = useState<IngredientUnit>(() => guessUnit(par.name));
  const [category, setCategory] = useState(par.section ?? "");
  const [quantity, setQuantity] = useState("");
  const categoryId = useId();
  const qty = parseFloat(quantity);

  return (
    <form
      className={panel}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending || !(qty > 0)) return;
        run(async () => {
          const r = await addRecipeIngredientFromPar(menuItemId, par.id, { unit, category: category.trim() || null }, qty);
          if (r.ok) onDone();
          return r;
        }, { quiet: true });
      }}
    >
      <p className="mb-2 text-sm">
        <span className="font-medium">{par.name}</span>{" "}
        <span className="text-[var(--muted)]">is on the par sheet ({parPlaceAndSource(par)}). Adding it here makes it an ingredient too.</span>
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <span className={label}>How is it measured in recipes?</span>
          <UnitToggle value={unit} onChange={setUnit} />
        </div>
        <div>
          <label htmlFor={categoryId} className={label}>
            Category
          </label>
          <input id={categoryId} className={`${input} w-36`} value={category} maxLength={40} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <QuantityField unit={unit} value={quantity} onChange={setQuantity} autoFocus />
        <button type="submit" className={addButton} disabled={pending || !(qty > 0)}>
          {pending ? "Adding…" : "Add"}
        </button>
        <button type="button" className={quietButton} onClick={onBack}>
          Back
        </button>
      </div>
      <ErrorLine error={error} />
    </form>
  );
}

// ---------- something new ----------

type Guess = { unit: IngredientUnit; category: string; area: string; section: string; parUnit: string; source: string };

function uniqueSorted(values: (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    const t = v?.trim();
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

function AddNew({
  menuItemId,
  initialName,
  ingredients,
  parItems,
  onBack,
  onDone,
}: {
  menuItemId: string;
  initialName: string;
  ingredients: Ingredient[];
  parItems: ParItemRef[];
  onBack: () => void;
  onDone: () => void;
}) {
  const [pending, run, error] = useRefreshingAction();
  const id = useId();
  const [name, setName] = useState(initialName);
  const [alsoPar, setAlsoPar] = useState(true);
  const [parQty, setParQty] = useState("");
  const [quantity, setQuantity] = useState("");
  // What the person changed; everything else follows the name.
  const [edits, setEdits] = useState<Partial<Guess>>({});

  const active = useMemo(() => parItems.filter((p) => p.active), [parItems]);
  const suggestion = useMemo(() => suggestParPlacement(name, active), [name, active]);
  const guess: Guess = {
    unit: guessUnit(name),
    category: suggestCategory(name, ingredients, suggestion),
    area: suggestion?.area ?? "",
    section: suggestion?.section ?? "",
    parUnit: suggestion?.unit ?? "",
    source: suggestion?.source ?? "",
  };
  const v = { ...guess, ...edits };
  const set = (patch: Partial<Guess>) => setEdits((e) => ({ ...e, ...patch }));

  const areas = useMemo(() => uniqueSorted(active.map((p) => p.area)), [active]);
  const sectionsByArea = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of areas) m.set(a, uniqueSorted(active.filter((p) => p.area === a).map((p) => p.section)));
    return m;
  }, [active, areas]);
  const categories = useMemo(() => uniqueSorted([...ingredients.map((i) => i.category), ...active.map((p) => p.section)]), [ingredients, active]);
  const parUnits = useMemo(() => uniqueSorted(active.filter((p) => !v.area || p.area === v.area).map((p) => p.unit)), [active, v.area]);
  const sources = useMemo(() => uniqueSorted(active.map((p) => p.source)), [active]);

  const qty = parseFloat(quantity);
  const parQtyNum = parQty.trim() === "" ? null : parseFloat(parQty);
  const parQtyBad = parQtyNum !== null && !(parQtyNum >= 0);
  const canSubmit = !pending && name.trim() !== "" && qty > 0 && (!alsoPar || (v.area !== "" && !parQtyBad));
  const nextTo = suggestion && v.area === suggestion.area && v.section === (suggestion.section ?? "") ? suggestion.like.name : null;

  return (
    <form
      className={panel}
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        const fields = { name: name.trim(), unit: v.unit, category: v.category.trim() || null };
        const par = alsoPar
          ? { area: v.area, section: v.section.trim() || null, par_qty: parQtyNum, unit: v.parUnit.trim() || null, source: v.source.trim() || null }
          : null;
        run(async () => {
          const r = await addNewRecipeIngredient(menuItemId, fields, par, qty);
          if (r.ok) onDone();
          return r;
        }, { quiet: true });
      }}
    >
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">New ingredient</div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1">
          <label htmlFor={`${id}-name`} className={label}>
            Name
          </label>
          <input id={`${id}-name`} className={`${input} w-full`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <span className={label}>Measured in</span>
          <UnitToggle value={v.unit} onChange={(unit) => set({ unit })} />
        </div>
        <div>
          <label htmlFor={`${id}-cat`} className={label}>
            Category
          </label>
          <input
            id={`${id}-cat`}
            list={`${id}-cats`}
            className={`${input} w-36`}
            value={v.category}
            maxLength={40}
            placeholder="e.g. Syrups"
            onChange={(e) => set({ category: e.target.value })}
          />
          <datalist id={`${id}-cats`}>
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" checked={alsoPar} onChange={(e) => setAlsoPar(e.target.checked)} />
        Also add it to the par sheet
      </label>
      {alsoPar && (
        <div className="mt-2 rounded border border-dashed border-[var(--border)] p-2">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor={`${id}-area`} className={label}>
                Sheet
              </label>
              <select
                id={`${id}-area`}
                className={input}
                value={v.area}
                onChange={(e) => {
                  const area = e.target.value;
                  const keepSection = (sectionsByArea.get(area) ?? []).includes(v.section);
                  set({ area, section: keepSection ? v.section : "" });
                }}
              >
                <option value="">Pick one…</option>
                {areas.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-section`} className={label}>
                Section
              </label>
              <input
                id={`${id}-section`}
                list={`${id}-sections`}
                className={`${input} w-36`}
                value={v.section}
                maxLength={60}
                placeholder="e.g. Syrups"
                onChange={(e) => set({ section: e.target.value })}
              />
              <datalist id={`${id}-sections`}>
                {(sectionsByArea.get(v.area) ?? []).map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor={`${id}-parqty`} className={label}>
                Par
              </label>
              <input
                id={`${id}-parqty`}
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                className={`${input} w-20`}
                placeholder="e.g. 1"
                value={parQty}
                onChange={(e) => setParQty(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor={`${id}-parunit`} className={label}>
                Counted as
              </label>
              <input
                id={`${id}-parunit`}
                list={`${id}-parunits`}
                className={`${input} w-28`}
                value={v.parUnit}
                maxLength={40}
                placeholder="e.g. bottle"
                onChange={(e) => set({ parUnit: e.target.value })}
              />
              <datalist id={`${id}-parunits`}>
                {parUnits.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor={`${id}-source`} className={label}>
                Where to buy
              </label>
              <input
                id={`${id}-source`}
                list={`${id}-sources`}
                className={`${input} w-36`}
                value={v.source}
                maxLength={60}
                placeholder="e.g. Walmart"
                onChange={(e) => set({ source: e.target.value })}
              />
              <datalist id={`${id}-sources`}>
                {sources.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
          </div>
          <p className="mt-1.5 text-xs text-[var(--muted)]">
            {nextTo
              ? `Next to ${nextTo}.`
              : v.area
                ? "It goes at the end of that section."
                : "Pick which sheet it goes on."}
            {parQtyBad && <span className="text-[var(--danger-text)]"> Par should be a number, like 1 or 0.5.</span>}
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <QuantityField unit={v.unit} value={quantity} onChange={setQuantity} />
        <button type="submit" className={addButton} disabled={!canSubmit}>
          {pending ? "Adding…" : "Add to recipe"}
        </button>
        <button type="button" className={quietButton} onClick={onBack}>
          Cancel
        </button>
      </div>
      <ErrorLine error={error} />
    </form>
  );
}

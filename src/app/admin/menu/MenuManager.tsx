"use client";

import { useMemo, useState } from "react";
import type { Ingredient, MenuCategory, Recipe } from "@/lib/types";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { addCategory, addSubcategory, renameCategory, deleteCategory, reorderCategory, addItem, updateItem, deleteItem } from "./actions";
import ItemModifiers from "./ItemModifiers";
import ItemRecipe from "./ItemRecipe";

export default function MenuManager({
  categories,
  ingredients,
  recipesByItem,
}: {
  categories: MenuCategory[];
  ingredients: Ingredient[];
  recipesByItem: Record<string, Recipe>;
}) {
  const [nav, setNav] = useState<{ categoryId: string | null; subcategoryId: string | null }>({ categoryId: null, subcategoryId: null });

  const category = useMemo(() => categories.find((c) => c.id === nav.categoryId) ?? null, [categories, nav.categoryId]);
  const subcategory = useMemo(
    () => category?.subcategories.find((s) => s.id === nav.subcategoryId) ?? null,
    [category, nav.subcategoryId]
  );

  if (!category) {
    return <CategoryList categories={categories} onManage={(id) => setNav({ categoryId: id, subcategoryId: null })} />;
  }

  if (category.subcategories.length > 0 && !subcategory) {
    return (
      <SubcategoryList
        parent={category}
        onBack={() => setNav({ categoryId: null, subcategoryId: null })}
        onManage={(id) => setNav({ categoryId: category.id, subcategoryId: id })}
      />
    );
  }

  const target = subcategory ?? category;
  return (
    <ItemManager
      target={target}
      ingredients={ingredients}
      recipesByItem={recipesByItem}
      onBack={() =>
        subcategory
          ? setNav({ categoryId: category.id, subcategoryId: null })
          : setNav({ categoryId: null, subcategoryId: null })
      }
      backLabel={subcategory ? "← Back to subcategories" : "← Back to categories"}
    />
  );
}

function CategoryList({ categories, onManage }: { categories: MenuCategory[]; onManage: (id: string) => void }) {
  const [pending, run] = useRefreshingAction();
  const [newName, setNewName] = useState("");
  const ids = categories.map((c) => c.id);

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">Categories</h2>
      <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {categories.map((cat, idx) => {
          const count = cat.subcategories.length
            ? cat.subcategories.reduce((s, sc) => s + sc.items.length, 0)
            : cat.items.length;
          return (
            <div key={cat.id} className="flex flex-wrap items-center gap-2 py-2">
              <button
                className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-30 dark:border-neutral-700"
                disabled={idx === 0 || pending}
                onClick={() => run(() => reorderCategory(cat.id, "up", ids))}
              >
                ↑
              </button>
              <button
                className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-30 dark:border-neutral-700"
                disabled={idx === categories.length - 1 || pending}
                onClick={() => run(() => reorderCategory(cat.id, "down", ids))}
              >
                ↓
              </button>
              <CategoryLabelInput id={cat.id} label={cat.label} />
              <span className="text-xs text-neutral-500">{count} item(s)</span>
              <button className="ml-auto rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700" onClick={() => onManage(cat.id)}>
                Manage items
              </button>
              <button
                className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 dark:border-red-900"
                disabled={pending}
                onClick={() => {
                  if (confirm(`Delete category "${cat.label}" and everything in it? This cannot be undone.`)) {
                    run(() => deleteCategory(cat.id));
                  }
                }}
              >
                Delete category
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          placeholder="New category name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          disabled={pending || !newName.trim()}
          onClick={() => {
            const name = newName;
            setNewName("");
            run(() => addCategory(name));
          }}
        >
          Add category
        </button>
      </div>
    </div>
  );
}

function CategoryLabelInput({ id, label }: { id: string; label: string }) {
  const [value, setValue] = useState(label);
  const [, run] = useRefreshingAction();
  return (
    <input
      className="min-w-[140px] flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value.trim() && value !== label) run(() => renameCategory(id, value));
      }}
    />
  );
}

function SubcategoryList({
  parent,
  onBack,
  onManage,
}: {
  parent: MenuCategory;
  onBack: () => void;
  onManage: (id: string) => void;
}) {
  const [pending, run] = useRefreshingAction();
  const [newName, setNewName] = useState("");

  return (
    <div>
      <button className="mb-3 rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700" onClick={onBack}>
        ← Back to categories
      </button>
      <h2 className="mb-1 text-lg font-semibold">Managing: {parent.label}</h2>
      <div className="mb-3 text-sm text-neutral-500">Subcategories</div>
      <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {parent.subcategories.map((sub) => (
          <div key={sub.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="min-w-[140px] flex-1 text-sm">{sub.label}</span>
            <span className="text-xs text-neutral-500">{sub.items.length} item(s)</span>
            <button className="rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700" onClick={() => onManage(sub.id)}>
              Manage items
            </button>
            <button
              className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 dark:border-red-900"
              disabled={pending}
              onClick={() => {
                if (confirm(`Delete subcategory "${sub.label}" and all its items?`)) run(() => deleteCategory(sub.id));
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          placeholder="New subcategory name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          disabled={pending || !newName.trim()}
          onClick={() => {
            const name = newName;
            setNewName("");
            run(() => addSubcategory(parent.id, name));
          }}
        >
          Add subcategory
        </button>
      </div>
    </div>
  );
}

function ItemManager({
  target,
  ingredients,
  recipesByItem,
  onBack,
  backLabel,
}: {
  target: MenuCategory;
  ingredients: Ingredient[];
  recipesByItem: Record<string, Recipe>;
  onBack: () => void;
  backLabel: string;
}) {
  const [pending, run] = useRefreshingAction();
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newAlcohol, setNewAlcohol] = useState(false);
  const [openMods, setOpenMods] = useState<Set<string>>(new Set());
  const [openRecipes, setOpenRecipes] = useState<Set<string>>(new Set());

  function toggleMods(id: string) {
    setOpenMods((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleRecipe(id: string) {
    setOpenRecipes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <button className="mb-3 rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700" onClick={onBack}>
        {backLabel}
      </button>
      <h2 className="mb-3 text-lg font-semibold">Managing: {target.label}</h2>

      <div className="space-y-3">
        {target.items.map((item) => (
          <div key={item.id} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex flex-wrap items-center gap-2">
              <ItemNameInput id={item.id} name={item.name} />
              <ItemPriceInput id={item.id} price={item.price} />
              <button className="rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700" onClick={() => toggleMods(item.id)}>
                Modifiers ({item.modifier_groups.length})
              </button>
              {item.is_event_item && <span className="rounded-full border border-blue-400 px-2 py-0.5 text-xs text-blue-600">event item</span>}
              <label className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-500">
                <input
                  type="checkbox"
                  checked={item.is_alcohol}
                  disabled={pending}
                  onChange={(e) => run(() => updateItem(item.id, { is_alcohol: e.target.checked }))}
                />
                alcohol
              </label>
              {item.is_alcohol && (
                <button
                  className="rounded border border-amber-400 px-2 py-1 text-xs text-amber-700 dark:border-amber-800 dark:text-amber-500"
                  onClick={() => toggleRecipe(item.id)}
                >
                  Recipe ({recipesByItem[item.id]?.ingredients.length ?? 0})
                </button>
              )}
              <button
                className="ml-auto rounded border border-red-300 px-2 py-1 text-xs text-red-600 dark:border-red-900"
                disabled={pending}
                onClick={() => {
                  if (confirm(`Delete "${item.name}"?`)) run(() => deleteItem(item.id));
                }}
              >
                Delete item
              </button>
            </div>
            {openMods.has(item.id) && <ItemModifiers item={item} />}
            {openRecipes.has(item.id) && <ItemRecipe item={item} recipe={recipesByItem[item.id] ?? null} ingredients={ingredients} />}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <input
          className="min-w-[160px] flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          placeholder="New item name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <input
          type="number"
          step="0.01"
          min="0"
          className="w-28 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          placeholder="0.00"
          value={newPrice}
          onChange={(e) => setNewPrice(e.target.value)}
        />
        <label className="flex items-center gap-1 pb-1.5 text-xs text-neutral-500">
          <input type="checkbox" checked={newAlcohol} onChange={(e) => setNewAlcohol(e.target.checked)} />
          Alcohol
        </label>
        <button
          className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          disabled={pending || !newName.trim() || !(parseFloat(newPrice) >= 0)}
          onClick={() => {
            const name = newName;
            const priceVal = parseFloat(newPrice);
            const alcohol = newAlcohol;
            setNewName("");
            setNewPrice("");
            setNewAlcohol(false);
            run(() => addItem(target.id, name, priceVal, alcohol));
          }}
        >
          Add item
        </button>
      </div>
    </div>
  );
}

function ItemNameInput({ id, name }: { id: string; name: string }) {
  const [value, setValue] = useState(name);
  const [, run] = useRefreshingAction();
  return (
    <input
      className="min-w-[140px] flex-1 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value.trim() && value !== name) run(() => updateItem(id, { name: value.trim() }));
      }}
    />
  );
}

function ItemPriceInput({ id, price }: { id: string; price: number }) {
  const [value, setValue] = useState(String(price));
  const [, run] = useRefreshingAction();
  return (
    <input
      type="number"
      step="0.01"
      min="0"
      className="w-24 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const v = parseFloat(value);
        if (!isNaN(v) && v !== price) run(() => updateItem(id, { price: v }));
      }}
    />
  );
}

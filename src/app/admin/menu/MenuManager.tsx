"use client";

import { useMemo, useState } from "react";
import type { Ingredient, MenuCategory, MenuItem, ParItemRef, Recipe } from "@/lib/types";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { addCategory, addSubcategory, renameCategory, deleteCategory, reorderCategory, addItem, updateItem, deleteItem, setItemHidden, clearItemOut } from "./actions";
import ItemModifiers from "./ItemModifiers";
import ItemRecipe from "./ItemRecipe";
import MenuPhoto from "./MenuPhoto";
import MenuPictures from "./MenuPictures";
import CategoryIcon from "@/components/menu/CategoryIcon";
import { pictureOf } from "@/lib/menu-pictures/shared";

// canEdit is false for cashiers: the same screens, read-only, so they can
// still look up a price or a recipe. The actions refuse them regardless.
export default function MenuManager({
  categories,
  ingredients,
  parItems,
  recipesByItem,
  canEdit,
}: {
  categories: MenuCategory[];
  ingredients: Ingredient[];
  parItems: ParItemRef[];
  recipesByItem: Record<string, Recipe>;
  canEdit: boolean;
}) {
  const [nav, setNav] = useState<{ categoryId: string | null; subcategoryId: string | null }>({ categoryId: null, subcategoryId: null });

  const category = useMemo(() => categories.find((c) => c.id === nav.categoryId) ?? null, [categories, nav.categoryId]);
  const subcategory = useMemo(
    () => category?.subcategories.find((s) => s.id === nav.subcategoryId) ?? null,
    [category, nav.subcategoryId]
  );

  if (!category) {
    return <CategoryList categories={categories} canEdit={canEdit} onManage={(id) => setNav({ categoryId: id, subcategoryId: null })} />;
  }

  if (category.subcategories.length > 0 && !subcategory) {
    return (
      <SubcategoryList
        parent={category}
        canEdit={canEdit}
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
      parItems={parItems}
      recipesByItem={recipesByItem}
      canEdit={canEdit}
      onBack={() =>
        subcategory
          ? setNav({ categoryId: category.id, subcategoryId: null })
          : setNav({ categoryId: null, subcategoryId: null })
      }
      backLabel={subcategory ? "← Back to subcategories" : "← Back to categories"}
    />
  );
}

function hiddenCount(items: MenuItem[]) {
  return items.filter((i) => !i.active).length;
}

function outCount(items: MenuItem[]) {
  return items.filter((i) => i.out_since).length;
}

const outSince = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

function CategoryList({ categories, canEdit, onManage }: { categories: MenuCategory[]; canEdit: boolean; onManage: (id: string) => void }) {
  const [pending, run] = useRefreshingAction();
  const [newName, setNewName] = useState("");
  const ids = categories.map((c) => c.id);

  return (
    <div>
      {canEdit && <MenuPictures categories={categories} />}
      <h2 className="mb-3 text-lg font-semibold">Categories</h2>
      <div className="divide-y divide-[var(--border)] ">
        {categories.map((cat, idx) => {
          const allItems = cat.subcategories.length ? cat.subcategories.flatMap((sc) => sc.items) : cat.items;
          const hidden = hiddenCount(allItems);
          const out = outCount(allItems);
          return (
            <div key={cat.id} className="flex flex-wrap items-center gap-2 py-2">
              {canEdit && (
                <>
                  <button
                    className="rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-30 "
                    disabled={idx === 0 || pending}
                    onClick={() => run(() => reorderCategory(cat.id, "up", ids))}
                  >
                    ↑
                  </button>
                  <button
                    className="rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-30 "
                    disabled={idx === categories.length - 1 || pending}
                    onClick={() => run(() => reorderCategory(cat.id, "down", ids))}
                  >
                    ↓
                  </button>
                </>
              )}
              {canEdit ? <CategoryLabelInput id={cat.id} label={cat.label} /> : <span className="min-w-[140px] flex-1 text-sm">{cat.label}</span>}
              {/* Its icon on the register tab. */}
              <CategoryIcon category={cat.key} label={cat.label} className="text-[var(--muted)]" />
              <span className="text-xs text-[var(--muted)]">
                {allItems.length} item(s){hidden > 0 && `, ${hidden} hidden`}
                {out > 0 && <span className="text-[var(--accent)]">, {out} out</span>}
              </span>
              <button className="ml-auto rounded border border-[var(--border)] px-2 py-1 text-xs " onClick={() => onManage(cat.id)}>
                {canEdit ? "Manage items" : "See items"}
              </button>
              {canEdit && (
                <button
                  className="rounded border border-[var(--danger-text)] px-2 py-1 text-xs text-[var(--danger-text)] "
                  disabled={pending}
                  onClick={() => {
                    if (confirm(`Delete category "${cat.label}" and everything in it? This cannot be undone.`)) {
                      run(() => deleteCategory(cat.id));
                    }
                  }}
                >
                  Delete category
                </button>
              )}
            </div>
          );
        })}
      </div>

      {canEdit && (
        <div className="mt-3 flex gap-2">
          <input
            className="flex-1 rounded border border-[var(--border)] px-2 py-1 text-sm "
            placeholder="New category name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white disabled:opacity-50 "
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
      )}
    </div>
  );
}

function CategoryLabelInput({ id, label }: { id: string; label: string }) {
  const [value, setValue] = useState(label);
  const [, run] = useRefreshingAction();
  return (
    <input
      className="min-w-[140px] flex-1 rounded border border-[var(--border)] px-2 py-1 text-sm "
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
  canEdit,
  onBack,
  onManage,
}: {
  parent: MenuCategory;
  canEdit: boolean;
  onBack: () => void;
  onManage: (id: string) => void;
}) {
  const [pending, run] = useRefreshingAction();
  const [newName, setNewName] = useState("");

  return (
    <div>
      <button className="mb-3 rounded border border-[var(--border)] px-2 py-1 text-xs " onClick={onBack}>
        ← Back to categories
      </button>
      <h2 className="mb-1 text-lg font-semibold">
        {canEdit ? "Managing" : "Viewing"}: {parent.label}
      </h2>
      <div className="mb-3 text-sm text-[var(--muted)]">Subcategories</div>
      <div className="divide-y divide-[var(--border)] ">
        {parent.subcategories.map((sub) => {
          const hidden = hiddenCount(sub.items);
          const out = outCount(sub.items);
          return (
            <div key={sub.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-[140px] flex-1 text-sm">{sub.label}</span>
              {/* Shown beside its heading on the register. */}
              <CategoryIcon category={sub.key} label={sub.label} className="text-[var(--muted)]" />
              <span className="text-xs text-[var(--muted)]">
                {sub.items.length} item(s){hidden > 0 && `, ${hidden} hidden`}
                {out > 0 && <span className="text-[var(--accent)]">, {out} out</span>}
              </span>
              <button className="rounded border border-[var(--border)] px-2 py-1 text-xs " onClick={() => onManage(sub.id)}>
                {canEdit ? "Manage items" : "See items"}
              </button>
              {canEdit && (
                <button
                  className="rounded border border-[var(--danger-text)] px-2 py-1 text-xs text-[var(--danger-text)] "
                  disabled={pending}
                  onClick={() => {
                    if (confirm(`Delete subcategory "${sub.label}" and all its items?`)) run(() => deleteCategory(sub.id));
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          );
        })}
      </div>
      {canEdit && (
        <div className="mt-3 flex gap-2">
          <input
            className="flex-1 rounded border border-[var(--border)] px-2 py-1 text-sm "
            placeholder="New subcategory name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white disabled:opacity-50 "
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
      )}
    </div>
  );
}

function money(n: number) {
  return `$${Number(n).toFixed(2)}`;
}

function ItemManager({
  target,
  ingredients,
  parItems,
  recipesByItem,
  canEdit,
  onBack,
  backLabel,
}: {
  target: MenuCategory;
  ingredients: Ingredient[];
  parItems: ParItemRef[];
  recipesByItem: Record<string, Recipe>;
  canEdit: boolean;
  onBack: () => void;
  backLabel: string;
}) {
  const [pending, run] = useRefreshingAction();
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newAlcohol, setNewAlcohol] = useState(false);

  return (
    <div>
      <button className="mb-3 rounded border border-[var(--border)] px-2 py-1 text-xs " onClick={onBack}>
        {backLabel}
      </button>
      <h2 className="mb-3 text-lg font-semibold">
        {canEdit ? "Managing" : "Viewing"}: {target.label}
      </h2>

      <div className="space-y-3">
        {target.items.length === 0 && <p className="text-sm text-[var(--muted)]">No items here yet.</p>}
        {target.items.map((item) => (
          <ItemRow key={item.id} item={item} section={target.label} ingredients={ingredients} parItems={parItems} recipe={recipesByItem[item.id] ?? null} canEdit={canEdit} />
        ))}
      </div>

      {canEdit && (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <input
            className="min-w-[160px] flex-1 rounded border border-[var(--border)] px-2 py-1 text-sm "
            placeholder="New item name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            type="number"
            step="0.01"
            min="0"
            className="w-28 rounded border border-[var(--border)] px-2 py-1 text-sm "
            placeholder="0.00"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
          />
          <label className="flex items-center gap-1 pb-1.5 text-xs text-[var(--muted)]">
            <input type="checkbox" checked={newAlcohol} onChange={(e) => setNewAlcohol(e.target.checked)} />
            Alcohol
          </label>
          <button
            className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white disabled:opacity-50 "
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
      )}
    </div>
  );
}

// One menu item. "Hide from register" takes it off the register without
// losing it: an item that has sold can't be deleted (its sales point at
// it), so when a delete is refused this offers Hide right there.
function ItemRow({
  item,
  section,
  ingredients,
  parItems,
  recipe,
  canEdit,
}: {
  item: MenuItem;
  section: string; // its category or subcategory, for its label tile
  ingredients: Ingredient[];
  parItems: ParItemRef[];
  recipe: Recipe | null;
  canEdit: boolean;
}) {
  const [pending, run] = useRefreshingAction();
  const [modsOpen, setModsOpen] = useState(false);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [deleteRefused, setDeleteRefused] = useState<string | null>(null);
  const hidden = !item.active;

  return (
    <div className={`rounded-lg border border-[var(--border)] p-3 ${hidden ? "bg-[var(--surface-hover)]" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <>
            <ItemNameInput id={item.id} name={item.name} />
            <ItemPriceInput id={item.id} price={item.price} />
          </>
        ) : (
          <>
            <span className={`min-w-[140px] flex-1 text-sm ${hidden ? "text-[var(--muted)]" : ""}`}>{item.name}</span>
            <span className="w-24 text-sm tabular-nums">{money(item.price)}</span>
          </>
        )}
        {hidden && <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">hidden from register</span>}
        {item.out_since && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-2 py-0.5 text-xs text-[var(--accent)]"
            title={`86'd on the register since ${outSince(item.out_since)}`}
          >
            <strong>Out</strong>
            {item.out_note ? ` · ${item.out_note}` : ""}
            {canEdit && (
              <button className="ml-1 font-bold underline disabled:opacity-50" disabled={pending} onClick={() => run(() => clearItemOut(item.id))}>
                Clear
              </button>
            )}
          </span>
        )}
        {(canEdit || item.modifier_groups.length > 0) && (
          <button className="rounded border border-[var(--border)] px-2 py-1 text-xs " onClick={() => setModsOpen((v) => !v)}>
            Modifiers ({item.modifier_groups.length})
          </button>
        )}
        {item.is_event_item && <span className="rounded-full border border-blue-400 px-2 py-0.5 text-xs text-blue-600">event item</span>}
        {canEdit ? (
          <label className="flex items-center gap-1 text-xs text-[var(--warn-text)] ">
            <input type="checkbox" checked={item.is_alcohol} disabled={pending} onChange={(e) => run(() => updateItem(item.id, { is_alcohol: e.target.checked }))} />
            alcohol
          </label>
        ) : (
          item.is_alcohol && <span className="text-xs text-[var(--warn-text)]">alcohol</span>
        )}
        {/* Any item can have a recipe (popcorn: kernels, oil, the bag).
            Cashiers see the button where there's one to read. */}
        {(canEdit || item.is_alcohol || recipe) && (
          <button className="rounded border border-[var(--warn-border)] px-2 py-1 text-xs text-[var(--warn-text)] " onClick={() => setRecipeOpen((v) => !v)}>
            Recipe ({recipe?.ingredients.length ?? 0})
          </button>
        )}
        {canEdit && (
          <>
            <label className="ml-auto flex items-center gap-1 text-xs" title="Hidden items stay in past sales and reports but don't show on the register.">
              <input
                type="checkbox"
                checked={hidden}
                disabled={pending}
                onChange={(e) => {
                  setDeleteRefused(null);
                  run(() => setItemHidden(item.id, e.target.checked));
                }}
              />
              Hide from register
            </label>
            <button
              className="rounded border border-[var(--danger-text)] px-2 py-1 text-xs text-[var(--danger-text)] "
              disabled={pending}
              onClick={() => {
                if (!confirm(`Delete "${item.name}"?`)) return;
                setDeleteRefused(null);
                run(async () => {
                  const r = await deleteItem(item.id);
                  // Shown here, with Hide one click away, instead of in the error bar.
                  if (!r.ok && "canHide" in r) return setDeleteRefused(r.error);
                  return r;
                });
              }}
            >
              Delete item
            </button>
          </>
        )}
      </div>
      {/* The picture on its register button. */}
      <div className="mt-2">
        <MenuPhoto target="item" id={item.id} name={item.name} picture={pictureOf(item)} category={section} canEdit={canEdit} />
      </div>
      {deleteRefused && (
        <div className="notice notice-warn mt-2 flex flex-wrap items-center gap-2 !p-2.5 text-sm">
          <span className="min-w-0 flex-1">{deleteRefused}</span>
          {!hidden && (
            <button
              className="btn-primary !px-3 !py-1 text-xs"
              disabled={pending}
              onClick={() => {
                setDeleteRefused(null);
                run(() => setItemHidden(item.id, true));
              }}
            >
              Hide from register
            </button>
          )}
          <button className="text-xs text-[var(--muted)] underline" onClick={() => setDeleteRefused(null)}>
            Close
          </button>
        </div>
      )}
      {modsOpen && <ItemModifiers item={item} canEdit={canEdit} />}
      {recipeOpen && <ItemRecipe item={item} recipe={recipe} ingredients={ingredients} parItems={parItems} canEdit={canEdit} />}
    </div>
  );
}

function ItemNameInput({ id, name }: { id: string; name: string }) {
  const [value, setValue] = useState(name);
  const [, run] = useRefreshingAction();
  return (
    <input
      className="min-w-[140px] flex-1 rounded border border-[var(--border)] px-2 py-1 text-sm "
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
      className="w-24 rounded border border-[var(--border)] px-2 py-1 text-sm "
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const v = parseFloat(value);
        if (!isNaN(v) && v !== price) run(() => updateItem(id, { price: v }));
      }}
    />
  );
}

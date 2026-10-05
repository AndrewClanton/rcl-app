"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { MenuCategory, MenuItem } from "@/lib/types";
import DrinkIcon from "@/components/bar/DrinkIcon";
import type { IconSpec } from "@/lib/bar/icons";
import type { RegisterOut } from "@/lib/ops/shared";
import { approvalText } from "@/lib/pin-rules";
import ManagerPinModal from "@/components/ManagerPinModal";
import MenuPicture, { ItemArt } from "@/components/menu/MenuPicture";
import { usePhotoUpload } from "@/components/menu/usePhotoUpload";
import PicturePicker from "@/components/menu/PicturePicker";
import TextIconDesigner from "@/components/menu/TextIconDesigner";
import { creditLine, isFound, pictureOf, textIconShown, type PictureState } from "@/lib/menu-pictures/shared";
import { useTouchScreen } from "@/lib/menu-pictures/photo-file";
import { useOpsApi } from "../shift/api";
import { dropOut, refreshOuts, useRanOut } from "../shift/ran-out-store";
import { holdHandlers, type HoldHandlers } from "./press-hold";
import {
  findItemPictures,
  keepItemPicture,
  pickItemPicture,
  saveItemDetails,
  saveItemTextIcon,
  showItemLabelTile,
  unlockItemSettings,
  uploadItemPhoto,
  type ItemDetails,
} from "./actions";

// Press and hold a register button for that item's settings: its picture
// (a photo, or a text icon like "$5" glowing red), name, price, whether
// it's on the register, and OUT / back in stock. The
// register is signed in with a shared login, so a manager's PIN comes
// first; one approval covers the next few minutes, so a manager can fix
// several buttons in a row. Changes save as they're made and the register
// refreshes behind the sheet without touching the order in progress.
//
// Wraps the register (src/app/pos/page.tsx). The register only asks for
// each button's extras (useMenuTileExtras): its text icon or label tile,
// for when there's no photo, and the press-and-hold.

interface Snapshot {
  id: string;
  name: string;
  icon?: IconSpec | null; // a Bar tab drink's icon, shown large in its settings
  price: number;
  active: boolean;
  picture: PictureState;
  category: string | null; // its section (Beer) or category (Food)
  parent: string | null; // the category a section is in (Alcohol)
  out: RegisterOut | null;
}

type TileExtras = { art: ReactNode; hold?: HoldHandlers };
type Extras = (item: MenuItem, category: MenuCategory | null, section: string | null, out: RegisterOut | null, icon?: IconSpec | null) => TileExtras;

// Outside the provider (a preview), buttons still get their text icons and
// label tiles.
const plainExtras: Extras = (item, category, section, out) => ({
  art: <ItemArt name={item.name} category={section ?? category?.label} parent={section ? category?.label : null} picture={pictureOf(item)} still={!!out} />,
});
const ExtrasContext = createContext<Extras>(plainExtras);

export function useMenuTileExtras(): Extras {
  return useContext(ExtrasContext);
}

// How long one approval lasts on this screen: the server's token is good
// for 15 minutes, but the sheet asks again once it's been shut for 2.
const APPROVAL_MS = 14 * 60_000;
const REUSE_AFTER_CLOSE_MS = 2 * 60_000;

type Approval = { token: string; until: number; closedAt: number | null; note: string };
type Opened = { item: Snapshot; token: string; note: string };

export function ItemSettingsProvider({ children }: { children: ReactNode }) {
  const [pinFor, setPinFor] = useState<Snapshot | null>(null);
  const [open, setOpen] = useState<Opened | null>(null);
  // Read only in event handlers (a hold, the PIN, closing), never to draw.
  const approval = useRef<Approval | null>(null);

  const ask = useCallback((s: Snapshot) => {
    const a = approval.current;
    const now = Date.now();
    if (a && now < a.until && (a.closedAt === null || now - a.closedAt < REUSE_AFTER_CLOSE_MS)) {
      a.closedAt = null;
      setOpen({ item: s, token: a.token, note: a.note });
    } else {
      approval.current = null;
      setPinFor(s);
    }
  }, []);

  const extras = useCallback<Extras>(
    (item, category, section, out, icon) => {
      const snap: Snapshot = {
        id: item.id,
        icon: icon ?? null,
        name: item.name,
        price: Number(item.price),
        active: item.active !== false,
        picture: pictureOf(item),
        category: section ?? category?.label ?? null,
        parent: section ? (category?.label ?? null) : null,
        out,
      };
      return {
        art: <ItemArt name={item.name} category={snap.category} parent={snap.parent} picture={snap.picture} still={!!out} />,
        hold: holdHandlers(() => ask(snap)),
      };
    },
    [ask],
  );

  async function unlock(pin: string) {
    if (!pinFor) return;
    const r = await unlockItemSettings(pin, pinFor.id);
    if (!r.ok) throw new Error(r.error); // shown in the PIN box
    const a: Approval = { token: r.token, until: Date.now() + APPROVAL_MS, closedAt: null, note: approvalText(r) };
    approval.current = a;
    setOpen({ item: pinFor, token: a.token, note: a.note });
    setPinFor(null);
  }

  function close() {
    if (approval.current) approval.current.closedAt = Date.now();
    setOpen(null);
  }

  return (
    <ExtrasContext.Provider value={extras}>
      {children}
      {pinFor && (
        <ManagerPinModal
          title="Manager PIN"
          description={`To change ${pinFor.name}: its picture, name, price and more.`}
          onCancel={() => setPinFor(null)}
          onSubmit={unlock}
        />
      )}
      {open && <ItemSettingsSheet key={open.item.id} start={open.item} token={open.token} note={open.note} onClose={close} />}
    </ExtrasContext.Provider>
  );
}

function ItemSettingsSheet({ start, token, note, onClose }: { start: Snapshot; token: string; note: string; onClose: () => void }) {
  const router = useRouter();
  const api = useOpsApi();
  const ranOut = useRanOut();
  const touch = useTouchScreen();
  const [item, setItem] = useState(start);
  const [name, setName] = useState(start.name);
  const [price, setPrice] = useState(start.price.toFixed(2));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmLabel, setConfirmLabel] = useState(false);
  const [picking, setPicking] = useState(false);
  const [designing, setDesigning] = useState(false);

  // OUT as the register sees it now (the shift bar keeps it current).
  const out = useMemo(() => (ranOut.loaded ? (ranOut.outs.find((o) => o.itemId === item.id) ?? null) : item.out), [ranOut, item]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !picking && !designing && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, picking, designing]);

  function done(message: string) {
    setSaved(message);
    setError(null);
    router.refresh();
  }

  const photo = usePhotoUpload(
    (form) => uploadItemPhoto(token, item.id, form),
    (r) => {
      setItem((i) => ({ ...i, picture: pictureOf({ image_url: r.url, image_source: "upload", image_approved_at: new Date().toISOString() }) }));
      done("Photo saved. It's on the button now.");
    },
  );

  async function run(what: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>, message: string) {
    setBusy(what);
    setError(null);
    setSaved(null);
    try {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else done(message);
    } catch {
      setError("That didn't save. Check the connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function save(fields: Partial<ItemDetails>, message: string) {
    setBusy("details");
    setError(null);
    setSaved(null);
    try {
      const r = await saveItemDetails(token, item.id, fields);
      if (!r.ok) return setError(r.error);
      setItem((i) => ({ ...i, ...r.item }));
      setName(r.item.name);
      setPrice(r.item.price.toFixed(2));
      done(message);
    } catch {
      setError("That didn't save. Check the connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const priceValue = Number(price);
  const nameChanged = name.replace(/\s+/g, " ").trim() !== item.name;
  const priceChanged = price.trim() !== "" && Number.isFinite(priceValue) && Math.round(priceValue * 100) !== Math.round(item.price * 100);
  const anyBusy = !!busy || photo.busy;
  const credit = creditLine(item.picture.image_source, item.picture.image_credit);
  const unchecked = !!item.picture.image_url && isFound(item.picture.image_source) && !item.picture.image_approved_at;
  const textIcon = textIconShown(item.picture);
  const row = "flex flex-wrap items-center gap-2";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`${item.name} settings`}>
      <div className="card w-full max-w-2xl shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          {item.icon && (
            <span className="shrink-0" style={{ color: "var(--foreground)" }}>
              <DrinkIcon spec={item.icon} size={110} label={item.name} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="eyebrow">Item settings</div>
            <h2 className="font-display text-2xl leading-tight">{item.name}</h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
              {note}
            </p>
          </div>
          <button className="btn-secondary min-h-11 shrink-0" onClick={onClose}>
            Done
          </button>
        </div>

        {picking ? (
          <section className="mx-auto max-w-md">
            <div className="label-xs">Find a picture</div>
            <PicturePicker
              current={item.picture}
              find={(q) => findItemPictures(token, item.id, q)}
              pick={(q, i, page) => pickItemPicture(token, item.id, q, i, page)}
              onPicked={(p) => {
                setItem((i) => ({ ...i, picture: p }));
                setPicking(false);
                done("Picture saved. It's on the button now.");
              }}
              onCancel={() => setPicking(false)}
            />
          </section>
        ) : designing ? (
          <section className="mx-auto max-w-md">
            <div className="label-xs">Text icon</div>
            <TextIconDesigner
              name={item.name}
              price={item.price}
              current={item.picture}
              save={(icon) => saveItemTextIcon(token, item.id, icon)}
              onSaved={(p) => {
                setItem((i) => ({ ...i, picture: p }));
                setDesigning(false);
                done("Text icon saved. It's on the button now.");
              }}
              onCancel={() => setDesigning(false)}
            />
          </section>
        ) : (
        <div className="grid gap-5 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          {/* Picture */}
          <section>
            <div className="label-xs">Picture on the button</div>
            <div className="relative aspect-square w-full max-w-60 overflow-hidden rounded-lg border" style={{ borderColor: "var(--border)" }}>
              <MenuPicture url={item.picture.image_url} text={textIcon} name={item.name} category={item.category} parent={item.parent} sizes="240px" className="h-full w-full" />
              {photo.busy && <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-bold text-white">Uploading…</div>}
            </div>
            {credit && (
              <p className="mt-1 max-w-60 text-[11px] leading-snug" style={{ color: "var(--muted)" }}>
                {credit}
              </p>
            )}
            {unchecked && (
              <div className="mt-2 flex max-w-60 flex-wrap items-center gap-2 text-xs">
                <span className="min-w-0 flex-1" style={{ color: "var(--muted)" }}>
                  Found automatically. Right picture?
                </span>
                <button
                  className="btn-secondary min-h-11 !px-3"
                  disabled={anyBusy}
                  onClick={() =>
                    run(
                      "keep",
                      async () => {
                        const r = await keepItemPicture(token, item.id);
                        if (r.ok) setItem((i) => ({ ...i, picture: r.picture }));
                        return r;
                      },
                      "Kept.",
                    )
                  }
                >
                  Keep it
                </button>
              </div>
            )}
            <div className="mt-2 grid max-w-60 gap-2">
              <button className="btn-primary min-h-12 !text-base" disabled={anyBusy} onClick={() => setPicking(true)}>
                {item.picture.image_url ? "Find a better picture" : "Find a picture"}
              </button>
              <button className="btn-secondary min-h-12 !text-base" disabled={anyBusy} onClick={() => setDesigning(true)}>
                {textIcon ? "Change text icon" : "Make a text icon"}
              </button>
              {touch && (
                <button className="btn-secondary min-h-12 !text-base" disabled={anyBusy} onClick={photo.takePhoto}>
                  Take photo
                </button>
              )}
              <button className="btn-secondary min-h-12 !text-base" disabled={anyBusy} onClick={photo.choosePhoto}>
                Choose photo
              </button>
              {(item.picture.image_url || textIcon) &&
                (confirmLabel ? (
                  <div className="flex gap-2">
                    <button
                      className="btn-secondary min-h-12 flex-1 !px-2 !text-sm"
                      disabled={anyBusy}
                      onClick={() => {
                        setConfirmLabel(false);
                        void run(
                          "label",
                          async () => {
                            const r = await showItemLabelTile(token, item.id);
                            if (r.ok) setItem((i) => ({ ...i, picture: pictureOf({ image_source: "label" }) }));
                            return r;
                          },
                          textIcon ? "Text icon taken off. The button shows its label." : "Picture taken off. The button shows its label.",
                        );
                      }}
                    >
                      {textIcon ? "Take the text icon off" : "Take the picture off"}
                    </button>
                    <button className="min-h-12 px-3 text-sm hover:underline" style={{ color: "var(--muted)" }} onClick={() => setConfirmLabel(false)}>
                      Keep
                    </button>
                  </div>
                ) : (
                  <button className="btn-secondary min-h-12 !text-base" disabled={anyBusy} onClick={() => setConfirmLabel(true)}>
                    Use label tile
                  </button>
                ))}
            </div>
            {photo.inputs}
          </section>

          <div className="space-y-4">
            {/* Name and price */}
            <section>
              <label className="block">
                <div className="label-xs">Name</div>
                <div className={row}>
                  <input
                    className="input min-w-0 flex-1 !py-2.5 !text-base"
                    value={name}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && nameChanged && !anyBusy && save({ name }, "Name saved.")}
                  />
                  <button className="btn-primary min-h-11" disabled={!nameChanged || anyBusy || !name.trim()} onClick={() => save({ name }, "Name saved.")}>
                    Save
                  </button>
                </div>
              </label>
              <label className="mt-3 block">
                <div className="label-xs">Price</div>
                <div className={row}>
                  <div className="relative w-36">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base" style={{ color: "var(--muted)" }}>
                      $
                    </span>
                    <input
                      className="input !py-2.5 !pl-7 !text-base tabular-nums"
                      inputMode="decimal"
                      value={price}
                      onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
                      onKeyDown={(e) => e.key === "Enter" && priceChanged && !anyBusy && save({ price: priceValue }, "Price saved.")}
                    />
                  </div>
                  <button className="btn-primary min-h-11" disabled={!priceChanged || anyBusy} onClick={() => save({ price: priceValue }, "Price saved.")}>
                    Save
                  </button>
                </div>
              </label>
            </section>

            {/* On the register, and in stock */}
            <section className="space-y-2 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  className="h-6 w-6 shrink-0"
                  checked={item.active}
                  disabled={anyBusy}
                  onChange={(e) =>
                    save({ active: e.target.checked }, e.target.checked ? "It's back on the register." : "Hidden: it's off the register after this. Tick it to bring it back.")
                  }
                />
                <span>
                  <span className="block font-bold">Show on the register</span>
                  <span className="block text-xs" style={{ color: "var(--muted)" }}>
                    Untick to take it off the menu buttons. Past sales keep it.
                  </span>
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{out ? "OUT" : "In stock"}</div>
                  <div className="text-xs" style={{ color: out ? "var(--danger-text)" : "var(--muted)" }}>
                    {out ? out.reason : "Selling as normal."}
                  </div>
                </div>
                {out ? (
                  <button
                    className="btn-primary min-h-11"
                    disabled={anyBusy}
                    onClick={() =>
                      run(
                        "stock",
                        async () => {
                          const r = await api.markItemBack(item.id, null, ranOut.cashierId);
                          if (r.ok) {
                            dropOut(item.id);
                            refreshOuts();
                            setItem((i) => ({ ...i, out: null }));
                          }
                          return r;
                        },
                        "Back in stock.",
                      )
                    }
                  >
                    {busy === "stock" ? "Saving…" : "Back in stock"}
                  </button>
                ) : (
                  <button
                    className="btn-secondary min-h-11"
                    disabled={anyBusy}
                    onClick={() =>
                      run(
                        "stock",
                        async () => {
                          const r = await api.reportOutage({ parItemId: null, label: item.name, note: null, menuItemIds: [item.id] }, ranOut.cashierId, null);
                          if (r.ok) refreshOuts();
                          return r;
                        },
                        "Marked OUT. The managers have it on their list.",
                      )
                    }
                  >
                    {busy === "stock" ? "Saving…" : "Mark OUT"}
                  </button>
                )}
              </div>
            </section>

            <section className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
              <a className="text-sm font-bold underline" href="/admin/menu" target="_blank" rel="noopener noreferrer">
                More settings in Back office ↗
              </a>
              <span className="ml-1 text-xs" style={{ color: "var(--muted)" }}>
                Choices like size or flavor, and the recipe. Opens in a new tab, so this order stays put.
              </span>
            </section>
          </div>
        </div>
        )}

        {(error || photo.error || saved) && (
          <p className="mt-4 text-sm font-bold" style={{ color: error || photo.error ? "var(--danger-text)" : "var(--success-text)" }} role="status">
            {error || photo.error || saved}
          </p>
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { loadStripe, type Stripe, type StripeElements } from "@stripe/stripe-js";
import DrinkIcon from "@/components/bar/DrinkIcon";
import MenuPicture from "@/components/menu/MenuPicture";
import { registerTotals, cents } from "@/lib/register-totals";
import { SALES_TAX_PERCENT } from "@/lib/sales-tax";
import { GUEST_STATUS, PAUSED_MESSAGE, TIP_CHOICES, type SeatStatus, type SeatTotals, type TipChoice } from "@/lib/seat-ordering";
import type { SeatItem, SeatSection, CheckoutStatus } from "@/lib/seat-ordering-server";
import type { MemberTier } from "@/lib/types";
import { finishSeatOrder, seatOrderStatus, startSeatOrder } from "./actions";

// The phone menu a spot's QR card opens: pick, pay, then watch it come.
// Cinema spots get a dim, dark screen so a phone doesn't light up the room.

export interface SeatGuest {
  firstName: string;
  tier: MemberTier;
  points: number;
  coffeeReady: boolean;
}

interface CartLine {
  key: string;
  itemId: string;
  optionIds: string[];
  qty: number;
  name: string;
  unit: number;
  mods: string[];
  isAlcohol: boolean;
  perkBase: number | null;
}

const DARK: CSSProperties = {
  ["--background" as string]: "#0b0a08",
  ["--surface" as string]: "#15120e",
  ["--surface-hover" as string]: "#1f1b15",
  ["--border" as string]: "#2c271f",
  ["--foreground" as string]: "#c9c0aa",
  ["--muted" as string]: "#7f7766",
  ["--accent" as string]: "#a8282d",
  ["--accent-hover" as string]: "#bb3237",
  ["--accent-foreground" as string]: "#efe7d6",
  ["--accent-soft" as string]: "rgba(168, 40, 45, 0.2)",
  ["--gold" as string]: "#8a6d1f",
  ["--gold-foreground" as string]: "#efe7d6",
  ["--success-bg" as string]: "#13231a",
  ["--success-border" as string]: "#2f5a3c",
  ["--success-text" as string]: "#8fc7a0",
  ["--warn-bg" as string]: "#241d0d",
  ["--warn-border" as string]: "#5a4718",
  ["--warn-text" as string]: "#d9b96a",
};

const money = (n: number) => `$${n.toFixed(2)}`;
const cartKey = (code: string) => `rcl.seat.cart.${code}`;

export default function SeatOrderApp({
  code,
  spotName,
  dark,
  open: openAtLoad,
  menu,
  guest,
  initialCheckout,
  publishableKey,
}: {
  code: string;
  spotName: string;
  dark: boolean;
  open: boolean;
  menu: SeatSection[];
  guest: SeatGuest | null;
  initialCheckout: string | null;
  publishableKey: string;
}) {
  const [open, setOpen] = useState(openAtLoad);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<SeatItem | null>(null);
  const [view, setView] = useState<"menu" | "cart" | "pay" | "status">(initialCheckout ? "status" : "menu");
  const [checkoutId, setCheckoutId] = useState<string | null>(initialCheckout);
  const [name, setName] = useState("");
  const [quietly, setQuietly] = useState(dark);
  const [tip, setTip] = useState<TipChoice>(0);
  const [pay, setPay] = useState<{ checkoutId: string; clientSecret: string; totals: SeatTotals } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  // The cart survives signing in (a trip to the login page) and a reload.
  useEffect(() => {
    let saved: CartLine[] | null = null;
    try {
      const raw = window.sessionStorage.getItem(cartKey(code));
      saved = raw ? (JSON.parse(raw) as CartLine[]) : null;
    } catch {
      saved = null;
    }
    const ids = new Set(menu.flatMap((s) => s.items.map((i) => i.id)));
    const keep = (saved ?? []).filter((l) => l && ids.has(l.itemId));
    if (keep.length) void Promise.resolve().then(() => setCart((cur) => (cur.length ? cur : keep)));
  }, [code, menu]);
  useEffect(() => {
    try {
      if (cart.length) window.sessionStorage.setItem(cartKey(code), JSON.stringify(cart));
      else window.sessionStorage.removeItem(cartKey(code));
    } catch {
      // Private browsing: it just won't be kept.
    }
  }, [cart, code]);

  const totals = useMemo(() => {
    const t = registerTotals(
      cart.map((l) => ({ unit: l.unit, qty: l.qty, perkBase: l.perkBase })),
      guest ? { tier: guest.tier, points: guest.points } : null,
      false,
      false,
      false,
      !!guest?.coffeeReady,
    );
    const tipAmount = cents(((t.subtotal - t.discount) * tip) / 100);
    return { ...t, tip: tipAmount, grand: cents(t.total + tipAmount) };
  }, [cart, guest, tip]);
  const count = cart.reduce((s, l) => s + l.qty, 0);
  const hasAlcohol = cart.some((l) => l.isAlcohol);

  function add(line: Omit<CartLine, "key">) {
    setCart((cur) => {
      const same = cur.find((l) => l.itemId === line.itemId && l.optionIds.join() === line.optionIds.join());
      if (same) return cur.map((l) => (l === same ? { ...l, qty: Math.min(20, l.qty + line.qty) } : l));
      return [...cur, { ...line, key: `${line.itemId}:${line.optionIds.join(".")}:${Date.now()}` }];
    });
    setAdded(line.name);
    setTimeout(() => setAdded((cur) => (cur === line.name ? null : cur)), 1800);
  }

  function tapItem(item: SeatItem) {
    if (item.groups.length) setPicking(item);
    else add({ itemId: item.id, optionIds: [], qty: 1, name: item.name, unit: item.price, mods: [], isAlcohol: item.isAlcohol, perkBase: item.dailyPerk ? item.price : null });
  }

  function setQty(key: string, qty: number) {
    setCart((cur) => (qty <= 0 ? cur.filter((l) => l.key !== key) : cur.map((l) => (l.key === key ? { ...l, qty: Math.min(20, qty) } : l))));
  }

  async function startPay() {
    setBusy(true);
    setError(null);
    const r = await startSeatOrder({ code, lines: cart.map((l) => ({ itemId: l.itemId, optionIds: l.optionIds, qty: l.qty })), tip, name, quietly: dark && quietly }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Couldn't reach us. Check your connection and try again.");
    if (!r.ok) {
      if (r.paused) setOpen(false);
      return setError(r.error);
    }
    setPay(r);
    setView("pay");
  }

  function paid(id: string) {
    setCheckoutId(id);
    setCart([]);
    setPay(null);
    setView("status");
    try {
      window.history.replaceState(null, "", `/order/${code}?o=${id}`);
    } catch {
      // fine
    }
  }

  function orderMore() {
    setCheckoutId(null);
    setView("menu");
    setError(null);
    try {
      window.history.replaceState(null, "", `/order/${code}`);
    } catch {
      // fine
    }
  }

  return (
    <div className={`${dark ? "" : "site "}min-h-screen`} style={{ ...(dark ? DARK : {}), background: "var(--background)", color: "var(--foreground)" }}>
      {dark && <style>{`html,body{background:#0b0a08}`}</style>}
      <header className="sticky top-0 z-20 border-b-2 px-4 py-3" style={{ background: "var(--background)", borderColor: dark ? "var(--border)" : "var(--foreground)" }}>
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--accent)" }}>
              Royale Cinema · Order from your seat
            </div>
            <h1 className="font-display truncate text-2xl leading-tight">{spotName}</h1>
          </div>
          <MemberChip guest={guest} code={code} />
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 pb-32 pt-4">
        {view === "status" && checkoutId ? (
          <StatusView checkoutId={checkoutId} onMore={open ? orderMore : null} />
        ) : !open ? (
          <div className="mt-10 rounded-lg border-2 p-6 text-center" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <p className="font-display text-xl">{PAUSED_MESSAGE}</p>
          </div>
        ) : view === "pay" && pay ? (
          <PayView
            pay={pay}
            dark={dark}
            code={code}
            publishableKey={publishableKey}
            onBack={() => {
              setPay(null);
              setView("cart");
            }}
            onPaid={paid}
          />
        ) : view === "cart" ? (
          <CartView
            cart={cart}
            dark={dark}
            guest={guest}
            totals={totals}
            hasAlcohol={hasAlcohol}
            name={name}
            setName={setName}
            quietly={quietly}
            setQuietly={setQuietly}
            tip={tip}
            setTip={setTip}
            setQty={setQty}
            busy={busy}
            error={error}
            onBack={() => setView("menu")}
            onPay={startPay}
          />
        ) : (
          <MenuView menu={menu} onTap={tapItem} dark={dark} />
        )}
      </main>

      {view === "menu" && open && count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t-2 p-3" style={{ background: "var(--background)", borderColor: dark ? "var(--border)" : "var(--foreground)" }}>
          <div className="mx-auto max-w-xl">
            {added && (
              <p className="mb-2 text-center text-sm font-bold" role="status" style={{ color: "var(--success-text)" }}>
                Added {added}
              </p>
            )}
            <button className="btn-primary flex min-h-14 w-full items-center justify-between !text-base" onClick={() => setView("cart")}>
              <span>
                View order · {count} item{count === 1 ? "" : "s"}
              </span>
              <span>{money(totals.subtotal)}</span>
            </button>
          </div>
        </div>
      )}

      {picking && (
        <ItemSheet
          item={picking}
          dark={dark}
          onClose={() => setPicking(null)}
          onAdd={(line) => {
            add(line);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}

function MemberChip({ guest, code }: { guest: SeatGuest | null; code: string }) {
  if (!guest) {
    return (
      <a href={`/account/login?next=${encodeURIComponent(`/order/${code}`)}`} className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--border)" }}>
        Member? Sign in
      </a>
    );
  }
  return (
    <div className="shrink-0 text-right text-xs leading-tight">
      <div className="font-bold">Hi {guest.firstName}</div>
      <div style={{ color: "var(--muted)" }}>{guest.tier === "Insiders+" ? "Insiders+ · 10% off" : "Earning points"}</div>
    </div>
  );
}

function ItemArt({ item, size = 56 }: { item: SeatItem; size?: number }) {
  if (item.icon) return <DrinkIcon spec={item.icon} size={size} />;
  return <MenuPicture url={item.photo} text={item.textIcon} name={item.name} category={item.category} sizes={`${size}px`} small className="h-full w-full rounded-md" />;
}

function MenuView({ menu, onTap, dark }: { menu: SeatSection[]; onTap: (i: SeatItem) => void; dark: boolean }) {
  if (!menu.length) return <p className="mt-10 text-center" style={{ color: "var(--muted)" }}>Nothing on the menu right now. Please order at the box office.</p>;
  return (
    <>
      <nav className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Menu sections">
        {menu.map((s) => (
          <a key={s.key} href={`#sec-${s.key}`} className="chip shrink-0 whitespace-nowrap !px-3 !py-1.5 !text-sm font-bold">
            {s.label}
          </a>
        ))}
      </nav>
      {menu.map((s) => (
        <section key={s.key} id={`sec-${s.key}`} className="mb-6 scroll-mt-24">
          <h2 className="font-display mb-2 text-xl">{s.label}</h2>
          <ul className="divide-y rounded-lg border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            {s.items.map((item) => (
              <li key={item.id} style={{ borderColor: "var(--border)" }}>
                <button className="flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left" onClick={() => onTap(item)}>
                  <span style={{ width: 56, height: 56, color: "var(--foreground)", opacity: dark ? 0.8 : 1 }} className="flex shrink-0 items-center justify-center">
                    <ItemArt item={item} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold leading-snug">{item.name}</span>
                    {item.isAlcohol && <span className="text-xs" style={{ color: "var(--muted)" }}>21+ · ID checked when we bring it</span>}
                    {item.groups.length > 0 && !item.isAlcohol && <span className="text-xs" style={{ color: "var(--muted)" }}>Choices</span>}
                  </span>
                  <span className="font-display shrink-0 tabular-nums">${item.price.toFixed(2)}</span>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg font-bold" style={{ background: "var(--accent)", color: "var(--accent-foreground)" }} aria-hidden>
                    +
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function ItemSheet({ item, dark, onClose, onAdd }: { item: SeatItem; dark: boolean; onClose: () => void; onAdd: (l: Omit<CartLine, "key">) => void }) {
  const [sel, setSel] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(item.groups.map((g) => [g.id, g.type === "single" && !g.mustChoose ? [g.options[0].id] : []])),
  );
  const [qty, setQty] = useState(1);
  const unanswered = item.groups.filter((g) => g.type === "single" && g.mustChoose && !(sel[g.id] ?? []).length);
  const chosen = item.groups.flatMap((g) => g.options.filter((o) => (sel[g.id] ?? []).includes(o.id)));
  const unit = cents(Math.max(0, item.price + chosen.reduce((s, o) => s + o.delta, 0)));

  function toggle(groupId: string, type: "single" | "multi", optionId: string) {
    setSel((cur) => {
      if (type === "single") return { ...cur, [groupId]: [optionId] };
      const list = cur[groupId] ?? [];
      return { ...cur, [groupId]: list.includes(optionId) ? list.filter((x) => x !== optionId) : [...list, optionId] };
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60" onClick={onClose} role="dialog" aria-modal="true" aria-label={item.name}>
      <div className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-t-2xl p-5 pb-8" style={{ background: "var(--background)", ...(dark ? {} : {}) }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center gap-3">
          <span style={{ width: 64, height: 64, color: "var(--foreground)" }} className="flex shrink-0 items-center justify-center">
            <ItemArt item={item} size={64} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl leading-tight">{item.name}</h2>
            {item.isAlcohol && <p className="text-sm" style={{ color: "var(--muted)" }}>21+ · we&apos;ll check ID when we bring it</p>}
          </div>
          <button className="min-h-11 px-2 text-2xl" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {item.groups.map((g) => (
          <fieldset key={g.id} className="mb-4">
            <legend className="mb-2 text-sm font-bold" style={g.mustChoose && !(sel[g.id] ?? []).length ? { color: "var(--accent)" } : undefined}>
              {g.label} <span className="font-normal" style={{ color: "var(--muted)" }}>{g.type === "single" ? (g.mustChoose ? "pick one" : "choose 1") : "optional"}</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {g.options.map((o) => {
                const on = (sel[g.id] ?? []).includes(o.id);
                return (
                  <button key={o.id} className={`chip min-h-11 !px-4 !py-2 !text-sm ${on ? "chip-selected font-bold" : ""}`} aria-pressed={on} onClick={() => toggle(g.id, g.type, o.id)}>
                    {o.name}
                    {o.delta !== 0 && <span className="ml-1 opacity-75">{o.delta > 0 ? "+" : "−"}{money(Math.abs(o.delta))}</span>}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
        <div className="mt-6 flex items-center gap-3">
          <Stepper value={qty} onChange={setQty} min={1} />
          <button
            className="btn-primary min-h-14 flex-1 !text-base"
            disabled={unanswered.length > 0}
            onClick={() =>
              onAdd({
                itemId: item.id,
                optionIds: item.groups.flatMap((g) => sel[g.id] ?? []),
                qty,
                name: item.name,
                unit,
                mods: chosen.map((o) => o.name),
                isAlcohol: item.isAlcohol,
                perkBase: item.dailyPerk ? item.price : null,
              })
            }
          >
            {unanswered.length ? `Choose ${unanswered[0].label.replace(/\?$/, "").toLowerCase()}` : `Add · ${money(unit * qty)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stepper({ value, onChange, min = 0 }: { value: number; onChange: (n: number) => void; min?: number }) {
  return (
    <div className="flex items-center rounded-lg border-2" style={{ borderColor: "var(--border)" }}>
      <button className="h-11 w-11 text-xl font-bold" onClick={() => onChange(Math.max(min, value - 1))} aria-label="One less">
        −
      </button>
      <span className="w-7 text-center font-bold tabular-nums">{value}</span>
      <button className="h-11 w-11 text-xl font-bold" onClick={() => onChange(Math.min(20, value + 1))} aria-label="One more">
        +
      </button>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${strong ? "font-display pt-2 text-lg" : "text-sm"}`}>
      <span style={strong ? undefined : { color: "var(--muted)" }}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function CartView(p: {
  cart: CartLine[];
  dark: boolean;
  guest: SeatGuest | null;
  totals: ReturnType<typeof registerTotals> & { tip: number; grand: number };
  hasAlcohol: boolean;
  name: string;
  setName: (s: string) => void;
  quietly: boolean;
  setQuietly: (b: boolean) => void;
  tip: TipChoice;
  setTip: (t: TipChoice) => void;
  setQty: (key: string, qty: number) => void;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onPay: () => void;
}) {
  const t = p.totals;
  return (
    <div>
      <button className="mb-3 min-h-11 text-sm font-bold" onClick={p.onBack}>
        ← Back to the menu
      </button>
      <h2 className="font-display mb-3 text-2xl">Your order</h2>
      {p.cart.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>Nothing yet.</p>
      ) : (
        <ul className="mb-5 divide-y rounded-lg border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          {p.cart.map((l) => (
            <li key={l.key} className="flex items-center gap-3 px-3 py-2" style={{ borderColor: "var(--border)" }}>
              <div className="min-w-0 flex-1">
                <div className="font-bold">{l.name}</div>
                {l.mods.length > 0 && <div className="text-xs" style={{ color: "var(--muted)" }}>{l.mods.join(", ")}</div>}
                <div className="text-sm tabular-nums">{money(l.unit * l.qty)}</div>
              </div>
              <Stepper value={l.qty} onChange={(n) => p.setQty(l.key, n)} />
            </li>
          ))}
        </ul>
      )}

      <label className="mb-1 block text-sm font-bold" htmlFor="seat-name">
        Name for the order <span className="font-normal" style={{ color: "var(--muted)" }}>(optional)</span>
      </label>
      <input id="seat-name" className="input mb-4 !text-base" value={p.name} maxLength={40} autoComplete="given-name" onChange={(e) => p.setName(e.target.value)} placeholder="So we know who's who" />

      {p.dark && (
        <label className="mb-4 flex min-h-11 items-center gap-3 text-base">
          <input type="checkbox" className="h-5 w-5" checked={p.quietly} onChange={(e) => p.setQuietly(e.target.checked)} />
          Deliver quietly (the movie&apos;s on)
        </label>
      )}

      <div className="mb-1 text-sm font-bold">Tip</div>
      <div className="mb-5 grid grid-cols-4 gap-2">
        {TIP_CHOICES.map((c) => (
          <button key={c} className={`chip min-h-11 !text-sm ${p.tip === c ? "chip-selected font-bold" : ""}`} aria-pressed={p.tip === c} onClick={() => p.setTip(c)}>
            {c === 0 ? "No tip" : `${c}%`}
          </button>
        ))}
      </div>

      <div className="mb-4 rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <Row label="Subtotal" value={money(t.subtotal)} />
        {t.dailyPerkDiscount > 0 && <Row label="Insiders+ daily coffee" value={`−${money(t.dailyPerkDiscount)}`} />}
        {t.tierDiscount > 0 && <Row label="Insiders+ 10% off" value={`−${money(t.tierDiscount)}`} />}
        <Row label={`Tax (${SALES_TAX_PERCENT}%)`} value={money(t.tax)} />
        {t.tip > 0 && <Row label="Tip" value={money(t.tip)} />}
        <Row label="Total" value={money(t.grand)} strong />
        {p.guest && <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>Earns points on your Insiders account.</p>}
      </div>

      {p.hasAlcohol && (
        <p className="notice notice-warn mb-4" role="note">
          There&apos;s alcohol in this order. We&apos;ll check ID when we bring it.
        </p>
      )}
      {p.error && (
        <p className="mb-3 text-sm font-bold" role="alert" style={{ color: "var(--danger-text, var(--accent))" }}>
          {p.error}
        </p>
      )}
      <button className="btn-primary min-h-14 w-full !text-base" disabled={p.busy || p.cart.length === 0} onClick={p.onPay}>
        {p.busy ? "One moment…" : `Pay ${money(t.grand)}`}
      </button>
      <p className="mt-2 text-center text-xs" style={{ color: "var(--muted)" }}>
        Card, Apple Pay or Google Pay. We bring it to {p.dark ? "your row" : "you"}.
      </p>
    </div>
  );
}

function PayView({
  pay,
  dark,
  code,
  publishableKey,
  onBack,
  onPaid,
}: {
  pay: { checkoutId: string; clientSecret: string; totals: SeatTotals };
  dark: boolean;
  code: string;
  publishableKey: string;
  onBack: () => void;
  onPaid: (id: string) => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    (async () => {
      const stripe = publishableKey ? await loadStripe(publishableKey).catch(() => null) : null;
      if (cancelled) return;
      if (!stripe || !mount.current) {
        setError("Card payments aren't loading. Please order at the box office.");
        return;
      }
      const styles = getComputedStyle(mount.current);
      const v = (name: string) => styles.getPropertyValue(name).trim();
      const elements = stripe.elements({
        clientSecret: pay.clientSecret,
        appearance: {
          theme: dark ? "night" : "stripe",
          variables: { colorPrimary: v("--accent"), colorBackground: v("--surface"), colorText: v("--foreground"), borderRadius: "6px", fontSizeBase: "16px" },
        },
      });
      const el = elements.create("payment", { layout: "tabs" });
      el.on("ready", () => setReady(true));
      el.mount(mount.current);
      destroy = () => el.destroy();
      stripeRef.current = stripe;
      elementsRef.current = elements;
    })();
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [pay.clientSecret, publishableKey, dark]);

  async function confirm() {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error: err } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/order/${code}?o=${pay.checkoutId}` },
      redirect: "if_required",
    });
    if (err) {
      setBusy(false);
      setError(err.message ?? "The payment didn't go through.");
      return;
    }
    onPaid(pay.checkoutId);
  }

  const t = pay.totals;
  return (
    <div>
      <button className="mb-3 min-h-11 text-sm font-bold" onClick={onBack} disabled={busy}>
        ← Change the order
      </button>
      <h2 className="font-display mb-1 text-2xl">Pay {money(t.total)}</h2>
      <p className="mb-4 text-sm" style={{ color: "var(--muted)" }}>
        {[t.memberDiscount > 0 && `${money(t.memberDiscount)} Insiders+ off`, t.dailyPerk > 0 && "daily coffee on us", `tax ${money(t.tax)}`, t.tip > 0 && `tip ${money(t.tip)}`, t.points > 0 && `earns ${Math.floor(t.points)} points`].filter(Boolean).join(" · ")}
      </p>
      <div ref={mount} className="mb-4 min-h-24" />
      {!ready && !error && <p className="mb-4 text-sm" style={{ color: "var(--muted)" }}>Loading card payment…</p>}
      {error && (
        <p className="mb-3 text-sm font-bold" role="alert" style={{ color: "var(--accent)" }}>
          {error}
        </p>
      )}
      <button className="btn-primary min-h-14 w-full !text-base" disabled={!ready || busy} onClick={confirm}>
        {busy ? "Paying…" : `Pay ${money(t.total)}`}
      </button>
    </div>
  );
}

const STEPS: SeatStatus[] = ["new", "making", "delivered"];

function StatusView({ checkoutId, onMore }: { checkoutId: string; onMore: (() => void) | null }) {
  const [s, setS] = useState<CheckoutStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const r = await seatOrderStatus(checkoutId).catch(() => undefined);
    if (r === undefined) return;
    if (r === null) return setMissing(true);
    setS(r);
  }, [checkoutId]);

  // Make sure the paid order reached the staff (the phone may have come
  // back from a bank's page), then watch it.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (tries: number) => {
      if (stop) return;
      const cur = await seatOrderStatus(checkoutId).catch(() => undefined);
      if (stop) return;
      if (cur === null) {
        setMissing(true);
        return;
      }
      if (cur && !cur.paid) {
        const f = await finishSeatOrder(checkoutId).catch(() => null);
        if (f && !f.ok) setNote(f.error);
      } else setNote(null);
      if (cur) setS(cur);
      if (cur?.status === "delivered" || cur?.refunded) return;
      timer = setTimeout(() => void tick(tries + 1), tries < 3 ? 2500 : 6000);
    };
    void tick(0);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [checkoutId]);

  if (missing) return <p className="mt-10 text-center">We couldn&apos;t find that order. If you paid, show this screen at the box office.</p>;
  if (!s) return <p className="mt-10 text-center" style={{ color: "var(--muted)" }}>Checking your order…</p>;
  const step = s.paid ? STEPS.indexOf(s.status ?? "new") : -1;
  const words = s.paid && s.status ? GUEST_STATUS[s.status] : { title: "Confirming your payment", sub: note ?? "Just a moment." };
  return (
    <div className="pt-4">
      <p className="eyebrow">{s.orderNumber ? `Order #${s.orderNumber}` : "Your order"}</p>
      <h2 className="font-display mt-1 text-4xl leading-tight" aria-live="polite">
        {s.refunded ? "Refunded" : words.title}
      </h2>
      <p className="mt-2" style={{ color: "var(--muted)" }}>
        {s.refunded ? "This order was refunded to your card." : words.sub}
      </p>
      <ol className="mt-8 space-y-3" aria-label="Progress">
        {STEPS.map((k, i) => (
          <li key={k} className="flex items-center gap-3">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold"
              style={i <= step ? { background: "var(--accent)", borderColor: "var(--accent)", color: "var(--accent-foreground)" } : { borderColor: "var(--border)", color: "var(--muted)" }}
            >
              {i < step ? "✓" : i + 1}
            </span>
            <span className={i === step ? "font-bold" : ""} style={i > step ? { color: "var(--muted)" } : undefined}>
              {GUEST_STATUS[k].title}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-8 text-sm" style={{ color: "var(--muted)" }}>
        To {s.spotName} · paid {money(s.total)}. Keep this page open, it updates by itself.
      </p>
      <div className="mt-6 flex gap-2">
        <button className="btn-secondary min-h-12 flex-1" onClick={() => void load()}>
          Refresh
        </button>
        {onMore && (
          <button className="btn-primary min-h-12 flex-1" onClick={onMore}>
            Order something else
          </button>
        )}
      </div>
    </div>
  );
}

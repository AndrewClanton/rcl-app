"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadStripe, type Stripe, type StripeElements } from "@stripe/stripe-js";
import { registerTotals, cents } from "@/lib/register-totals";
import { SALES_TAX_PERCENT } from "@/lib/sales-tax";
import { GUEST_STATUS, PAUSED_MESSAGE, TIP_CHOICES, type SeatStatus, type SeatTotals, type TipChoice } from "@/lib/seat-ordering";
import type { SeatItem, SeatSection, CheckoutStatus } from "@/lib/seat-ordering-server";
import type { MemberTier } from "@/lib/types";
import { finishSeatOrder, seatOrderStatus, seatPaymentDeclined, startSeatOrder } from "./actions";
import s from "./order.module.css";

// The phone menu a spot's QR card opens: pick, pay, then watch it come.
// Set in the public site's Proof Sheet look (order.module.css). Cinema spots
// get the dim, dark version so a phone doesn't light up the room.
// Item pictures are left off for now (the data is still there).

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

const money = (n: number) => `$${n.toFixed(2)}`;
// In the cart, an item whose name is in two sections says which ("Americano
// · Cocktails"). Only for showing: the server prices each line by its id.
const cartName = (item: SeatItem) => (item.kicker ? `${item.name} · ${item.kicker}` : item.name);
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
  // The checkout this phone started last: pressing Pay again with the same
  // cart reuses its payment instead of making a new one.
  const lastCheckout = useRef<string | null>(null);

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
    else add({ itemId: item.id, optionIds: [], qty: 1, name: cartName(item), unit: item.price, mods: [], isAlcohol: item.isAlcohol, perkBase: item.dailyPerk ? item.price : null });
  }

  function setQty(key: string, qty: number) {
    setCart((cur) => (qty <= 0 ? cur.filter((l) => l.key !== key) : cur.map((l) => (l.key === key ? { ...l, qty: Math.min(20, qty) } : l))));
  }

  async function startPay() {
    setBusy(true);
    setError(null);
    const r = await startSeatOrder({ code, lines: cart.map((l) => ({ itemId: l.itemId, optionIds: l.optionIds, qty: l.qty })), tip, name, quietly: dark && quietly, reuse: lastCheckout.current }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Couldn't reach us. Check your connection and try again.");
    if (!r.ok) {
      if (r.paused) setOpen(false);
      return setError(r.error);
    }
    lastCheckout.current = r.checkoutId;
    setPay(r);
    setView("pay");
  }

  function paid(id: string) {
    lastCheckout.current = null;
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
    lastCheckout.current = null;
    setCheckoutId(null);
    setView("menu");
    setError(null);
    try {
      window.history.replaceState(null, "", `/order/${code}`);
    } catch {
      // fine
    }
  }

  // Each screen starts at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  return (
    <div className={`${s.root} ${dark ? s.dark : ""}`}>
      {dark && <style>{`html,body{background:#0b0a08}`}</style>}
      <header className={s.header}>
        <div className={s.headerInner}>
          <div className="min-w-0">
            <div className={s.kicker}>Royale Cinema · Order from your seat</div>
            <h1 className={s.spot}>{spotName}</h1>
          </div>
          <MemberChip guest={guest} code={code} />
        </div>
        <div className={s.sprockets} aria-hidden />
      </header>

      <main className={s.main}>
        {view === "status" && checkoutId ? (
          <StatusView key={checkoutId} checkoutId={checkoutId} onMore={open ? orderMore : null} />
        ) : !open ? (
          <div className={`${s.sheet} ${s.paused} ${s.enter}`}>
            <span className={s.tag}>Paused</span>
            <p className={s.h1} style={{ fontSize: "1.5rem" }}>
              {PAUSED_MESSAGE}
            </p>
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
        <div className={s.bar}>
          <div className={s.barInner}>
            <p className={s.added} role="status" aria-live="polite">
              {added ? `Added · ${added}` : ""}
            </p>
            <button className={`${s.btn} ${s.wide} ${s.barBtn}`} onClick={() => setView("cart")}>
              <span className="flex items-center gap-2">
                <span className={s.count}>{count}</span>
                View order
              </span>
              <span className="tabular-nums">{money(totals.subtotal)}</span>
            </button>
          </div>
        </div>
      )}

      {picking && (
        <ItemSheet
          item={picking}
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
      <a href={`/account/login?next=${encodeURIComponent(`/order/${code}`)}`} className={s.signIn}>
        Member? Sign in
      </a>
    );
  }
  return (
    <div className={s.hello}>
      <div className={s.helloName}>Hi {guest.firstName}</div>
      <div className={s.helloTier}>{guest.tier === "Insiders+" ? "Insiders+ · 10% off" : "Earning points"}</div>
    </div>
  );
}

function MenuView({ menu, onTap, dark }: { menu: SeatSection[]; onTap: (i: SeatItem) => void; dark: boolean }) {
  if (!menu.length) {
    return (
      <div className={`${s.sheet} ${s.paused} ${s.enter}`}>
        <p className={s.h1} style={{ fontSize: "1.5rem", marginTop: 0 }}>
          Nothing on the menu right now.
        </p>
        <p className={s.lede}>Please order at the counter.</p>
      </div>
    );
  }
  return (
    <div className={s.enter}>
      <span className={s.tag}>{dark ? "Brought to your row" : "Brought to your booth"}</span>
      <h2 className={s.h1}>What can we bring you?</h2>
      <p className={s.lede}>Tap to add. Pay by phone, and we&apos;ll bring it over.</p>
      <nav className={s.chips} aria-label="Menu sections">
        {menu.map((sec) => (
          <a key={sec.key} href={`#sec-${sec.key}`} className={s.chip}>
            {sec.label}
          </a>
        ))}
      </nav>
      {menu.map((sec) => (
        <section key={sec.key} id={`sec-${sec.key}`} className={`${s.section} ${s.sheet}`} aria-labelledby={`h-${sec.key}`}>
          <h2 id={`h-${sec.key}`} className={s.specHead}>
            {sec.label}
            <small>
              {sec.items.length} item{sec.items.length === 1 ? "" : "s"}
            </small>
          </h2>
          <ul className={s.items}>
            {sec.items.map((item) => (
              <li key={item.id}>
                <button className={s.item} onClick={() => onTap(item)} aria-label={`${item.name}, ${money(item.price)}${item.groups.length ? ", choose options" : ", add to order"}`}>
                  <span className={s.itemText}>
                    <span className={s.itemName}>{item.name}</span>
                    {item.description && <span className={s.itemNote}>{item.description}</span>}
                    {(item.isAlcohol || item.groups.length > 0) && (
                      <span className={`${s.itemNote} ${s.mono}`}>
                        {item.isAlcohol && <span className={s.age}>21+</span>}
                        {item.isAlcohol ? "ID checked when we bring it" : "Choices"}
                      </span>
                    )}
                  </span>
                  <span className={s.price}>{money(item.price)}</span>
                  <span className={s.plus} aria-hidden>
                    +
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ItemSheet({ item, onClose, onAdd }: { item: SeatItem; onClose: () => void; onAdd: (l: Omit<CartLine, "key">) => void }) {
  const [sel, setSel] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(item.groups.map((g) => [g.id, g.type === "single" && !g.mustChoose ? [g.options[0].id] : []])),
  );
  const [qty, setQty] = useState(1);
  const unanswered = item.groups.filter((g) => g.type === "single" && g.mustChoose && !(sel[g.id] ?? []).length);
  const chosen = item.groups.flatMap((g) => g.options.filter((o) => (sel[g.id] ?? []).includes(o.id)));
  const unit = cents(Math.max(0, item.price + chosen.reduce((s, o) => s + o.delta, 0)));
  const panel = useRef<HTMLDivElement>(null);

  // Focus moves into the sheet, stays there, and goes back where it was on
  // close. Escape closes it; the page behind doesn't scroll.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const f = Array.from(panel.current.querySelectorAll<HTMLElement>("button:not(:disabled), [href], input, [tabindex]:not([tabindex='-1'])"));
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [onClose]);

  function toggle(groupId: string, type: "single" | "multi", optionId: string) {
    setSel((cur) => {
      if (type === "single") return { ...cur, [groupId]: [optionId] };
      const list = cur[groupId] ?? [];
      return { ...cur, [groupId]: list.includes(optionId) ? list.filter((x) => x !== optionId) : [...list, optionId] };
    });
  }

  return (
    <div className={s.scrim} onClick={onClose}>
      <div ref={panel} tabIndex={-1} className={s.drawer} role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
        <div className={s.drawerHead}>
          <div className="min-w-0 flex-1">
            <div className={s.kicker}>{item.isAlcohol ? "21+ · ID checked when we bring it" : `From ${money(item.price)}`}</div>
            <h2 id="sheet-title" className={s.drawerTitle}>
              {item.name}
            </h2>
          </div>
          <button className={s.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={s.drawerBody}>
          {item.groups.map((g) => {
            const need = g.mustChoose && !(sel[g.id] ?? []).length;
            return (
              <fieldset key={g.id} className={s.group}>
                <legend className={`${s.legend} ${need ? s.need : ""}`}>
                  {g.label} <span className={s.mono}>{g.type === "single" ? (g.mustChoose ? "pick one" : "choose 1") : "optional"}</span>
                </legend>
                <div className={s.options}>
                  {g.options.map((o) => {
                    const on = (sel[g.id] ?? []).includes(o.id);
                    return (
                      <button key={o.id} className={s.option} aria-pressed={on} onClick={() => toggle(g.id, g.type, o.id)}>
                        {o.name}
                        {o.delta !== 0 && (
                          <span className={s.delta}>
                            {o.delta > 0 ? "+" : "−"}
                            {money(Math.abs(o.delta))}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
          <div className={s.drawerFoot}>
            <Stepper value={qty} onChange={setQty} min={1} />
            <button
              className={`${s.btn} flex-1`}
              disabled={unanswered.length > 0}
              onClick={() =>
                onAdd({
                  itemId: item.id,
                  optionIds: item.groups.flatMap((g) => sel[g.id] ?? []),
                  qty,
                  name: cartName(item),
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
    </div>
  );
}

function Stepper({ value, onChange, min = 0 }: { value: number; onChange: (n: number) => void; min?: number }) {
  return (
    <div className={s.stepper}>
      <button onClick={() => onChange(Math.max(min, value - 1))} aria-label={value - 1 < 1 && min === 0 ? "Remove" : "One less"}>
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button onClick={() => onChange(Math.min(20, value + 1))} aria-label="One more">
        +
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.rrow}>
      <span>{label}</span>
      <span>{value}</span>
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
    <div className={s.enter}>
      <button className={s.back} onClick={p.onBack}>
        ← Back to the menu
      </button>
      <h2 className={s.h1} style={{ marginTop: "0.25rem" }}>
        Your order
      </h2>
      <div className={`${s.sheet} mt-4`}>
        <div className={s.specHead}>
          Order
          <small>
            {p.cart.reduce((n, l) => n + l.qty, 0)} item{p.cart.reduce((n, l) => n + l.qty, 0) === 1 ? "" : "s"}
          </small>
        </div>
        {p.cart.length === 0 ? (
          <p className="px-4 py-5" style={{ color: "var(--dim)" }}>
            Nothing yet.
          </p>
        ) : (
          <ul className={s.lines}>
            {p.cart.map((l) => (
              <li key={l.key}>
                <div className="min-w-0 flex-1">
                  <div className={s.itemName}>{l.name}</div>
                  {l.mods.length > 0 && <div className={`${s.mono} mt-0.5`}>{l.mods.join(" · ")}</div>}
                  <div className={`${s.price} mt-1`}>{money(l.unit * l.qty)}</div>
                </div>
                <Stepper value={l.qty} onChange={(n) => p.setQty(l.key, n)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className={s.field} htmlFor="seat-name">
        <span className={s.label}>
          Name for the order <em>· optional</em>
        </span>
        <input id="seat-name" className={s.input} value={p.name} maxLength={40} autoComplete="given-name" onChange={(e) => p.setName(e.target.value)} placeholder="So we know who's who" />
      </label>

      {p.dark && (
        <label className={s.check}>
          <input type="checkbox" checked={p.quietly} onChange={(e) => p.setQuietly(e.target.checked)} />
          Deliver quietly (the movie&apos;s on)
        </label>
      )}

      <div className={s.field} role="group" aria-labelledby="tip-label">
        <span id="tip-label" className={s.label}>
          Tip
        </span>
        <div className={s.tips}>
          {TIP_CHOICES.map((c) => (
            <button key={c} className={s.option} aria-pressed={p.tip === c} onClick={() => p.setTip(c)}>
              {c === 0 ? "None" : `${c}%`}
            </button>
          ))}
        </div>
      </div>

      <div className={`${s.sheet} ${s.receipt}`}>
        <Row label="Subtotal" value={money(t.subtotal)} />
        {t.dailyPerkDiscount > 0 && <Row label="Insiders+ daily coffee" value={`−${money(t.dailyPerkDiscount)}`} />}
        {t.tierDiscount > 0 && <Row label="Insiders+ 10% off" value={`−${money(t.tierDiscount)}`} />}
        <Row label={`Tax (${SALES_TAX_PERCENT}%)`} value={money(t.tax)} />
        {t.tip > 0 && <Row label="Tip" value={money(t.tip)} />}
        <div className={s.rtotal}>
          <span>Total</span>
          <span className="tabular-nums">{money(t.grand)}</span>
        </div>
        {p.guest && <p className={`${s.mono} mt-2`}>Earns points on your Insiders account</p>}
      </div>

      {p.hasAlcohol && (
        <p className={s.notice} role="note">
          There&apos;s alcohol in this order. We&apos;ll check ID when we bring it.
        </p>
      )}
      {p.error && (
        <p className={s.error} role="alert">
          {p.error}
        </p>
      )}
      <button className={`${s.btn} ${s.wide} mt-5`} disabled={p.busy || p.cart.length === 0} onClick={p.onPay}>
        {p.busy ? "One moment…" : `Pay ${money(t.grand)}`}
      </button>
      <p className={s.fine}>Card, Apple Pay or Google Pay. We bring it to {p.dark ? "your row" : "you"}.</p>
    </div>
  );
}

const PAY_TIMEOUT_MS = 10_000;

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
  // The card form didn't load (Stripe's error, or nothing after 10 seconds).
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Declined too many times: the payment is closed (card testing guard).
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    let isReady = false;
    const fail = () => {
      if (cancelled || isReady) return;
      setFailed(true);
    };
    const timer = setTimeout(fail, PAY_TIMEOUT_MS);
    (async () => {
      const stripe = publishableKey ? await loadStripe(publishableKey).catch(() => null) : null;
      if (cancelled) return;
      if (!stripe || !mount.current) return fail();
      const styles = getComputedStyle(mount.current);
      const v = (name: string) => styles.getPropertyValue(name).trim();
      const elements = stripe.elements({
        clientSecret: pay.clientSecret,
        appearance: {
          theme: dark ? "night" : "stripe",
          variables: { colorPrimary: v("--red"), colorBackground: v("--card"), colorText: v("--text"), colorDanger: v("--red-text"), borderRadius: "4px", fontSizeBase: "16px" },
        },
      });
      const el = elements.create("payment", { layout: "tabs" });
      el.on("ready", () => {
        isReady = true;
        clearTimeout(timer);
        if (!cancelled) setReady(true);
      });
      el.on("loaderror", () => {
        clearTimeout(timer);
        fail();
      });
      el.mount(mount.current);
      destroy = () => el.destroy();
      stripeRef.current = stripe;
      elementsRef.current = elements;
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      destroy?.();
    };
  }, [pay.clientSecret, publishableKey, dark, attempt]);

  function retry() {
    stripeRef.current = null;
    elementsRef.current = null;
    setReady(false);
    setFailed(false);
    setError(null);
    setAttempt((n) => n + 1);
  }

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
      const message = err.message ?? "The payment didn't go through.";
      const check = err.type === "validation_error" ? null : await seatPaymentDeclined(pay.checkoutId).catch(() => null);
      setBusy(false);
      if (check?.closed) {
        setClosed(true);
        setError(check.error ?? message);
      } else setError(message);
      return;
    }
    onPaid(pay.checkoutId);
  }

  const t = pay.totals;
  return (
    <div className={s.enter}>
      <button className={s.back} onClick={onBack} disabled={busy}>
        ← Change the order
      </button>
      <div style={{ marginTop: "0.5rem" }}>
        <span className={s.tag}>Checkout</span>
      </div>
      <h2 className={s.h1}>Pay {money(t.total)}</h2>
      <p className={`${s.mono} mt-2`}>
        {[t.memberDiscount > 0 && `${money(t.memberDiscount)} Insiders+ off`, t.dailyPerk > 0 && "daily coffee on us", `tax ${money(t.tax)}`, t.tip > 0 && `tip ${money(t.tip)}`, t.points > 0 && `earns ${Math.floor(t.points)} points`].filter(Boolean).join(" · ")}
      </p>
      {failed ? (
        <div className={`${s.sheet} ${s.fallback}`} role="alert">
          <p>Card payment isn&apos;t loading.</p>
          <div className={s.row2} style={{ marginTop: 0 }}>
            <button className={s.btn} onClick={retry}>
              Try again
            </button>
          </div>
          <p className={s.fine} style={{ textAlign: "left", fontWeight: 400 }}>
            Or order at the counter, nothing has been charged.
          </p>
        </div>
      ) : (
        <div className={`${s.sheet} ${s.payBox}`}>
          {!ready && (
            <div className={s.loading} role="status">
              <span className={s.spinner} aria-hidden />
              Loading card payment…
            </div>
          )}
          <div key={attempt} ref={mount} />
        </div>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {!failed && !closed && (
        <button className={`${s.btn} ${s.wide} mt-5`} disabled={!ready || busy} onClick={confirm}>
          {busy ? "Paying…" : `Pay ${money(t.total)}`}
        </button>
      )}
    </div>
  );
}

const STEPS: SeatStatus[] = ["new", "making", "delivered"];
const OFFLINE_AFTER = 3; // failed checks in a row before we say so
// The phone stops asking the server to send a paid order through after this
// many tries (the register's sweep and the webhook still do), and stops
// watching the order after WATCH_MS (Refresh still works).
const MAX_FINISH_TRIES = 10;
const WATCH_MS = 2 * 3_600_000;

function StatusView({ checkoutId, onMore }: { checkoutId: string; onMore: (() => void) | null }) {
  const [st, setSt] = useState<CheckoutStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [misses, setMisses] = useState(0);
  // Stripe said no for good (not paid, or doesn't match): stop asking.
  const [declined, setDeclined] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await seatOrderStatus(checkoutId).catch(() => undefined);
    if (r === undefined) return setMisses((n) => n + 1);
    setMisses(0);
    if (r === null) return setMissing(true);
    setSt(r);
  }, [checkoutId]);

  // Make sure the paid order reached the staff (the phone may have come
  // back from a bank's page), then watch it.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fails = 0;
    let finishTries = 0;
    const startedAt = Date.now();
    const tick = async (tries: number) => {
      if (stop || Date.now() - startedAt > WATCH_MS) return;
      const cur = await seatOrderStatus(checkoutId).catch(() => undefined);
      if (stop) return;
      if (cur === null) {
        setMissing(true);
        return;
      }
      if (cur === undefined) {
        fails += 1;
        setMisses(fails);
      } else {
        fails = 0;
        setMisses(0);
      }
      if (cur && !cur.paid && finishTries >= MAX_FINISH_TRIES) {
        setNote("Your payment is safe. If this doesn't change in a minute or two, show this screen at the counter.");
      } else if (cur && !cur.paid) {
        finishTries += 1;
        const f = await finishSeatOrder(checkoutId).catch(() => null);
        if (stop) return;
        if (f && !f.ok) {
          if (!f.pending) {
            setSt(cur);
            setDeclined(f.error);
            return;
          }
          setNote(f.error);
        }
      } else setNote(null);
      if (cur) setSt(cur);
      if (cur?.status === "delivered" || cur?.refunded) return;
      const slow = finishTries >= MAX_FINISH_TRIES && !cur?.paid;
      timer = setTimeout(() => void tick(tries + 1), fails ? Math.min(30_000, 5000 * fails) : slow ? 15_000 : tries < 3 ? 2500 : 6000);
    };
    void tick(0);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [checkoutId]);

  const offline = misses >= OFFLINE_AFTER && (
    <p className={s.offline} role="alert">
      Can&apos;t reach us right now. Your payment is safe; show this screen at the counter.
    </p>
  );

  if (missing) {
    return (
      <div className={`${s.sheet} ${s.paused} ${s.enter}`}>
        <p className={s.statusTitle}>We couldn&apos;t find that order.</p>
        <p className={s.lede}>If you paid, show this screen at the counter.</p>
      </div>
    );
  }
  if (!st) {
    return (
      <div className={s.enter}>
        <div className={s.loading} role="status" style={{ marginTop: "2rem" }}>
          <span className={s.spinner} aria-hidden />
          Checking your order…
        </div>
        {offline}
      </div>
    );
  }
  if (declined) {
    return (
      <div className={s.enter}>
        <span className={s.tag}>Not paid</span>
        <h2 className={s.h1}>The payment didn&apos;t go through</h2>
        <p className={s.lede}>{declined} Nothing was sent to the kitchen. Questions? Show this screen at the counter.</p>
        {onMore && (
          <div className={s.row2}>
            <button className={s.btn} onClick={onMore}>
              Back to the menu
            </button>
          </div>
        )}
      </div>
    );
  }
  const step = st.paid ? STEPS.indexOf(st.status ?? "new") : -1;
  const words = st.paid && st.status ? GUEST_STATUS[st.status] : { title: "Confirming your payment", sub: note ?? "Just a moment." };
  return (
    <div className={s.enter}>
      <div className={`${s.sheet} ${s.stub}`}>
        <div className={s.stubNum}>
          <span className={s.mono} style={{ color: "inherit" }}>
            Order
          </span>
          <b>{st.orderNumber ? `#${st.orderNumber}` : "—"}</b>
        </div>
        <div className={s.stubBody}>
          <p className={s.mono}>To {st.spotName}</p>
          <h2 className={s.statusTitle} aria-live="polite">
            {st.refunded ? "Refunded" : words.title}
          </h2>
          <p className={s.lede} style={{ marginTop: "0.35rem" }}>
            {st.refunded ? "This order was refunded to your card." : words.sub}
          </p>
        </div>
      </div>
      {!st.refunded && (
        <ol className={s.steps} aria-label="Progress">
          {STEPS.map((k, i) => {
            const done = i < step || (i === step && k === "delivered");
            const now = i === step && !done;
            return (
              <li key={k} className={`${s.step} ${done ? s.stepDone : ""} ${now ? s.stepNow : ""}`} aria-current={now ? "step" : undefined}>
                <span className={s.dot}>{done ? "✓" : i + 1}</span>
                <span>{GUEST_STATUS[k].title}</span>
              </li>
            );
          })}
        </ol>
      )}
      {offline}
      <p className={`${s.mono} mt-6`}>{st.paid ? `Paid ${money(st.total)} · this page updates by itself` : `Total ${money(st.total)} · this page updates by itself`}</p>
      <div className={s.row2}>
        <button className={s.btnGhost} onClick={() => void load()}>
          Refresh
        </button>
        {onMore && (
          <button className={s.btn} onClick={onMore}>
            Order more
          </button>
        )}
      </div>
    </div>
  );
}

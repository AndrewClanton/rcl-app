"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MenuCategory, Employee, MemberTier, Recipe } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { REGISTER_CHANNEL, EMPTY_CART_SNAPSHOT, type RegisterCartSnapshot } from "@/lib/registerChannel";
import ItemBuilder, { type BuiltLine } from "./ItemBuilder";
import PaymentModal from "./PaymentModal";
import TipModal from "./TipModal";
import CustomItemModal from "./CustomItemModal";
import MovieTickets from "./MovieTickets";
import { checkTicketSeats, getTicketPrintInfo, type RegisterScreening } from "./ticket-actions";
import { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/loyalty";
import PosMemberPanel from "./PosMemberPanel";
import type { PosMember } from "./member-actions";
import ManagerPinModal from "@/components/ManagerPinModal";
import PromptModal from "@/components/PromptModal";
import ConfirmModal from "@/components/ConfirmModal";
import { receiptXml, drawerXml, ticketXml, type ReceiptData } from "@/lib/print/receipt";
import { imageToRaster, type Raster } from "@/lib/print/raster";
import { LOGO_RASTER } from "@/lib/print/logo-raster";
import { sendToPrinter } from "@/lib/print/epos-client";
import DevicesPanel from "./devices/DevicesPanel";
import { useDeviceSettings } from "./devices/settings";
import {
  completeOrder,
  saveDraftOrder,
  updateDraftOrder,
  loadDraftOrder,
  discardDraftOrder,
  cancelTab,
  type CheckoutPayment,
  type CheckoutTotals,
  type DraftOrderSummary,
  type DraftFields,
} from "./actions";

// Joplin, MO combined sales tax (state + county + city): 8.725%. This is the
// rate the business's quarterly Missouri filings are figured at.
const TAX_RATE = 0.08725;

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

interface CartLine {
  key: string;
  menuItemId: string | null;
  screeningId?: string | null; // a movie ticket for this showing
  name: string;
  unit: number;
  qty: number;
  mods: string[];
  isAlcohol: boolean;
}

// The Movies tab sits alongside the menu categories.
const MOVIES_TAB = "__movies";

// Movie tickets on a sale, for printing one keepsake ticket per admission.
type TicketSale = { screeningId: string; qty: number };

// Poster pictures are converted for the printer once per register session.
const posterCache = new Map<string, Promise<Raster | null>>();
function posterRaster(url: string) {
  if (!posterCache.has(url)) posterCache.set(url, imageToRaster(url, 320, 520));
  return posterCache.get(url)!;
}

// One ticket per admission, sent one at a time so the printer never gets a
// huge job. Returns the first failure, if any.
async function printTickets(printerAddress: string, orderNumber: number, sales: TicketSale[]) {
  const info = await getTicketPrintInfo([...new Set(sales.map((t) => t.screeningId))]).catch(() => null);
  if (!info) return { ok: false as const, error: "Couldn't look up the showings to print tickets. Tap Reprint last tickets under Devices." };
  let index = 0;
  for (const sale of sales) {
    const show = info[sale.screeningId];
    if (!show) continue;
    const poster = show.posterUrl ? await posterRaster(show.posterUrl) : null;
    for (let n = 0; n < sale.qty; n++) {
      index++;
      const xml = ticketXml(
        { title: show.title, startsAt: show.startsAt, room: show.room, rating: show.rating, runtime: show.runtime, orderNumber, code: `RCL-TKT:${orderNumber}:${sale.screeningId.slice(0, 8)}:${index}` },
        { logo: LOGO_RASTER, poster },
      );
      const r = await sendToPrinter(printerAddress, xml);
      if (!r.ok) return r;
    }
  }
  return { ok: true as const };
}

type TotalsMember = { tier: MemberTier; points: number } | null;

function memberDiscountRate(member: TotalsMember) {
  if (!member) return 0;
  return member.tier === "Insiders+" ? 0.1 : 0.05;
}

function computeTotals(cart: CartLine[], member: TotalsMember, monthlyMember: boolean, taxFree: boolean, pointsRedeemed: boolean) {
  // Every money figure is rounded to the cent, so the tax shown, the total
  // charged on the card and the order saved all agree to the penny.
  const cents = (n: number) => Math.round(n * 100) / 100;
  const subtotal = cents(cart.reduce((s, l) => s + l.unit * l.qty, 0));
  const tierDiscount = cents(subtotal * memberDiscountRate(member));
  const monthlyDiscount = monthlyMember ? cents(subtotal * 0.1) : 0;
  const canRedeem = !!member && member.points >= POINTS_PER_REWARD;
  const redemptionDiscount = canRedeem && pointsRedeemed ? REWARD_VALUE : 0;
  const discount = tierDiscount + monthlyDiscount + redemptionDiscount;
  const taxable = subtotal - discount;
  // Never negative: a $5 reward on a $4 order is a free order, not a tax refund.
  const tax = taxFree ? 0 : cents(Math.max(0, taxable) * TAX_RATE);
  const total = cents(Math.max(0, taxable) + tax);
  return { subtotal, tierDiscount, monthlyDiscount, redemptionDiscount, discount, tax, total, canRedeem };
}

// Draft rows (held orders + tabs) persist the same shape the cart displays,
// so the held/tabs lists never drift from what's actually on the check.
function totalsPayload(t: ReturnType<typeof computeTotals>): CheckoutTotals {
  return {
    subtotal: t.subtotal,
    tier_discount: t.tierDiscount,
    monthly_discount: t.monthlyDiscount,
    redemption_discount: t.redemptionDiscount,
    tax: t.tax,
    total: t.total,
  };
}

export default function PosApp({
  categories,
  employees,
  heldOrders,
  openTabs,
  recipesByItem,
  defaultReaderId,
  initialScreenings,
}: {
  categories: MenuCategory[];
  employees: Employee[];
  heldOrders: DraftOrderSummary[];
  openTabs: DraftOrderSummary[];
  recipesByItem: Record<string, Recipe>;
  defaultReaderId: string | null;
  initialScreenings: RegisterScreening[];
}) {
  const router = useRouter();
  const [nav, setNav] = useState<{ categoryId: string | null; subcategoryId: string | null }>({
    categoryId: categories[0]?.id ?? null,
    subcategoryId: null,
  });
  const [builderItemId, setBuilderItemId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderName, setOrderName] = useState("");
  const [employeeId, setEmployeeId] = useState<string>("");
  const [member, setMember] = useState<PosMember | null>(null);
  const memberId = member?.id ?? null;
  const [taxFree, setTaxFree] = useState(false);
  const [monthlyMember, setMonthlyMember] = useState(false);
  const [pointsRedeemed, setPointsRedeemed] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [ageConfirmOpen, setAgeConfirmOpen] = useState(false);
  const [tip, setTip] = useState(0);
  const [heldListOpen, setHeldListOpen] = useState(false);
  const [tabsListOpen, setTabsListOpen] = useState(false);
  const [cancelTabId, setCancelTabId] = useState<string | null>(null);
  const [openTabPromptOpen, setOpenTabPromptOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<{ title: string; description?: string; danger?: boolean; confirmLabel?: string; onConfirm: () => void } | null>(
    null
  );
  const [toast, setToast] = useState<string | null>(null);
  const devices = useDeviceSettings();
  const readerId = devices.readerId || defaultReaderId;
  // The most recent sale's receipt, kept for "Print receipt" / "Reprint".
  const [lastReceipt, setLastReceipt] = useState<ReceiptData | null>(null);
  const [printNote, setPrintNote] = useState<string | null>(null);
  // The last sale's movie tickets, kept for "Reprint last tickets".
  const [lastTickets, setLastTickets] = useState<{ orderNumber: number; lines: TicketSale[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const category = useMemo(() => categories.find((c) => c.id === nav.categoryId) ?? null, [categories, nav.categoryId]);
  const ticketsInCart = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of cart) if (l.screeningId) m.set(l.screeningId, (m.get(l.screeningId) ?? 0) + l.qty);
    return m;
  }, [cart]);
  const subcategory = useMemo(() => category?.subcategories.find((s) => s.id === nav.subcategoryId) ?? null, [category, nav.subcategoryId]);
  const items = subcategory ? subcategory.items : category?.subcategories.length ? [] : category?.items ?? [];
  const builderItem = useMemo(() => {
    for (const c of categories) {
      for (const i of c.items) if (i.id === builderItemId) return i;
      for (const s of c.subcategories) for (const i of s.items) if (i.id === builderItemId) return i;
    }
    return null;
  }, [categories, builderItemId]);

  const totals = computeTotals(cart, member, monthlyMember, taxFree, pointsRedeemed);
  const itemCount = cart.reduce((s, l) => s + l.qty, 0);
  const activeTab = activeTabId ? openTabs.find((t) => t.id === activeTabId) : null;

  function currentFields(): DraftFields {
    return {
      employeeId,
      memberId,
      orderName,
      taxFree,
      monthlyMember,
      pointsRedeemed,
      lines: cart.map((l) => ({
        menu_item_id: l.menuItemId,
        name: l.name,
        unit_price: l.unit,
        quantity: l.qty,
        modifiers: l.mods,
        is_alcohol: l.isAlcohol,
        screening_id: l.screeningId ?? null,
      })),
    };
  }

  function loadFields(id: string, f: Awaited<ReturnType<typeof loadDraftOrder>>) {
    setCart(
      f.lines.map((l) => ({
        key: `${Date.now()}-${Math.random()}`,
        menuItemId: l.menu_item_id,
        name: l.name,
        unit: l.unit,
        qty: l.quantity,
        mods: l.modifiers,
        isAlcohol: l.is_alcohol,
        screeningId: l.screening_id ?? null,
      }))
    );
    setOrderName(f.order_name ?? "");
    setMember(f.member);
    setTaxFree(f.tax_free);
    setMonthlyMember(f.monthly_member);
    setPointsRedeemed(f.points_redeemed);
  }

  function addLine(line: BuiltLine) {
    setCart((prev) => [...prev, { key: `${Date.now()}-${Math.random()}`, ...line }]);
    setBuilderItemId(null);
  }

  function updateQty(key: string, delta: number) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, qty: Math.max(1, l.qty + delta) } : l)));
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  // Keeps the active tab's DB row current as the cart is built, instead of
  // only saving when the cashier switches away/holds/checks out. Without
  // this, the Tabs list (and a reload or crash) showed whatever was on the
  // tab the last time it was left, not what had just been added to it.
  useEffect(() => {
    if (!activeTabId) return;
    const id = activeTabId;
    const fields = currentFields();
    const payload = totalsPayload(totals);
    const timer = setTimeout(() => {
      updateDraftOrder(id, fields, payload).then(() => router.refresh());
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, cart, orderName, taxFree, monthlyMember, pointsRedeemed, memberId]);

  // Mirrors the cart onto the customer-facing kiosk display in real time,
  // via Realtime broadcast rather than a database row -- entirely separate
  // from the draft/tab persistence above, so this can't affect payment or
  // order-history logic. cartSnapshotRef always holds the latest snapshot
  // (updated every render, read from both the debounced broadcast-on-change
  // effect below and the request-state handler in the subscribe effect),
  // which avoids a stale closure in the long-lived channel subscription.
  const cartSnapshotRef = useRef<RegisterCartSnapshot>(EMPTY_CART_SNAPSHOT);
  cartSnapshotRef.current = {
    orderName,
    items: cart.map((l) => ({ name: l.name, quantity: l.qty, modifiers: l.mods })),
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
  };
  const registerChannelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(REGISTER_CHANNEL);
    registerChannelRef.current = channel;
    channel
      .on("broadcast", { event: "request-state" }, () => {
        channel.send({ type: "broadcast", event: "cart", payload: cartSnapshotRef.current });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      registerChannelRef.current = null;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      registerChannelRef.current?.send({ type: "broadcast", event: "cart", payload: cartSnapshotRef.current });
    }, 250);
    return () => clearTimeout(timer);
  }, [cart, orderName, totals.subtotal, totals.tax, totals.total]);

  function resetOrder() {
    setCart([]);
    setOrderName("");
    setMember(null);
    setTaxFree(false);
    setMonthlyMember(false);
    setPointsRedeemed(false);
    setActiveTabId(null);
  }

  async function stashCurrentWork() {
    if (activeTabId) {
      await updateDraftOrder(activeTabId, currentFields(), totalsPayload(totals));
      return;
    }
    if (cart.length > 0) {
      // Auto-hold rather than asking -- never silently lose an in-progress
      // order; it'll sit in the held list for the cashier to clean up.
      const fields = currentFields();
      fields.orderName = fields.orderName || `Held ${new Date().toLocaleTimeString()}`;
      await saveDraftOrder("held", fields, totalsPayload(totals));
    }
  }

  async function handleHold() {
    if (cart.length === 0) return;
    setBusy(true);
    try {
      const fields = currentFields();
      fields.orderName = fields.orderName || `Held ${new Date().toLocaleTimeString()}`;
      await saveDraftOrder("held", fields, totalsPayload(totals));
      resetOrder();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function doResumeHeld(id: string) {
    setBusy(true);
    try {
      const full = await loadDraftOrder(id);
      loadFields(id, full);
      await discardDraftOrder(id);
      setHeldListOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function handleResumeHeld(id: string) {
    if (cart.length > 0) {
      setConfirmState({
        title: "Replace current order?",
        description: "This will replace the current unsaved order.",
        onConfirm: () => {
          setConfirmState(null);
          doResumeHeld(id);
        },
      });
    } else {
      doResumeHeld(id);
    }
  }

  function handleDiscardHeld(id: string) {
    setConfirmState({
      title: "Discard this held order?",
      danger: true,
      confirmLabel: "Discard",
      onConfirm: async () => {
        setConfirmState(null);
        setBusy(true);
        try {
          await discardDraftOrder(id);
          router.refresh();
        } finally {
          setBusy(false);
        }
      },
    });
  }

  async function handleOpenTab(name: string) {
    setOpenTabPromptOpen(false);
    setBusy(true);
    try {
      await stashCurrentWork();
      const id = await saveDraftOrder("tab", { employeeId, memberId: null, orderName: name, taxFree: false, monthlyMember: false, pointsRedeemed: false, lines: [] });
      resetOrder();
      setActiveTabId(id);
      setOrderName(name);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleSwitchTab(id: string) {
    setBusy(true);
    try {
      await stashCurrentWork();
      const full = await loadDraftOrder(id);
      loadFields(id, full);
      setActiveTabId(id);
      setTabsListOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelTab(pin: string) {
    if (!cancelTabId) return;
    await cancelTab(cancelTabId, pin);
    if (activeTabId === cancelTabId) resetOrder();
    setCancelTabId(null);
    router.refresh();
  }

  async function startCheckout() {
    if (!employeeId || cart.length === 0) return;
    // Movie tickets: make sure the seats are still there before anyone pays.
    const tickets = cart.filter((l) => l.screeningId).map((l) => ({ screeningId: l.screeningId as string, quantity: l.qty }));
    if (tickets.length) {
      setBusy(true);
      const r = await checkTicketSeats(tickets).catch(() => null);
      setBusy(false);
      if (!r || !r.ok) {
        setToast(r && !r.ok ? r.error : "Couldn't check seats. Check the connection and try again.");
        return;
      }
    }
    if (activeTabId) {
      setTipOpen(true);
    } else {
      continueAfterTip(0);
    }
  }

  function continueAfterTip(tipAmount: number) {
    setTip(tipAmount);
    setTipOpen(false);
    const hasAlcohol = cart.some((l) => l.isAlcohol);
    if (hasAlcohol) setAgeConfirmOpen(true);
    else setPayOpen(true);
  }

  // Never blocks or undoes a sale: the order is already saved when this runs,
  // so a printer problem only shows a note with a way to try again.
  async function printAfterSale(receipt: ReceiptData, tookCash: boolean, tickets: TicketSale[]) {
    setPrintNote(null);
    if (!devices.printerAddress) return;
    const openDrawer = tookCash && devices.drawerOnCash;
    if (devices.autoPrint || openDrawer) {
      const r = await sendToPrinter(devices.printerAddress, devices.autoPrint ? receiptXml(receipt, { openDrawer }) : drawerXml());
      if (!r.ok) return setPrintNote(r.error);
    }
    if (devices.printTickets && tickets.length) {
      const t = await printTickets(devices.printerAddress, receipt.orderNumber, tickets);
      if (!t.ok) setPrintNote(`Tickets didn't print: ${t.error}`);
    }
  }

  async function finalizeCheckout(payment: CheckoutPayment) {
    setPayOpen(false);
    setBusy(true);
    // A tab's tip is asked on the register (TipModal); any other card sale
    // can get one on the reader. Either way it's one tip on the order.
    const allTip = tip + (payment.tip ?? 0);
    try {
      const { orderNumber } = await completeOrder({
        ...currentFields(),
        totals: {
          subtotal: totals.subtotal,
          tier_discount: totals.tierDiscount,
          monthly_discount: totals.monthlyDiscount,
          redemption_discount: totals.redemptionDiscount,
          tax: totals.tax,
          total: totals.total,
        },
        payment,
        ageVerified: cart.some((l) => l.isAlcohol),
        tip: allTip,
        draftOrderId: activeTabId,
      });
      const receipt: ReceiptData = {
        orderNumber,
        at: new Date().toISOString(),
        cashier: employees.find((e) => e.id === employeeId)?.name ?? null,
        member: member?.name ?? null,
        orderName: orderName.trim() || null,
        lines: cart.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, mods: l.mods })),
        subtotal: totals.subtotal,
        discounts: [
          { label: "Member discount", amount: totals.tierDiscount },
          { label: "Monthly member discount", amount: totals.monthlyDiscount },
          { label: "Points reward", amount: totals.redemptionDiscount },
        ],
        tax: totals.tax,
        tip: allTip,
        total: totals.total + allTip,
        payments: [
          { label: "Cash", amount: payment.cash },
          { label: "Card", amount: payment.card },
        ],
      };
      setLastReceipt(receipt);
      const tickets: TicketSale[] = cart.filter((l) => l.screeningId).map((l) => ({ screeningId: l.screeningId as string, qty: l.qty }));
      setLastTickets(tickets.length ? { orderNumber, lines: tickets } : null);
      void printAfterSale(receipt, payment.cash > 0, tickets);
      const parts = [`Order #${orderNumber} complete — ${money(totals.total + allTip)} charged (${payment.method})`];
      if (allTip > 0) parts.push(`${money(allTip)} tip`);
      setToast(parts.join(" — "));
      resetOrder();
      setTip(0);
      router.refresh();
      setTimeout(() => setToast(null), 7000);
    } catch (e) {
      setToast(e instanceof Error ? `Checkout failed: ${e.message}` : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 md:min-h-0 md:flex-1 md:grid-cols-[350px_1fr] lg:grid-cols-[380px_1fr]">
      {/* Cart panel. On a tablet the page is locked to the screen: the header
          and the checkout block stay put, and only the middle scrolls. */}
      <div className="card flex flex-col md:min-h-0">
        <div className="shrink-0">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              Cashier
            </span>
            <select className="input flex-1" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Not logged in</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <DevicesPanel
            fallbackReaderId={defaultReaderId}
            onReprintTickets={lastTickets ? () => printTickets(devices.printerAddress, lastTickets.orderNumber, lastTickets.lines) : null}
            onReprint={lastReceipt ? () => sendToPrinter(devices.printerAddress, receiptXml(lastReceipt)) : null} />
          </div>

          <div className="mb-2 flex items-center gap-2">
            <span className="eyebrow whitespace-nowrap">Order</span>
            <span className="whitespace-nowrap text-sm" style={{ color: "var(--muted)" }}>
              {itemCount} item{itemCount === 1 ? "" : "s"}
            </span>
            <button className={`chip ml-auto whitespace-nowrap !px-3 !py-1.5 text-sm ${heldListOpen ? "chip-selected" : ""}`} onClick={() => setHeldListOpen((v) => !v)}>
              Held {heldOrders.length}
            </button>
            <button className={`chip whitespace-nowrap !px-3 !py-1.5 text-sm ${tabsListOpen ? "chip-selected" : ""}`} onClick={() => setTabsListOpen((v) => !v)}>
              Tabs {openTabs.length}
            </button>
          </div>

          {activeTab && (
            <div className="chip chip-selected mb-2 inline-flex w-fit">
              Tab: {activeTab.order_name}
            </div>
          )}

          <input className="input mb-3" placeholder="Order / guest name" value={orderName} onChange={(e) => setOrderName(e.target.value)} />
        </div>

        <div className="space-y-2 md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain md:pr-1">
          {heldListOpen && (
            <div className="card-flat p-3" style={{ background: "var(--surface-hover)" }}>
              <div className="eyebrow mb-2">Held orders</div>
              {heldOrders.length === 0 ? (
                <div className="text-sm" style={{ color: "var(--muted)" }}>
                  No held orders.
                </div>
              ) : (
                heldOrders.map((h) => (
                  <div key={h.id} className="flex items-center justify-between gap-2 border-b py-1.5 text-sm last:border-0" style={{ borderColor: "var(--border)" }}>
                    <span style={{ color: "var(--foreground)" }}>
                      {h.order_name || "Held order"} — {money(h.total)} ({h.item_count} item{h.item_count === 1 ? "" : "s"})
                    </span>
                    <div className="flex gap-1">
                      <button className="rounded-md border px-2 py-0.5 text-xs" style={{ borderColor: "var(--border)" }} onClick={() => handleResumeHeld(h.id)}>
                        Resume
                      </button>
                      <button className="rounded-md border px-2 py-0.5 text-xs" style={{ borderColor: "var(--border)" }} onClick={() => handleDiscardHeld(h.id)}>
                        Discard
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tabsListOpen && (
            <div className="card-flat p-3" style={{ background: "var(--surface-hover)" }}>
              <div className="eyebrow mb-2">Open tabs</div>
              {openTabs.length === 0 ? (
                <div className="text-sm" style={{ color: "var(--muted)" }}>
                  No open tabs.
                </div>
              ) : (
                openTabs.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 border-b py-1.5 text-sm last:border-0" style={{ borderColor: "var(--border)" }}>
                    <span style={{ color: "var(--foreground)" }}>
                      {t.order_name} — {money(t.total)} ({t.item_count} item{t.item_count === 1 ? "" : "s"})
                      {t.id === activeTabId ? " · active now" : ""}
                    </span>
                    <div className="flex gap-1">
                      {t.id !== activeTabId && (
                        <button className="rounded-md border px-2 py-0.5 text-xs" style={{ borderColor: "var(--border)" }} onClick={() => handleSwitchTab(t.id)}>
                          Switch to
                        </button>
                      )}
                      <button className="rounded-md border px-2 py-0.5 text-xs" style={{ borderColor: "var(--border)" }} onClick={() => setCancelTabId(t.id)}>
                        Cancel tab
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {toast && (
            <div className="notice notice-success p-2.5 text-xs">
              {toast}
            </div>
          )}
          {lastReceipt && devices.printerAddress && (printNote || !devices.autoPrint) && (
            <div className={`notice ${printNote ? "notice-warn" : ""} flex flex-wrap items-center justify-between gap-2 p-2.5 text-xs`}>
              <span>{printNote ?? `Order #${lastReceipt.orderNumber}`}</span>
              <button
                className="chip !px-3 !py-1"
                onClick={async () => {
                  const r = await sendToPrinter(devices.printerAddress, receiptXml(lastReceipt));
                  setPrintNote(r.ok ? null : r.error);
                }}
              >
                {printNote ? "Try printing again" : "Print receipt"}
              </button>
            </div>
          )}

          {cart.length === 0 ? (
            <div className="rounded-lg border border-dashed py-6 text-center text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
              No items yet
            </div>
          ) : (
            cart.map((line) => (
              // One compact row per line (quantity, name, price, remove) so a
              // longer order still fits the iPad without scrolling much.
              <div key={line.key} className="card-flat flex items-center gap-2 px-2 py-1.5">
                <button
                  className="h-9 w-9 shrink-0 rounded-md border text-base"
                  style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
                  onClick={() => updateQty(line.key, -1)}
                  aria-label={`One less ${line.name}`}
                >
                  −
                </button>
                <span className="w-5 shrink-0 text-center text-sm font-bold" style={{ color: "var(--foreground)" }}>
                  {line.qty}
                </span>
                <button
                  className="h-9 w-9 shrink-0 rounded-md border text-base"
                  style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
                  onClick={() => updateQty(line.key, 1)}
                  aria-label={`One more ${line.name}`}
                >
                  +
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium" style={{ color: "var(--foreground)" }}>
                    {line.name}
                  </div>
                  {line.mods.length > 0 && (
                    <div className="truncate text-xs" style={{ color: "var(--muted)" }}>
                      {line.mods.join(", ")}
                    </div>
                  )}
                </div>
                <span className="shrink-0 text-sm" style={{ color: "var(--foreground)" }}>
                  {money(line.unit * line.qty)}
                </span>
                <button
                  className="h-9 w-9 shrink-0 rounded-md text-lg"
                  style={{ color: "var(--danger-text)" }}
                  onClick={() => removeLine(line.key)}
                  aria-label={`Remove ${line.name}`}
                >
                  ×
                </button>
              </div>
            ))
          )}

          <PosMemberPanel member={member} onChange={setMember} employeeId={employeeId} />

          <div className="space-y-1 pt-1">
          <label className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
            <input type="checkbox" checked={monthlyMember} onChange={(e) => setMonthlyMember(e.target.checked)} />
            Monthly member (10% off)
          </label>
          <label className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
            <input type="checkbox" checked={taxFree} onChange={(e) => setTaxFree(e.target.checked)} />
            Tax exempt
          </label>
          {totals.canRedeem && (
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
              <input type="checkbox" checked={pointsRedeemed} onChange={(e) => setPointsRedeemed(e.target.checked)} />
              Redeem {POINTS_PER_REWARD} pts for {money(REWARD_VALUE)} off
            </label>
          )}
          </div>
        </div>

        <div className="shrink-0">
          <div className="mt-3 border-t pt-2.5 text-sm" style={{ borderColor: "var(--border)" }}>
            <div className="flex justify-between" style={{ color: "var(--muted)" }}>
              <span>Subtotal</span>
              <span>{money(totals.subtotal)}</span>
            </div>
            {totals.discount > 0 && (
              <div className="flex justify-between" style={{ color: "var(--muted)" }}>
                <span>Discount</span>
                <span>-{money(totals.discount)}</span>
              </div>
            )}
            <div className="flex justify-between" style={{ color: "var(--muted)" }}>
              <span>Tax</span>
              <span>{money(totals.tax)}</span>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between border-t pt-1.5" style={{ borderColor: "var(--border)" }}>
              <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                Total
              </span>
              <span className="text-2xl font-semibold" style={{ color: "var(--accent)" }}>
                {money(totals.total)}
              </span>
            </div>

          </div>
          <button className="btn-primary mt-3 w-full py-3 text-base" disabled={cart.length === 0 || !employeeId || busy} onClick={startCheckout}>
            Complete order
          </button>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <button
              className="btn-secondary whitespace-nowrap py-2.5 text-sm"
              style={activeTabId ? undefined : { color: "var(--danger-text)" }}
              disabled={(cart.length === 0 && !activeTabId) || busy}
              onClick={() => {
                // Leaving a tab is a routine, non-destructive action (it saves
                // first) -- only skip the confirm step for that case. Clearing
                // a walk-up order with items actually discards them, so that
                // one still asks first.
                if (activeTabId) {
                  setBusy(true);
                  stashCurrentWork()
                    .then(() => {
                      resetOrder();
                      router.refresh();
                    })
                    .finally(() => setBusy(false));
                  return;
                }
                setConfirmState({
                  title: "Clear the current order?",
                  danger: true,
                  confirmLabel: "Clear",
                  onConfirm: () => {
                    setConfirmState(null);
                    resetOrder();
                    router.refresh();
                  },
                });
              }}
            >
              {activeTabId ? "Put away" : "Clear"}
            </button>
            <button className="btn-secondary whitespace-nowrap py-2.5 text-sm" disabled={cart.length === 0 || busy} onClick={handleHold}>
              Hold
            </button>
            <button className="btn-secondary whitespace-nowrap py-2.5 text-sm" disabled={!employeeId || busy} onClick={() => setOpenTabPromptOpen(true)}>
              New tab
            </button>
          </div>
        </div>
      </div>

      {/* Menu panel: category buttons pinned, items scroll. */}
      <div className="card flex flex-col md:min-h-0">
        <div className="mb-3 flex shrink-0 flex-wrap gap-2">
          <button
            className={nav.categoryId === MOVIES_TAB ? "chip chip-selected px-4 py-2 text-sm font-bold" : "chip px-4 py-2 text-sm font-bold"}
            onClick={() => {
              setNav({ categoryId: MOVIES_TAB, subcategoryId: null });
              setBuilderItemId(null);
            }}
          >
            Movies
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={nav.categoryId === c.id ? "chip chip-selected px-4 py-2 text-sm" : "chip px-4 py-2 text-sm"}
              onClick={() => {
                setNav({ categoryId: c.id, subcategoryId: null });
                setBuilderItemId(null);
              }}
            >
              {c.label}
            </button>
          ))}
          <button className="chip px-4 py-2 text-sm" style={{ borderStyle: "dashed" }} onClick={() => setCustomOpen(true)}>
            + Custom item
          </button>
        </div>
        {customOpen && (
          <CustomItemModal
            onCancel={() => setCustomOpen(false)}
            onAdd={(l) => {
              setCart((prev) => [...prev, { key: `${Date.now()}-${Math.random()}`, menuItemId: null, name: l.name, unit: l.unit, qty: 1, mods: [], isAlcohol: l.isAlcohol }]);
              setCustomOpen(false);
            }}
          />
        )}

        {category?.subcategories.length ? (
          <div className="mb-3 flex shrink-0 flex-wrap gap-2 text-sm">
            {!nav.subcategoryId
              ? category.subcategories.map((s) => (
                  <button key={s.id} className="chip" onClick={() => setNav({ categoryId: category.id, subcategoryId: s.id })}>
                    {s.label}
                  </button>
                ))
              : (
                  <button
                    className="chip"
                    onClick={() => {
                      setNav({ categoryId: category.id, subcategoryId: null });
                      setBuilderItemId(null);
                    }}
                  >
                    ← Back
                  </button>
                )}
          </div>
        ) : null}

        <div className="md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain">
        {nav.categoryId === MOVIES_TAB ? (
          <MovieTickets
            initial={initialScreenings}
            inCart={ticketsInCart}
            insidersPlus={member?.tier === "Insiders+"}
            onAdd={(t) => setCart((prev) => [...prev, { key: `${Date.now()}-${Math.random()}`, menuItemId: null, screeningId: t.screeningId, name: t.name, unit: t.unit, qty: t.qty, mods: t.mods, isAlcohol: false }])}
          />
        ) : builderItem ? (
          <ItemBuilder item={builderItem} recipe={recipesByItem[builderItem.id] ?? null} onAdd={addLine} onCancel={() => setBuilderItemId(null)} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {items.map((item) => (
              <button key={item.id} className="card-flat flex min-h-[92px] flex-col items-center justify-center gap-1.5 p-3 text-center" onClick={() => setBuilderItemId(item.id)}>
                <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                  {item.name}
                </span>
                <span className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
                  {money(item.price)}
                </span>
              </button>
            ))}
          </div>
        )}
        </div>
      </div>

      {tipOpen && (
        <TipModal subtotal={totals.subtotal} tabName={activeTab?.order_name ?? "Tab"} onConfirm={continueAfterTip} onCancel={() => setTipOpen(false)} />
      )}

      {ageConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="card w-full max-w-xs text-center shadow-2xl">
            <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
              Age verification
            </h3>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              This order includes alcohol. Confirm you&apos;ve checked ID and the customer is 21 or older.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <button className="btn-secondary" onClick={() => setAgeConfirmOpen(false)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  setAgeConfirmOpen(false);
                  setPayOpen(true);
                }}
              >
                ID checked — 21+
              </button>
            </div>
          </div>
        </div>
      )}

      {payOpen && (
        <PaymentModal total={totals.total + tip} readerId={readerId} tipEligible={activeTabId ? null : totals.total - totals.tax} onConfirm={finalizeCheckout} onCancel={() => setPayOpen(false)} />
      )}

      {cancelTabId && (
        <ManagerPinModal
          description="Manager approval is required to cancel this tab."
          onCancel={() => setCancelTabId(null)}
          onSubmit={handleCancelTab}
        />
      )}

      {openTabPromptOpen && (
        <PromptModal
          title="Name this tab"
          placeholder="Customer name, seat, etc."
          confirmLabel="Open tab"
          onCancel={() => setOpenTabPromptOpen(false)}
          onSubmit={handleOpenTab}
        />
      )}

      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          description={confirmState.description}
          danger={confirmState.danger}
          confirmLabel={confirmState.confirmLabel}
          onCancel={() => setConfirmState(null)}
          onConfirm={confirmState.onConfirm}
        />
      )}
    </div>
  );
}

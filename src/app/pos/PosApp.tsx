"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MenuCategory, Employee, MemberTier, Recipe } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { EMPTY_CART_SNAPSHOT, type RegisterCartSnapshot } from "@/lib/registerChannel";
import ItemBuilder, { type BuiltLine } from "./ItemBuilder";
import PaymentModal from "./PaymentModal";
import TipModal from "./TipModal";
import CustomItemModal from "./CustomItemModal";
import TabCardModal from "./TabCardModal";
import InfoTip from "@/components/help/InfoTip";
import { useOnShift } from "./shift/on-shift-store";
import { publishCashier, useRanOut } from "./shift/ran-out-store";
import { ItemOutDialog, MenuTile, RoundPhoto } from "./shift/RanOut";
import type { RegisterOut } from "@/lib/ops/shared";
import MovieTickets from "./MovieTickets";
import { checkTicketSeats, type RegisterScreening } from "./ticket-actions";
import { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/loyalty";
import { SALES_TAX_RATE } from "@/lib/sales-tax";
import PosMemberPanel from "./PosMemberPanel";
import RegisterCheckins from "./RegisterCheckins";
import type { PosMember } from "./member-actions";
import ManagerPinModal from "@/components/ManagerPinModal";
import { approvalText } from "@/lib/pin-rules";
import PromptModal from "@/components/PromptModal";
import ConfirmModal from "@/components/ConfirmModal";
import { receiptXml, drawerXml, type ReceiptData } from "@/lib/print/receipt";
import { printTickets, type TicketSale } from "./print-tickets";
import { useScanner } from "./useScanner";
import { handleDoorScan } from "./door-print";
import RecentOrders from "./RecentOrders";
import EasterEggs from "./EasterEggs";
import { flourishLines, type FlourishKey } from "@/lib/print/flourishes";
import { sendPrint, usePrintTarget } from "./printing";
import { receiptClaimUrl } from "./receipt-claim";
import DevicesPanel from "./devices/DevicesPanel";
import { useDeviceSettings } from "./devices/settings";
import UnsavedSaleBanner, { keepUnsavedSale, useUnsavedSale, type UnsavedSale } from "./UnsavedSaleBanner";
import { isStaleBuildError } from "@/lib/deployment";
import {
  completeOrder,
  isDraftOpen,
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

// Joplin, MO combined sales tax, shared with online tickets and Insiders+.
const TAX_RATE = SALES_TAX_RATE;

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
  registerTopic,
}: {
  categories: MenuCategory[];
  employees: Employee[];
  heldOrders: DraftOrderSummary[];
  openTabs: DraftOrderSummary[];
  recipesByItem: Record<string, Recipe>;
  defaultReaderId: string | null;
  initialScreenings: RegisterScreening[];
  registerTopic: string;
}) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState<string | null>(categories[0]?.id ?? null);
  const [builderItemId, setBuilderItemId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderName, setOrderName] = useState("");
  // The cashier: whoever picked themselves in the list, else the person
  // using this iPad per the shift bar, else the only person on shift. No
  // more re-picking after every reload.
  const onShift = useOnShift();
  // The cashier follows the shift: this iPad's shift, else whoever started
  // most recently. A cashier picked by hand holds only until someone starts
  // or ends a shift (the pick remembers the shift line-up it was made under).
  const shiftKey = `${onShift.onShift.map((o) => o.shiftId).join(",")}|${onShift.meEmployeeId ?? ""}`;
  const [pickedCashier, setPickedCashier] = useState<{ id: string; shiftKey: string } | null>(null);
  const isEmployee = (id: string | null | undefined): id is string => !!id && employees.some((e) => e.id === id);
  const latestOnShift = [...onShift.onShift].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]?.employeeId ?? null;
  const onShiftIds = new Set(onShift.onShift.map((o) => o.employeeId));
  const employeeId =
    (pickedCashier && pickedCashier.shiftKey === shiftKey && isEmployee(pickedCashier.id) ? pickedCashier.id : "") ||
    (isEmployee(onShift.meEmployeeId) ? onShift.meEmployeeId : "") ||
    (isEmployee(latestOnShift) ? latestOnShift : "");
  // "Ran out" reports from the shift bar are made in the cashier's name.
  useEffect(() => {
    publishCashier(employeeId || null);
  }, [employeeId]);
  // 86'd items: what the shift bar's poll last saw, else what the page
  // loaded with.
  const ranOut = useRanOut();
  const outs = useMemo(() => {
    const m = new Map<string, RegisterOut>();
    if (ranOut.loaded) {
      for (const o of ranOut.outs) m.set(o.itemId, o);
      return m;
    }
    const walk = (cs: MenuCategory[]) => {
      for (const c of cs) {
        for (const i of c.items) {
          if (i.out_since) m.set(i.id, { itemId: i.id, reason: i.out_note || "Out", since: i.out_since, outageId: i.out_outage_id ?? null, what: null });
        }
        walk(c.subcategories);
      }
    };
    walk(categories);
    return m;
  }, [ranOut, categories]);
  const [outPromptId, setOutPromptId] = useState<string | null>(null);
  const [member, setMember] = useState<PosMember | null>(null);
  const memberId = member?.id ?? null;
  const [taxFree, setTaxFree] = useState(false);
  const [monthlyMember, setMonthlyMember] = useState(false);
  const [pointsRedeemed, setPointsRedeemed] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // The tab whose last save failed; its warning shows while it's on screen.
  const [tabSaveIssue, setTabSaveIssue] = useState<{ tabId: string; stale: boolean } | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [ageConfirmOpen, setAgeConfirmOpen] = useState(false);
  const [tip, setTip] = useState(0);
  const [heldListOpen, setHeldListOpen] = useState(false);
  // ✨ Easter eggs: a surprise for the bottom of the next printed receipt.
  const [flourish, setFlourish] = useState<FlourishKey | null>(null);
  const flourishRef = useRef<FlourishKey | null>(null);
  useEffect(() => {
    flourishRef.current = flourish;
  }, [flourish]);
  const [tabsListOpen, setTabsListOpen] = useState(false);
  const [cancelTabId, setCancelTabId] = useState<string | null>(null);
  const [openTabPromptOpen, setOpenTabPromptOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<{ title: string; description?: string; danger?: boolean; confirmLabel?: string; onConfirm: () => void } | null>(
    null
  );
  const [toast, setToast] = useState<string | null>(null);
  const devices = useDeviceSettings();
  // Where this register prints: its station's printer through the website,
  // or straight to a printer IP (Devices).
  const printTarget = usePrintTarget();
  const readerId = devices.readerId || defaultReaderId;
  // A scanner at the counter: an online ticket's QR prints its tickets right
  // away (one print per ticket, ever); a member card checks them in. An empty
  // register also picks up the scanned member so the order goes on their
  // account. Paused while the pay screen is open.
  const scanStateRef = useRef({ member, empty: true });
  useEffect(() => {
    scanStateRef.current = { member, empty: cart.length === 0 && !activeTabId };
  }, [member, cart.length, activeTabId]);
  useScanner(
    (text) => {
      void handleDoorScan(text, printTarget).then(({ scan, message }) => {
        const now = scanStateRef.current;
        if (scan?.ok && scan.member && !now.member && now.empty) setMember(scan.member);
        setToast(message);
        setTimeout(() => setToast((t) => (t === message ? null : t)), 8000);
      });
    },
    { enabled: !payOpen },
  );
  // The most recent sale's receipt, kept for "Print receipt" / "Reprint".
  const [lastReceipt, setLastReceipt] = useState<ReceiptData | null>(null);
  const [printNote, setPrintNote] = useState<string | null>(null);
  // The last sale's movie tickets, kept for "Reprint last tickets".
  const [lastTickets, setLastTickets] = useState<{ orderNumber: number; lines: TicketSale[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const category = useMemo(() => categories.find((c) => c.id === categoryId) ?? null, [categories, categoryId]);
  const ticketsInCart = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of cart) if (l.screeningId) m.set(l.screeningId, (m.get(l.screeningId) ?? 0) + l.qty);
    return m;
  }, [cart]);
  // Everything in the category on one screen: its own items, then each
  // subcategory (Beer, Wine, ...) under a heading -- no extra tap to drill in.
  const menuSections = useMemo(
    () => [
      { id: "top", label: null as string | null, image: null as string | null, items: category?.items ?? [] },
      ...(category?.subcategories ?? []).map((s) => ({ id: s.id, label: s.label as string | null, image: s.image_url ?? null, items: s.items })),
    ].filter((s) => s.items.length > 0),
    [category],
  );
  // Photo buttons are taller, so a category with any photos gets one more
  // column on a landscape iPad to keep as many buttons on screen.
  const menuHasPhotos = menuSections.some((s) => s.items.some((i) => i.image_url));
  const findItem = useMemo(() => {
    const byId = new Map<string, MenuCategory["items"][number]>();
    for (const c of categories) {
      for (const i of c.items) byId.set(i.id, i);
      for (const s of c.subcategories) for (const i of s.items) byId.set(i.id, i);
    }
    return (id: string | null) => (id ? (byId.get(id) ?? null) : null);
  }, [categories]);
  const builderItem = findItem(builderItemId);
  const outPromptItem = findItem(outPromptId);
  const outPrompt = outPromptItem ? (outs.get(outPromptItem.id) ?? null) : null;

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
      station: devices.station,
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
      saveTab(id, fields, payload).then((ok) => {
        if (ok) router.refresh();
      });
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, cart, orderName, taxFree, monthlyMember, pointsRedeemed, memberId]);

  // Which tab is on screen right now, for a save that answers after the
  // screen has moved on.
  const activeTabRef = useRef<string | null>(null);
  useEffect(() => {
    activeTabRef.current = activeTabId;
  }, [activeTabId]);

  // Saves a tab. A failed save used to go unnoticed, so the tab quietly
  // lost what was added; now it shows "Tab not saved" until a save works,
  // and false tells the caller not to move on from the tab.
  // leaving: the tab is being put away, so anything new for the kitchen
  // prints now instead of after a pause for more to be rung.
  async function saveTab(id: string, fields: DraftFields, payload: CheckoutTotals, leaving = false): Promise<boolean> {
    let r: Awaited<ReturnType<typeof updateDraftOrder>>;
    let stale = false;
    try {
      r = await updateDraftOrder(id, fields, payload, { kitchen: leaving ? "now" : "hold" });
    } catch (e) {
      // A dropped connection, or the site was updated mid-shift.
      r = { ok: false, error: "Couldn't reach the server." };
      stale = isStaleBuildError(e);
    }
    if (r.ok || r.closed) setTabSaveIssue((cur) => (cur?.tabId === id ? null : cur));
    if (r.ok) return true;
    if (r.closed) {
      // Paid or cancelled on another register: no save will ever work, so
      // don't strand staff on it (or leave its items up to be charged twice).
      if (activeTabRef.current === id) {
        resetOrder();
        setToast("That tab was already closed on another register, so it's been cleared from here. Ring anything new as a new order.");
      }
      return false;
    }
    setTabSaveIssue({ tabId: id, stale });
    return false;
  }

  // The open tab, saved from the screen before the screen moves on. True
  // when there's no tab or it saved.
  async function saveOpenTab(): Promise<boolean> {
    return !activeTabId || saveTab(activeTabId, currentFields(), totalsPayload(totals), true);
  }

  function retryTabSave() {
    // An out-of-date page can't save anything; only a reload helps.
    if (tabSaveIssue?.stale) return window.location.reload();
    saveOpenTab().then((ok) => {
      if (ok) router.refresh();
    });
  }

  // Mirrors the cart onto the customer-facing kiosk display in real time,
  // via Realtime broadcast rather than a database row -- entirely separate
  // from the draft/tab persistence above, so this can't affect payment or
  // order-history logic. cartSnapshotRef always holds the latest snapshot
  // (updated every render, read from both the debounced broadcast-on-change
  // effect below and the request-state handler in the subscribe effect),
  // which avoids a stale closure in the long-lived channel subscription.
  const cartSnapshotRef = useRef<RegisterCartSnapshot>(EMPTY_CART_SNAPSHOT);
  const finalizingRef = useRef(false);
  // A card sale that was charged but didn't save (kept across reloads).
  const unsavedSale = useUnsavedSale();
  // "Put a card on file?" for a tab (right after opening it, or from its chip).
  const [tabCardFor, setTabCardFor] = useState<{ id: string; name: string } | null>(null);
  cartSnapshotRef.current = {
    orderName,
    items: cart.map((l) => ({ name: l.name, quantity: l.qty, modifiers: l.mods, lineTotal: Math.round(l.unit * l.qty * 100) / 100 })),
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
    // The customer screen's live tally: savings, whose order it is, and the
    // points it earns (1 per $1 of the subtotal, as completeOrder pays).
    discounts: [
      { label: "Member discount", amount: totals.tierDiscount },
      { label: "Monthly member discount", amount: totals.monthlyDiscount },
      { label: "Points reward", amount: totals.redemptionDiscount },
    ].filter((d) => d.amount > 0),
    member: member ? { firstName: member.name.trim().split(/\s+/)[0] || member.name, points: Math.round(member.points), plus: member.tier === "Insiders+" } : null,
    pointsToEarn: Math.max(0, Math.round(totals.subtotal)),
  };
  const registerChannelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(registerTopic);
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
  }, [registerTopic]);

  useEffect(() => {
    const timer = setTimeout(() => {
      registerChannelRef.current?.send({ type: "broadcast", event: "cart", payload: cartSnapshotRef.current });
    }, 250);
    return () => clearTimeout(timer);
  }, [cart, orderName, totals.subtotal, totals.tax, totals.total, totals.discount, member]);

  function resetOrder() {
    setCart([]);
    setOrderName("");
    setMember(null);
    setTaxFree(false);
    setMonthlyMember(false);
    setPointsRedeemed(false);
    setActiveTabId(null);
  }

  // False (with nothing moved) if what's on screen couldn't be saved.
  async function stashCurrentWork(): Promise<boolean> {
    if (activeTabId) return saveOpenTab();
    if (cart.length > 0) {
      // Auto-hold rather than asking -- never silently lose an in-progress
      // order; it'll sit in the held list for the cashier to clean up.
      const fields = currentFields();
      fields.orderName = fields.orderName || `Held ${new Date().toLocaleTimeString()}`;
      try {
        await saveDraftOrder("held", fields, totalsPayload(totals));
      } catch {
        setToast("Couldn't hold the order on screen, so nothing moved. Try again.");
        return false;
      }
    }
    return true;
  }

  // Leaving a tab: save it, then clear the screen. If the save fails the tab
  // stays up (with its warning) instead of dropping what didn't save.
  async function putAwayTab() {
    setBusy(true);
    try {
      if (!(await saveOpenTab())) return;
      resetOrder();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleHold() {
    // A tab is already saved as a tab, so Hold just puts it away. A held
    // copy put the same drinks on two checks, to be charged twice.
    if (activeTabId) return putAwayTab();
    if (cart.length === 0) return;
    setBusy(true);
    try {
      const fields = currentFields();
      fields.orderName = fields.orderName || `Held ${new Date().toLocaleTimeString()}`;
      await saveDraftOrder("held", fields, totalsPayload(totals));
      resetOrder();
      router.refresh();
    } catch {
      setToast("Couldn't hold the order. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function doResumeHeld(id: string) {
    setBusy(true);
    try {
      const full = await loadDraftOrder(id).catch(() => null);
      if (!full) return setToast("That held order isn't there anymore. It may have been opened on another register.");
      // An open tab is saved and put away first. Left open, its autosave
      // wrote the held order's items over the tab.
      if (!(await saveOpenTab())) return;
      setActiveTabId(null);
      loadFields(id, full);
      await discardDraftOrder(id);
      setHeldListOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function handleResumeHeld(id: string) {
    // An open tab isn't replaced (it's saved and put away), so only a
    // walk-up order needs the warning.
    if (cart.length > 0 && !activeTabId) {
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
      // A walk-up order on screen becomes the new tab, so the drinks just
      // rung start the tab (they used to be sent to Held). Another tab on
      // screen keeps its own items: it's saved and the new tab starts empty.
      const fromScreen = !activeTabId;
      if (!fromScreen && !(await saveOpenTab())) return;
      const id = fromScreen
        ? await saveDraftOrder("tab", { ...currentFields(), orderName: name }, totalsPayload(totals))
        : await saveDraftOrder("tab", { employeeId, memberId: null, orderName: name, taxFree: false, monthlyMember: false, pointsRedeemed: false, lines: [] });
      if (!fromScreen) resetOrder();
      setActiveTabId(id);
      setOrderName(name);
      setTabCardFor({ id, name });
      router.refresh();
    } catch {
      setToast("Couldn't open the tab. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSwitchTab(id: string) {
    setBusy(true);
    try {
      // Load it first: if it was closed on another register, nothing on
      // screen has been moved yet.
      const full = await loadDraftOrder(id).catch(() => null);
      if (!full) return setToast("That tab isn't open anymore. It may have been closed on another register.");
      if (!(await stashCurrentWork())) return;
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
    const r = await cancelTab(cancelTabId, pin);
    if (!r.ok) throw new Error(r.error); // shown in the PIN box
    if (activeTabId === cancelTabId) resetOrder();
    setCancelTabId(null);
    setToast(`Tab cancelled. ${approvalText(r)}`);
    setTimeout(() => setToast(null), 7000);
    router.refresh();
  }

  async function startCheckout() {
    if (!employeeId || cart.length === 0) return;
    // A tab closed on the other register (paid or cancelled) would be
    // charged a second time from here: check before anyone pays.
    if (activeTabId) {
      setBusy(true);
      const open = await isDraftOpen(activeTabId).catch(() => null);
      setBusy(false);
      if (open === null) return setToast("Couldn't check the tab. Check the connection and try again.");
      if (!open) {
        resetOrder();
        router.refresh();
        return setToast("That tab was already closed on another register, so it's been cleared from here. Check Recent orders before charging anything.");
      }
    }
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
    // A tab closed with a tap on the reader gets the reader's own tip screen,
    // like any card sale. Only a register with no reader still asks here.
    if (activeTabId && !readerId) {
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
    if (!printTarget) return;
    const openDrawer = tookCash && devices.drawerOnCash;
    if (devices.autoPrint || openDrawer) {
      // The ✨ surprise rides on this receipt, then turns off.
      const surprise = devices.autoPrint ? flourishLines(flourishRef.current) : null;
      if (surprise) setFlourish(null);
      // A member with no website login gets a "claim your account" QR code.
      const claimUrl = devices.autoPrint ? await receiptClaimUrl(member, receipt) : null;
      const r = devices.autoPrint
        ? await sendPrint(printTarget, "receipt", receiptXml(receipt, { openDrawer, flourish: surprise, claimUrl }), `Receipt #${receipt.orderNumber}`)
        : await sendPrint(printTarget, "drawer", drawerXml(), `Drawer (#${receipt.orderNumber})`);
      if (!r.ok) return setPrintNote(r.error);
    }
    if (devices.printTickets && tickets.length) {
      const t = await printTickets(printTarget, receipt.orderNumber, tickets);
      if (!t.ok) setPrintNote(`Tickets didn't print: ${t.error}`);
    }
  }

  async function finalizeCheckout(payment: CheckoutPayment, note?: string) {
    // A double tap (or a second "paid" answer from the reader) must not save
    // or print the sale twice.
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    setPayOpen(false);
    setBusy(true);
    // A tab's tip is asked on the register (TipModal); any other card sale
    // can get one on the reader. Either way it's one tip on the order.
    const allTip = tip + (payment.tip ?? 0);
    try {
      const saved = await saveSale(
        {
          order: {
            ...currentFields(),
            totals: totalsPayload(totals),
            payment,
            ageVerified: cart.some((l) => l.isAlcohol),
            tip: allTip,
            draftOrderId: activeTabId,
          },
          memberName: member?.name ?? null,
          tries: 0,
        },
        note,
      );
      // A charged card that didn't save is cleared too: the sale now lives in
      // the "card WAS charged" banner, so its items can't be charged again,
      // held, or moved onto a tab.
      if (saved || payment.stripePaymentIntentId) {
        resetOrder();
        setTip(0);
      }
    } finally {
      finalizingRef.current = false;
      setBusy(false);
    }
  }

  // Saves a paid sale, then prints and shows the receipt note. Also what
  // Retry saving runs, with the very same sale, after a card was charged but
  // the save failed. True if it saved.
  async function saveSale(sale: UnsavedSale, note?: string): Promise<boolean> {
    const { order } = sale;
    const { payment } = order;
    const allTip = order.tip ?? 0;
    const change = payment.tendered ? Math.round((payment.tendered - payment.cash) * 100) / 100 : 0;
    let orderNumber: number;
    try {
      ({ orderNumber } = await completeOrder(order));
    } catch (e) {
      const stale = isStaleBuildError(e);
      if (payment.stripePaymentIntentId) {
        // The card is already charged. Keep this exact payment for Retry
        // saving (one order per payment, so a retry can't make a second
        // sale) and hold off new charges until it's saved. A small toast here
        // used to let the register go back to charging the card again.
        keepUnsavedSale({ ...sale, tries: sale.tries + 1, stale });
      } else if (stale) {
        setToast("The register was just updated and this sale didn't save. Reload the page, then ring it up again.");
      } else {
        setToast(e instanceof Error ? `Checkout failed: ${e.message}` : "Checkout failed");
      }
      return false;
    }
    keepUnsavedSale(null);
    const receipt: ReceiptData = {
      orderNumber,
      at: new Date().toISOString(),
      cashier: employees.find((e) => e.id === order.employeeId)?.name ?? null,
      member: sale.memberName,
      orderName: order.orderName.trim() || null,
      lines: order.lines.map((l) => ({ name: l.name, qty: l.quantity, unit: l.unit_price, mods: l.modifiers })),
      subtotal: order.totals.subtotal,
      discounts: [
        { label: "Member discount", amount: order.totals.tier_discount },
        { label: "Monthly member discount", amount: order.totals.monthly_discount },
        { label: "Points reward", amount: order.totals.redemption_discount },
      ],
      tax: order.totals.tax,
      tip: allTip,
      total: order.totals.total + allTip,
      payments: [
        { label: "Voucher", amount: payment.voucher ?? 0 },
        { label: "Cash", amount: payment.cash },
        { label: "Card", amount: payment.card },
        ...(change > 0 ? [{ label: "Cash given", amount: payment.tendered ?? 0 }, { label: "Change", amount: change }] : []),
      ],
    };
    setLastReceipt(receipt);
    const tickets: TicketSale[] = order.lines.filter((l) => l.screening_id).map((l) => ({ screeningId: l.screening_id as string, qty: l.quantity }));
    setLastTickets(tickets.length ? { orderNumber, lines: tickets } : null);
    void printAfterSale(receipt, payment.cash > 0, tickets);
    const parts = [`Order #${orderNumber} complete — ${money(order.totals.total + allTip)} charged (${payment.method})`];
    if (allTip > 0) parts.push(`${money(allTip)} tip`);
    if (payment.voucher && payment.method !== "voucher") parts.push(`${money(payment.voucher)} in vouchers`);
    if (change > 0) parts.push(`give ${money(change)} change`);
    setToast(note ? `${note} ${parts.join(" — ")}` : parts.join(" — "));
    router.refresh();
    setTimeout(() => setToast(null), note ? 15000 : 7000);
    return true;
  }

  async function retryUnsavedSale() {
    if (!unsavedSale || finalizingRef.current) return;
    finalizingRef.current = true;
    setBusy(true);
    try {
      const { draftOrderId } = unsavedSale.order;
      // If that tab was opened again meanwhile, it's closed now: take it off
      // the screen so it can't be charged a second time.
      if ((await saveSale(unsavedSale)) && draftOrderId && draftOrderId === activeTabId) resetOrder();
    } finally {
      finalizingRef.current = false;
      setBusy(false);
    }
  }

  // The way out if a save can never work (say, the tab was cancelled
  // elsewhere), so one stuck sale can't keep the register from charging.
  function stopTryingUnsavedSale() {
    const onTab = !!unsavedSale?.order.draftOrderId;
    setConfirmState({
      title: "Stop trying to save this sale?",
      description: `The card stays charged, but the sale won't be in Reports.${onTab ? " Its tab may still be open: have a manager cancel it, don't charge it again." : ""} Only do this if a manager says so.`,
      danger: true,
      confirmLabel: "Stop trying",
      onConfirm: () => {
        setConfirmState(null);
        keepUnsavedSale(null);
      },
    });
  }

  return (
    <div className="grid gap-3 md:min-h-0 md:flex-1 md:grid-cols-[370px_1fr] lg:grid-cols-[440px_1fr]">
      {/* Cart panel. On a tablet the page is locked to the screen: the header
          and the checkout block stay put, and only the middle (the order
          itself) scrolls -- so the header and footer are kept to two rows each. */}
      <div className="card flex flex-col !p-3 md:min-h-0">
        <div className="shrink-0">
          <div className="mb-2 flex items-center gap-2">
            <select className="input min-w-0 flex-1 !py-2" aria-label="Cashier" value={employeeId} onChange={(e) => setPickedCashier({ id: e.target.value, shiftKey })}>
              <option value="">Choose cashier</option>
              {onShiftIds.size > 0 ? (
                <>
                  <optgroup label="On shift">
                    {employees
                      .filter((e) => onShiftIds.has(e.id))
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Everyone else">
                    {employees
                      .filter((e) => !onShiftIds.has(e.id))
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                  </optgroup>
                </>
              ) : (
                employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))
              )}
            </select>
            <button className={`chip shrink-0 whitespace-nowrap !px-3 !py-1.5 text-sm ${heldListOpen ? "chip-selected" : ""}`} onClick={() => setHeldListOpen((v) => !v)}>
              Held {heldOrders.length}
            </button>
            <button className={`chip shrink-0 whitespace-nowrap !px-3 !py-1.5 text-sm ${tabsListOpen ? "chip-selected" : ""}`} onClick={() => setTabsListOpen((v) => !v)}>
              Tabs {openTabs.length}
            </button>
            <DevicesPanel
              fallbackReaderId={defaultReaderId}
              onReprintTickets={lastTickets && printTarget ? () => printTickets(printTarget, lastTickets.orderNumber, lastTickets.lines) : null}
              onReprint={lastReceipt && printTarget ? () => sendPrint(printTarget, "receipt", receiptXml(lastReceipt), `Receipt #${lastReceipt.orderNumber} (again)`) : null}
            />
          </div>

          <div className="mb-2 flex items-center gap-2">
            {activeTab && (
              <span className="chip chip-selected max-w-[40%] shrink-0 truncate !px-3 !py-1.5 text-sm font-bold">
                Tab: {activeTab.order_name}
              </span>
            )}
            {activeTab &&
              (activeTab.card_label ? (
                <span className="chip shrink-0 whitespace-nowrap !px-2.5 !py-1.5 text-xs" title="Card on file for this tab">
                  💳 {activeTab.card_label}
                </span>
              ) : (
                <button className="chip shrink-0 whitespace-nowrap !px-2.5 !py-1.5 text-xs" onClick={() => setTabCardFor({ id: activeTab.id, name: activeTab.order_name ?? "Tab" })}>
                  + Card
                </button>
              ))}
            {activeTab && <InfoTip topic="tab-card-on-file" className="!mx-0" />}
            <input className="input min-w-0 flex-1 !py-2" placeholder="Order / guest name" value={orderName} onChange={(e) => setOrderName(e.target.value)} />
          </div>
          {tabSaveIssue && tabSaveIssue.tabId === activeTabId && (
            <button className="notice notice-warn mb-2 w-full p-2 text-left text-xs font-semibold" onClick={retryTabSave}>
              {tabSaveIssue.stale ? "Tab not saved: the register was just updated. Tap to reload, then check this tab." : "Tab not saved. Tap to retry."}
            </button>
          )}
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
                      {t.order_name} — {money(t.total)} ({t.item_count} item{t.item_count === 1 ? "" : "s"}){t.card_label ? ` · 💳 ${t.card_label}` : ""}
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
          {lastReceipt && printTarget && (printNote || !devices.autoPrint) && (
            <div className={`notice ${printNote ? "notice-warn" : ""} flex flex-wrap items-center justify-between gap-2 p-2.5 text-xs`}>
              <span>{printNote ?? `Order #${lastReceipt.orderNumber}`}</span>
              <button
                className="chip !px-3 !py-1"
                onClick={async () => {
                  const r = await sendPrint(printTarget, "receipt", receiptXml(lastReceipt), `Receipt #${lastReceipt.orderNumber}`);
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

          <PosMemberPanel
            member={member}
            onChange={setMember}
            employeeId={employeeId}
            onRewardLine={(label) => setCart((prev) => [...prev, { key: `${Date.now()}-${Math.random()}`, menuItemId: null, name: label, unit: 0, qty: 1, mods: [], isAlcohol: false }])}
          />
          <RegisterCheckins registerTopic={registerTopic} member={member} onAttach={setMember} hasOrder={cart.length > 0 || !!activeTabId} lastSale={lastReceipt} />

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
          {unsavedSale && <UnsavedSaleBanner sale={unsavedSale} busy={busy} onRetry={retryUnsavedSale} onStop={stopTryingUnsavedSale} />}
          <div className="mt-2 flex items-end justify-between gap-3 border-t pt-2" style={{ borderColor: "var(--border)" }}>
            <div className="text-xs leading-5 tabular-nums" style={{ color: "var(--muted)" }}>
              <div>Subtotal {money(totals.subtotal)}</div>
              {totals.discount > 0 && <div>Discount -{money(totals.discount)}</div>}
              <div>Tax {money(totals.tax)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                Total · {itemCount} item{itemCount === 1 ? "" : "s"}
              </div>
              <div className="text-2xl font-semibold leading-tight tabular-nums" style={{ color: "var(--accent)" }}>
                {money(totals.total)}
              </div>
            </div>
          </div>
          {/* No new charges while a charged sale is unsaved: if sales aren't
              saving, the register shouldn't keep charging cards. */}
          <button className="btn-primary mt-2 w-full py-3 text-base" disabled={cart.length === 0 || !employeeId || busy || !!unsavedSale} onClick={startCheckout}>
            Complete order
          </button>
          {!employeeId && cart.length > 0 && (
            <p className="mt-1 text-center text-xs" style={{ color: "var(--danger-text)" }}>
              Start your shift (or choose a cashier above) to ring this up.
            </p>
          )}
          <div className="mt-2 grid grid-cols-4 gap-2">
            <button
              className="btn-secondary whitespace-nowrap py-2 text-sm"
              style={activeTabId ? undefined : { color: "var(--danger-text)" }}
              disabled={(cart.length === 0 && !activeTabId) || busy}
              onClick={() => {
                // Leaving a tab is a routine, non-destructive action (it saves
                // first) -- only skip the confirm step for that case. Clearing
                // a walk-up order with items actually discards them, so that
                // one still asks first.
                if (activeTabId) {
                  void putAwayTab();
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
            <button className="btn-secondary whitespace-nowrap py-2 text-sm" disabled={cart.length === 0 || busy} onClick={handleHold}>
              Hold
            </button>
            <button className="btn-secondary whitespace-nowrap py-2 text-sm" disabled={!employeeId || busy} onClick={() => setOpenTabPromptOpen(true)}>
              New tab
            </button>
            <RecentOrders target={printTarget} />
            <EasterEggs
              next={flourish}
              onPick={setFlourish}
              canPrint={!!printTarget && devices.autoPrint}
              onCelebrate={() => registerChannelRef.current?.send({ type: "broadcast", event: "celebrate", payload: {} })}
            />
          </div>
        </div>
      </div>

      {/* Menu panel: category buttons pinned, items scroll. */}
      <div className="card flex flex-col !p-3 md:min-h-0">
        {/* Category buttons share the row evenly, big enough to hit fast. */}
        <div className="mb-3 flex shrink-0 flex-wrap gap-2">
          <button
            className={`chip min-w-[5.5rem] flex-1 !px-3 !py-2.5 !text-base font-bold ${categoryId === MOVIES_TAB ? "chip-selected" : ""}`}
            onClick={() => {
              setCategoryId(MOVIES_TAB);
              setBuilderItemId(null);
            }}
          >
            Movies
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`chip flex min-w-[5.5rem] flex-1 items-center justify-center gap-2 !px-3 !py-2.5 !text-base ${categoryId === c.id ? "chip-selected" : ""}`}
              onClick={() => {
                setCategoryId(c.id);
                setBuilderItemId(null);
              }}
            >
              {c.image_url && <RoundPhoto url={c.image_url} size={28} className="-my-1 -ml-1" />}
              {c.label}
            </button>
          ))}
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

        <div className="md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain">
        {categoryId === MOVIES_TAB ? (
          <MovieTickets
            initial={initialScreenings}
            inCart={ticketsInCart}
            insidersPlus={member?.tier === "Insiders+"}
            onAdd={(t) => setCart((prev) => [...prev, { key: `${Date.now()}-${Math.random()}`, menuItemId: null, screeningId: t.screeningId, name: t.name, unit: t.unit, qty: t.qty, mods: t.mods, isAlcohol: false }])}
          />
        ) : builderItem ? (
          <ItemBuilder item={builderItem} recipe={recipesByItem[builderItem.id] ?? null} onAdd={addLine} onCancel={() => setBuilderItemId(null)} />
        ) : (
          <div className="space-y-4">
            {menuSections.map((section, i) => (
              <section key={section.id}>
                {section.label && (
                  <div className="eyebrow mb-2 flex items-center gap-2">
                    {section.image && <RoundPhoto url={section.image} size={22} />}
                    {section.label}
                  </div>
                )}
                <div className={`grid grid-cols-2 gap-2.5 sm:grid-cols-3 ${menuHasPhotos ? "lg:grid-cols-4" : "xl:grid-cols-4"}`}>
                  {section.items.map((item) => {
                    const out = outs.get(item.id) ?? null;
                    return (
                      <MenuTile
                        key={item.id}
                        name={item.name}
                        price={money(item.price)}
                        imageUrl={item.image_url}
                        out={out}
                        // An 86'd item asks first: sell anyway, or it's back.
                        onClick={() => (out ? setOutPromptId(item.id) : setBuilderItemId(item.id))}
                      />
                    );
                  })}
                  {/* Anything the menu can't describe; each use files a dev note. */}
                  {i === menuSections.length - 1 && (
                    <button className="card-flat flex min-h-[84px] items-center justify-center p-3 text-center text-sm" style={{ borderStyle: "dashed", color: "var(--muted)" }} onClick={() => setCustomOpen(true)}>
                      + Custom item
                    </button>
                  )}
                </div>
              </section>
            ))}
            {menuSections.length === 0 && (
              <button className="card-flat flex min-h-[84px] w-40 items-center justify-center p-3 text-sm" style={{ borderStyle: "dashed", color: "var(--muted)" }} onClick={() => setCustomOpen(true)}>
                + Custom item
              </button>
            )}
          </div>
        )}
        </div>
      </div>

      {outPromptItem && outPrompt && (
        <ItemOutDialog
          item={{ id: outPromptItem.id, name: outPromptItem.name }}
          out={outPrompt}
          outs={[...outs.values()]}
          employeeId={employeeId || null}
          onSell={() => {
            setOutPromptId(null);
            setBuilderItemId(outPromptItem.id);
          }}
          onClose={() => setOutPromptId(null)}
        />
      )}

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
        <PaymentModal
          total={totals.total + tip}
          readerId={readerId}
          tipEligible={tip > 0 ? null : totals.total - totals.tax}
          tabCard={activeTab?.card_label ? { tabId: activeTab.id, label: activeTab.card_label } : null}
          tabName={activeTab?.order_name ?? "Tab"}
          onConfirm={finalizeCheckout}
          onCancel={() => setPayOpen(false)}
        />
      )}

      {cancelTabId && (
        <ManagerPinModal
          description="Manager approval is required to cancel this tab."
          onCancel={() => setCancelTabId(null)}
          onSubmit={handleCancelTab}
        />
      )}

      {tabCardFor && (
        <TabCardModal
          tabId={tabCardFor.id}
          tabName={tabCardFor.name}
          readerId={readerId}
          onSaved={() => router.refresh()}
          onClose={() => {
            setTabCardFor(null);
            router.refresh();
          }}
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

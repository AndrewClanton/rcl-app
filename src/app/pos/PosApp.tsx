"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MenuCategory, Employee, Recipe } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import {
  EMPTY_CART_SNAPSHOT,
  TABLET_SOUND_DEFAULT,
  type MemberOff,
  type RegisterCartSnapshot,
  type RickrollState,
  type TabletProfile,
  type TabletSound,
} from "@/lib/registerChannel";
import { TabletSetupContext, type TabletSetupLink } from "./tablet-setup";
import ItemBuilder, { type BuiltLine } from "./ItemBuilder";
import PaymentModal from "./PaymentModal";
import TipModal from "./TipModal";
import CustomItemModal from "./CustomItemModal";
import TabCardModal from "./TabCardModal";
import InfoTip from "@/components/help/InfoTip";
import { useOnShift } from "./shift/on-shift-store";
import { publishCashier, useRanOut } from "./shift/ran-out-store";
import { ItemOutDialog } from "./shift/RanOut";
import MenuTile from "@/components/menu/MenuTile";
import CategoryIcon from "@/components/menu/CategoryIcon";
import { useMenuTileExtras } from "./item-settings/ItemSettings";
import type { RegisterOut } from "@/lib/ops/shared";
import MovieTickets from "./MovieTickets";
import { checkTicketSeats, type RegisterScreening } from "./ticket-actions";
import { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/loyalty";
import PosMemberPanel from "./PosMemberPanel";
import { UnlimitedBanner } from "./LegacyPlusCard";
import { PlusRibbon, SignalFrame } from "./MemberSignal";
import { memberSignal, memberStanding, publishMemberSignal } from "./member-signal";
import { firstName as firstNameFor, shortName } from "@/lib/card-match";
import { CheckinArrivals, useRegisterCheckins } from "./RegisterCheckins";
import CustomersTab from "./CustomersTab";
import type { PosMember } from "./member-actions";
import DevNoteDialog, { NoteIcon, type NoteAbout } from "@/components/dev-notes/DevNoteDialog";
import ManagerPinModal from "@/components/ManagerPinModal";
import { SALES_TAX_PERCENT } from "@/lib/sales-tax";
import { approvalText } from "@/lib/pin-rules";
import PromptModal from "@/components/PromptModal";
import ConfirmModal from "@/components/ConfirmModal";
import { receiptXml, drawerXml, type ReceiptData } from "@/lib/print/receipt";
import { printTickets, type TicketSale } from "./print-tickets";
import { useScanner } from "./useScanner";
import { handleDoorScan } from "./door-print";
import RecentOrders from "./RecentOrders";
import EasterEggs, { useRickroll } from "./EasterEggs";
import { flourishLines, type FlourishKey } from "@/lib/print/flourishes";
import { sendPrint, usePrintTarget } from "./printing";
import { receiptClaimUrl } from "./receipt-claim";
import DevicesPanel from "./devices/DevicesPanel";
import { BoothsButton, StaffButton } from "./shift/StaffButton";
import { useDeviceSettings } from "./devices/settings";
import UnsavedSaleBanner, {
  clearPendingReaderSale,
  currentUnsavedSale,
  keepPendingReaderSale,
  keepUnsavedSale,
  readPendingReaderSales,
  useUnsavedSale,
  type UnsavedSale,
} from "./UnsavedSaleBanner";
import { pickCashier, useCashierPick } from "./cashier-pick";
import { checkReaderPayment, cancelReaderPayment } from "./terminal-actions";
import CardNoticeBanner from "./CardNotice";
import type { CardNotice } from "@/lib/card-match";
import { isStaleBuildError } from "@/lib/deployment";
import { cents, dailyPerkPick, ENFORCE_REGISTER_TOTALS, memberDiscountRate, pointsEarned, registerTotals } from "@/lib/register-totals";
import { DAILY_COFFEE_LINE, DAILY_COFFEE_TITLE, type DailyCoffeeState } from "@/lib/daily-perk";
import { getDailyCoffee, getTabletProfile } from "./member-actions";
import {
  checkBeforePayment,
  completeOrder,
  isDraftOpen,
  logAbandonedSale,
  savedOrderForPayment,
  saveDraftOrder,
  updateDraftOrder,
  loadDraftOrder,
  discardDraftOrder,
  cancelTab,
  approveTaxExempt,
  type CheckoutPayment,
  type CheckoutTotals,
  type CompleteOrderInput,
  type DraftOrderSummary,
  type DraftFields,
} from "./actions";

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

// The Movies tab sits alongside the menu categories, and so does Customers
// (who's checked in today, find by face).
const MOVIES_TAB = "__movies";
const CUSTOMERS_TAB = "__customers";

// A person, drawn like the category icons (CategoryIcon).
function CustomersIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}

// A dev note from the register is about the register, or about the
// customer screen beside it (which has no button of its own: it faces the
// customer).
const NOTE_ABOUT: NoteAbout[] = [
  { label: "This register", path: "/pos", title: "Register" },
  { label: "Customer screen", path: "/display/customer", title: "Customer screen" },
];

// Draft rows (held orders + tabs) persist the same shape the cart displays,
// so the held/tabs lists never drift from what's actually on the check.
// The math itself is registerTotals (lib/register-totals.ts), the very one
// the server redoes to check each sale.
function totalsPayload(t: ReturnType<typeof registerTotals>): CheckoutTotals {
  return {
    subtotal: t.subtotal,
    daily_perk_discount: t.dailyPerkDiscount,
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
  canNote,
}: {
  categories: MenuCategory[];
  employees: Employee[];
  heldOrders: DraftOrderSummary[];
  openTabs: DraftOrderSummary[];
  recipesByItem: Record<string, Recipe>;
  defaultReaderId: string | null;
  initialScreenings: RegisterScreening[];
  registerTopic: string;
  canNote: boolean; // an admin is signed in: Dev note
}) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState<string | null>(categories[0]?.id ?? null);
  const [builderItemId, setBuilderItemId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderName, setOrderName] = useState("");
  // The cashier: whoever picked themselves in the list, else the person
  // using this iPad per the Staff tools, else the only person on shift. No
  // more re-picking after every reload.
  const onShift = useOnShift();
  // The cashier follows the shift: this iPad's shift, else whoever started
  // most recently. A cashier picked by hand holds only until someone starts
  // or ends a shift (the pick remembers the shift line-up it was made under),
  // and it's kept on this iPad, so a reload keeps it too.
  const shiftKey = `${onShift.onShift.map((o) => o.shiftId).join(",")}|${onShift.meEmployeeId ?? ""}`;
  const pickedCashier = useCashierPick();
  const isEmployee = (id: string | null | undefined): id is string => !!id && employees.some((e) => e.id === id);
  const latestOnShift = [...onShift.onShift].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]?.employeeId ?? null;
  const onShiftIds = new Set(onShift.onShift.map((o) => o.employeeId));
  const employeeId =
    (pickedCashier && pickedCashier.shiftKey === shiftKey && isEmployee(pickedCashier.id) ? pickedCashier.id : "") ||
    (isEmployee(onShift.meEmployeeId) ? onShift.meEmployeeId : "") ||
    (isEmployee(latestOnShift) ? latestOnShift : "");
  // "Ran out" reports from the Staff sheet are made in the cashier's name.
  useEffect(() => {
    publishCashier(employeeId || null);
  }, [employeeId]);
  // 86'd items: what the Staff tools' poll last saw, else what the page
  // loaded with.
  const ranOut = useRanOut();
  const tileExtras = useMenuTileExtras();
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
  // The Insiders+ daily coffee (lib/daily-perk.ts). The attached member's
  // coffee today is looked up when they're put on the order, however they
  // got there (a check-in, a search, a scan, a tab): undefined while it's
  // looked up, null if it couldn't be (then it isn't offered).
  const isPlus = member?.tier === "Insiders+";
  // Gold for paying Insiders+, red NOT ACTIVE for a former unlimited member
  // who isn't paying (member-signal.ts): the frame, the strip over the
  // order, and the mark beside the title on a phone.
  const signal = memberSignal(member);
  // The same, telling plain Insiders from Insiders+ with no card on file
  // (the customer screen's account panel).
  const standing = member ? memberStanding(member) : null;
  useEffect(() => {
    publishMemberSignal(signal);
  }, [signal]);
  useEffect(() => () => publishMemberSignal(null), []);
  const [coffee, setCoffee] = useState<{ memberId: string; state: DailyCoffeeState | null } | null>(null);
  const [coffeeTry, setCoffeeTry] = useState(0);
  // The member whose free coffee staff took off this order.
  const [coffeeOffFor, setCoffeeOffFor] = useState<string | null>(null);
  useEffect(() => {
    if (!memberId || !isPlus) return;
    let live = true;
    getDailyCoffee(memberId).then(
      (state) => {
        if (live) setCoffee({ memberId, state });
      },
      () => {
        if (live) setCoffee({ memberId, state: null });
      },
    );
    return () => {
      live = false;
    };
  }, [memberId, isPlus, coffeeTry]);
  const coffeeToday = isPlus && memberId && coffee?.memberId === memberId ? coffee.state : undefined;
  // Their card on the customer screen (photo, profile line, badges), looked
  // up when they're put on the order, like the coffee. Null until then, or
  // if it couldn't be: the screen shows their account panel without it.
  const [tabletCard, setTabletCard] = useState<{ memberId: string; profile: TabletProfile | null } | null>(null);
  useEffect(() => {
    if (!memberId) return;
    let live = true;
    getTabletProfile(memberId).then(
      (profile) => {
        if (live) setTabletCard({ memberId, profile });
      },
      () => {
        if (live) setTabletCard({ memberId, profile: null });
      },
    );
    return () => {
      live = false;
    };
  }, [memberId]);
  const tabletProfile = memberId && tabletCard?.memberId === memberId ? tabletCard.profile : null;
  // On this order unless it's used, unknown, or staff took it off. Only one
  // member is on an order, so only their coffee can be.
  const coffeeOn = !!memberId && !!coffeeToday && !coffeeToday.usedAt && coffeeOffFor !== memberId;
  const [taxFree, setTaxFree] = useState(false);
  const [monthlyMember, setMonthlyMember] = useState(false);
  // The manual "Monthly member (10% off)" tick counts only with no member on
  // the order: a member's own discount (10% for Insiders+) applies by
  // itself, and the two never stack (Andrew, 10/1). An older tab or held
  // order saved with both comes back without the extra 10%.
  const monthlyOn = monthlyMember && !member;
  // Putting someone on the order takes the manual tick off, so it doesn't
  // come back if they're taken off again.
  function attachMember(m: PosMember | null) {
    setMember(m);
    if (m) setMonthlyMember(false);
  }
  // Who's on the order right now, for a check-in whose lookup finishes
  // between renders (autoAttach).
  const memberNow = useRef<PosMember | null>(null);
  useEffect(() => {
    memberNow.current = member;
  }, [member]);
  const [pointsRedeemed, setPointsRedeemed] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // The tab whose last save failed; its warning shows while it's on screen.
  const [tabSaveIssue, setTabSaveIssue] = useState<{ tabId: string; stale: boolean } | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [ageConfirmOpen, setAgeConfirmOpen] = useState(false);
  const [tip, setTip] = useState(0);
  // The tip was asked on the register (a tab, no reader): the pay screen
  // doesn't ask again, even if they said no tip.
  const [tipAsked, setTipAsked] = useState(false);
  const [heldListOpen, setHeldListOpen] = useState(false);
  // ✨ Easter eggs: a surprise for the bottom of the next printed receipt.
  const [flourish, setFlourish] = useState<FlourishKey | null>(null);
  const flourishRef = useRef<FlourishKey | null>(null);
  useEffect(() => {
    flourishRef.current = flourish;
  }, [flourish]);
  const [tabsListOpen, setTabsListOpen] = useState(false);
  const [cancelTabId, setCancelTabId] = useState<string | null>(null);
  // Ticking "Tax exempt" waits for a manager PIN (approveTaxExempt).
  const [askTaxExempt, setAskTaxExempt] = useState(false);
  const [openTabPromptOpen, setOpenTabPromptOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<{ title: string; description?: string; danger?: boolean; confirmLabel?: string; onConfirm: () => void } | null>(
    null
  );
  const [toast, setToast] = useState<string | null>(null);
  // What the last card sale's card did: points found by the card, a card
  // newly linked, and so on (CardNotice.tsx), newest first. A few are kept,
  // so the next sale's notice doesn't take away the last one's Undo while
  // its 2 minutes are still running. `key` starts each one fresh.
  const [cardNotices, setCardNotices] = useState<{ key: number; notice: CardNotice }[]>([]);
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
        if (scan?.ok && scan.member && !now.member && now.empty) attachMember(scan.member);
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

  // Check-ins from the customer screen. Always listening, whatever's on
  // screen; nothing waits on staff (a shared family number is picked on the
  // screen itself).
  // A check-in that finds one account puts them on the order by itself, the
  // latest one in taking over from whoever was on it (Andrew, 10/2), with
  // "Now on this order: Sarah M. (was Bob K.)" (swap): just to know, no
  // Undo (the register has no reversal buttons; Add to order on the other
  // person switches back). Never mid-payment, and not on a register
  // nobody's looking at (a phone left open on /pos).
  // The note shows for 20 seconds (swapNote: its key); who to put back
  // stays while the newcomer is on the order, for the guest's own "Done" or
  // "That's not me" on the customer screen.
  const [swap, setSwap] = useState<{ key: number; now: PosMember; was: PosMember } | null>(null);
  const [swapNote, setSwapNote] = useState<number | null>(null);
  useEffect(() => {
    if (!swapNote) return;
    const timer = setTimeout(() => setSwapNote(null), 20_000);
    return () => clearTimeout(timer);
  }, [swapNote]);
  const swapShown = swap && swapNote === swap.key && member?.id === swap.now.id ? swap : null;
  function autoAttach(m: PosMember): boolean {
    if (payOpen || busy || finalizingRef.current || document.visibilityState !== "visible") return false;
    const was = memberNow.current;
    if (was?.id === m.id) return true;
    memberNow.current = m;
    attachMember(m);
    const key = Date.now();
    setSwap(was ? { key, now: m, was } : null);
    setSwapNote(was ? key : null);
    return true;
  }
  // Off again ("Done" or "That's not me" on the customer screen): whoever
  // they took over from comes back.
  function autoUndo(memberId: string): PosMember | null {
    if (memberNow.current?.id !== memberId) return null;
    const back = swap?.now.id === memberId ? swap.was : null;
    memberNow.current = back;
    attachMember(back);
    setSwap(null);
    return back;
  }
  const checkins = useRegisterCheckins({
    registerTopic,
    member,
    onAttach: attachMember,
    autoAttach,
    lastSale: lastReceipt,
  });
  // Something on the Customers tab still to act on that isn't a check-in:
  // tickets to print, a possible duplicate account, or a former unlimited
  // member with no payment on file who isn't on the order.
  const customersNote =
    !!checkins.dupHint || !!checkins.tonight?.tickets.some((t) => t.printable) || (!!checkins.unlimited && checkins.unlimited.id !== member?.id);
  // Set when "Find by photo" opens the Customers tab, so it scrolls to the faces.
  const [findAt, setFindAt] = useState(0);
  const menuScrollRef = useRef<HTMLDivElement>(null);
  const [noteOpen, setNoteOpen] = useState(false);

  // What's beside the order: a menu category, Movies or Customers. Each
  // opens at its top.
  function pickTab(id: string) {
    setCategoryId(id);
    setBuilderItemId(null);
    setFindAt(0);
    menuScrollRef.current?.scrollTo({ top: 0 });
  }

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
      { id: "top", label: null as string | null, key: null as string | null, items: category?.items ?? [] },
      ...(category?.subcategories ?? []).map((s) => ({ id: s.id, label: s.label as string | null, key: s.key as string | null, items: s.items })),
    ].filter((s) => s.items.length > 0),
    [category],
  );
  // Every button has a picture (a photo, or its label tile), and picture
  // buttons are taller, so a landscape iPad gets a fourth column to keep as
  // many on screen.
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

  // A line can be the free coffee if its item is ticked as a daily coffee
  // (Back office -> Menu): its menu price comes off, its add-ons don't.
  const totalsLines = cart.map((l) => {
    const item = findItem(l.menuItemId);
    return { unit: l.unit, qty: l.qty, perkBase: item?.daily_perk ? Number(item.price) : null };
  });
  const totals = registerTotals(totalsLines, member, monthlyOn, taxFree, pointsRedeemed, coffeeOn);
  // The line it would go on, whether or not it's on: "Use it" puts it back.
  const coffeePick = coffeeToday && !coffeeToday.usedAt ? dailyPerkPick(totalsLines) : null;
  const itemCount = cart.reduce((s, l) => s + l.qty, 0);
  const activeTab = activeTabId ? openTabs.find((t) => t.id === activeTabId) : null;
  // Anything on the order at all, rung up or not: Clear takes it all off.
  const onOrder = cart.length > 0 || !!member || !!orderName.trim() || taxFree || monthlyMember || pointsRedeemed;
  // "New tab" with a member on a walk-up order is named for them ("Buddy
  // F."): one tap on Open tab. Anyone else's tab, or a new tab while
  // another is open (it starts empty), is named by hand as before.
  const tabNameSuggestion = !activeTabId && member ? shortName(member.name) : "";
  const tabNameTaken = !!tabNameSuggestion && openTabs.some((t) => (t.order_name ?? "").trim().toLowerCase() === tabNameSuggestion.toLowerCase());

  function currentFields(): DraftFields {
    return {
      employeeId,
      memberId,
      orderName,
      taxFree,
      monthlyMember: monthlyOn,
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
    setCoffeeOffFor(null);
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
  }, [activeTabId, cart, orderName, taxFree, monthlyOn, pointsRedeemed, memberId, coffeeOn]);

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
    // points it earns (1 per $1 after discounts, as completeOrder pays).
    discounts: [
      { label: DAILY_COFFEE_LINE, amount: totals.dailyPerkDiscount },
      // Named for the guest: "Insiders+ 10% off" is the perk they see applied.
      { label: isPlus && !member?.legacyUnlimited ? `Insiders+ ${Math.round(memberDiscountRate(member) * 100)}% off` : "Member discount", amount: totals.tierDiscount },
      { label: "Monthly member discount", amount: totals.monthlyDiscount },
      { label: "Points reward", amount: totals.redemptionDiscount },
    ].filter((d) => d.amount > 0),
    // Only what the screen shows: a first name, points, where they stand
    // (gold only for Insiders+ that's paid for; red for unlimited or no
    // card), and their Insiders+ perks today. Never an email or phone.
    member: member
      ? {
          // A phone account's "Guest ·· 0199" whole (lib/member-name.ts).
          firstName: firstNameFor(member.name),
          points: Math.round(member.points),
          plus: standing === "plus",
          unlimited: standing === "unlimited",
          noCard: standing === "nocard",
          coffee: !coffeeToday ? null : coffeeToday.usedAt ? "used" : totals.dailyPerkDiscount > 0 ? "on-order" : "ready",
          discountPct: Math.round(memberDiscountRate(member) * 100),
          profile: tabletProfile,
        }
      : null,
    pointsToEarn: Math.round(pointsEarned(totalsPayload(totals))),
    // The payment screen is up: "ready to pay" on the customer screen.
    paying: payOpen,
  };
  const registerChannelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const sendToTablet = useCallback((event: string, payload: object) => {
    registerChannelRef.current?.send({ type: "broadcast", event, payload });
  }, []);
  // The customer screen's sound effects, once someone's set them on this
  // register (Devices): sent when they change and whenever the screen
  // (re)joins. Never set here: the screen keeps its own.
  const tabletSound: TabletSound | null =
    devices.tabletSound === undefined && devices.tabletVolume === undefined
      ? null
      : { on: devices.tabletSound ?? TABLET_SOUND_DEFAULT.on, volume: devices.tabletVolume ?? TABLET_SOUND_DEFAULT.volume };
  const tabletSoundRef = useRef<TabletSound | null>(null);
  tabletSoundRef.current = tabletSound;

  // A form staff fill in for a guest standing there shows on the customer
  // screen as it's typed (tablet-setup.tsx), and the guest's "✓ That's
  // right" there comes back here to the open form, which saves it.
  const setupForms = useRef(new Map<string, () => void>());
  const tabletSetup = useMemo<TabletSetupLink>(
    () => ({
      send: (event, payload) => registerChannelRef.current?.send({ type: "broadcast", event, payload }),
      listen: (id, onOk) => {
        setupForms.current.set(id, onOk);
        return () => {
          if (setupForms.current.get(id) === onOk) setupForms.current.delete(id);
        };
      },
    }),
    [],
  );
  // ✨ → Rickroll: the button changes only when the customer screen says
  // it's started or stopped (EasterEggs.tsx useRickroll).
  const sendRickroll = useCallback(
    (event: "rickroll" | "rickroll-stop", payload: object) => registerChannelRef.current?.send({ type: "broadcast", event, payload }),
    [],
  );
  const rickroll = useRickroll(sendRickroll);
  const onRickrollState = useEffectEvent((p: Partial<RickrollState> | null) => rickroll.onState(p));
  const onSetupOk = useEffectEvent((id: unknown) => {
    if (typeof id === "string") setupForms.current.get(id)?.();
  });

  // "Done" or "That's not me" under their card on the customer screen: off
  // the order, if they're still the one on it ("Done" only while nothing's
  // rung up: once it is, they're buying), and whoever their check-in took
  // over from comes back. "That's not me" also lets go of the check-in
  // that put them there.
  const onMemberOff = useEffectEvent((p: Partial<MemberOff> | null) => {
    if (!p || typeof p.firstName !== "string" || !member || firstNameFor(member.name) !== p.firstName) return;
    if (p.why !== "not-me" && (cart.length > 0 || activeTabId)) return;
    const back = autoUndo(member.id);
    if (p.why === "not-me") checkins.notMe(member.id);
    const message = `${member.name} tapped ${p.why === "not-me" ? "“That's not me”" : "Done"} on the customer screen, so they're off the order${back ? ` and ${back.name} is back on it` : ""}.`;
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? null : t)), 8000);
  });

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(registerTopic);
    registerChannelRef.current = channel;
    channel
      .on("broadcast", { event: "request-state" }, () => {
        channel.send({ type: "broadcast", event: "cart", payload: cartSnapshotRef.current });
        if (tabletSoundRef.current) channel.send({ type: "broadcast", event: "sound", payload: tabletSoundRef.current });
      })
      .on("broadcast", { event: "staff-setup-ok" }, (msg) => onSetupOk(msg.payload?.id))
      .on("broadcast", { event: "member-off" }, (msg) => onMemberOff(msg.payload))
      .on("broadcast", { event: "rickroll-state" }, (msg) => onRickrollState(msg.payload))
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      registerChannelRef.current = null;
    };
  }, [registerTopic]);

  // Sent again whenever the order changes, and when the member's card or
  // their Insiders+ coffee today comes back (both are looked up after
  // they're put on the order; the customer screen shows them).
  useEffect(() => {
    const timer = setTimeout(() => {
      registerChannelRef.current?.send({ type: "broadcast", event: "cart", payload: cartSnapshotRef.current });
    }, 250);
    return () => clearTimeout(timer);
  }, [cart, orderName, totals.subtotal, totals.tax, totals.total, totals.discount, member, coffeeToday, tabletProfile, payOpen]);

  function resetOrder() {
    setCart([]);
    setOrderName("");
    setMember(null);
    setTaxFree(false);
    setMonthlyMember(false);
    setPointsRedeemed(false);
    setActiveTabId(null);
    // Looked up again for the next order: a coffee just used shows as used.
    setCoffee(null);
    setCoffeeOffFor(null);
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

  async function handleTaxExempt(pin: string) {
    const r = await approveTaxExempt(pin, activeTabId);
    if (!r.ok) throw new Error(r.error); // shown in the PIN box
    setTaxFree(true);
    setAskTaxExempt(false);
    setToast(`Tax exempt. ${approvalText(r)}`);
    setTimeout(() => setToast(null), 7000);
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
    // A points reward the member no longer has the points for, or a daily
    // coffee they've already had today (on the other register, say), comes
    // off before anyone pays. If the check can't run, the sale goes ahead.
    if ((pointsRedeemed && totals.redemptionDiscount > 0) || totals.dailyPerkDiscount > 0 || ENFORCE_REGISTER_TOTALS) {
      setBusy(true);
      const r = await checkBeforePayment(currentFields(), totalsPayload(totals)).catch(() => null);
      setBusy(false);
      if (r && !r.ok) {
        if (r.points !== undefined) {
          setPointsRedeemed(false);
          if (member) setMember({ ...member, points: r.points });
        }
        if (r.dropDailyCoffee !== undefined && memberId) {
          // Already used: the member panel shows when. Otherwise it's just off.
          if (r.dropDailyCoffee?.usedAt) setCoffee({ memberId, state: r.dropDailyCoffee });
          else setCoffeeOffFor(memberId);
        }
        return setToast(r.error);
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

  function continueAfterTip(tipAmount: number, asked = false) {
    setTip(tipAmount);
    setTipAsked(asked);
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

  // The sale on screen as completeOrder gets it, paid with `payment`. A
  // tab's tip is asked on the register (TipModal); any other card sale can
  // get one on the reader. Either way it's one tip on the order.
  function orderFor(payment: CheckoutPayment): CompleteOrderInput {
    return {
      ...currentFields(),
      totals: totalsPayload(totals),
      payment,
      ageVerified: cart.some((l) => l.isAlcohol),
      tip: cents(tip + (payment.tip ?? 0)),
      draftOrderId: activeTabId,
    };
  }

  // A payment just sent to the reader: kept in this browser until it's
  // saved or canceled, so a reload mid-payment can still find it (see
  // recoverReaderPayments).
  function keepReaderPayment(payment: CheckoutPayment) {
    if (readerId) keepPendingReaderSale({ readerId, order: orderFor(payment), memberName: member?.name ?? null, startedAt: Date.now() });
  }

  async function finalizeCheckout(payment: CheckoutPayment, note?: string) {
    // A double tap (or a second "paid" answer from the reader) must not save
    // or print the sale twice.
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    setPayOpen(false);
    setBusy(true);
    try {
      const saved = await saveSale({ order: orderFor(payment), memberName: member?.name ?? null, tries: 0 }, note);
      // The customer screen's "paid" sound.
      if (saved) sendToTablet("paid", {});
      // A charged card that didn't save is cleared too: the sale now lives in
      // the "card WAS charged" banner, so its items can't be charged again,
      // held, or moved onto a tab.
      if (saved || payment.stripePaymentIntentId) {
        resetOrder();
        setTip(0);
        setTipAsked(false);
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
    // The "card WAS charged" warning holds one sale. It can be holding
    // another one here: a payment from before a reload, found while this
    // sale's payment screen was open (recoverReaderPayments). That one is
    // never wiped or replaced by this sale; if this one needs the warning
    // too, it waits its turn with the reader payments, already final.
    const heldOther = () => {
      const held = currentUnsavedSale();
      return !!held && held.order.payment.stripePaymentIntentId !== payment.stripePaymentIntentId;
    };
    let queued = false;
    const holdCharged = (s: UnsavedSale, error?: string) => {
      if (!heldOther()) return keepUnsavedSale(s);
      keepPendingReaderSale({ readerId: readerId ?? "", order: s.order, memberName: s.memberName, startedAt: Date.now(), final: true });
      queued = true;
      setToast(`${error ? `${error} ` : ""}This card WAS charged (${money(s.order.payment.card)}) but the sale didn't save. It comes up for Retry saving once the warning below is dealt with. Don't charge the card again.`);
    };
    const clearHeld = () => {
      if (!heldOther()) keepUnsavedSale(null);
    };
    let orderNumber: number;
    let warning: string | undefined;
    let card: CardNotice | null;
    try {
      const r = await completeOrder(order);
      if (!r.ok) {
        // The server turned the sale down (it checks the card payment with
        // Stripe). Its message says what to do; a card that was charged
        // keeps the warning up so it isn't charged again.
        if (r.cardCharged) holdCharged({ ...sale, tries: sale.tries + 1 }, r.error);
        else clearHeld();
        if (!queued) setToast(r.error);
        return false;
      }
      orderNumber = r.orderNumber;
      warning = r.warning;
      card = r.card;
    } catch (e) {
      const stale = isStaleBuildError(e);
      if (payment.stripePaymentIntentId) {
        // The card is already charged. Keep this exact payment for Retry
        // saving (one order per payment, so a retry can't make a second
        // sale) and hold off new charges until it's saved. A small toast here
        // used to let the register go back to charging the card again.
        holdCharged({ ...sale, tries: sale.tries + 1, stale });
      } else if (stale) {
        setToast("The register was just updated and this sale didn't save. Reload the page, then ring it up again.");
      } else {
        setToast(e instanceof Error ? `Checkout failed: ${e.message}` : "Checkout failed");
      }
      return false;
    } finally {
      // Saved, or kept in the "card WAS charged" warning: either way the
      // reader payment isn't in progress anymore. (One waiting its turn for
      // the warning stays in the list.)
      if (payment.stripePaymentIntentId && !queued) clearPendingReaderSale(payment.stripePaymentIntentId);
    }
    clearHeld();
    // Each notice names its order and goes when its 2 minutes are up, so a
    // quick sale next doesn't take away the last card sale's Undo.
    if (card) {
      const next = { key: Date.now(), notice: card };
      setCardNotices((list) => [next, ...list.filter((n) => n.notice.orderId !== next.notice.orderId)].slice(0, 3));
    }
    const receipt: ReceiptData = {
      orderNumber,
      at: new Date().toISOString(),
      cashier: employees.find((e) => e.id === order.employeeId)?.name ?? null,
      // Only a member staff attached. One found by the card isn't printed:
      // whoever paid takes the receipt, and it may not be their card.
      member: sale.memberName,
      orderName: order.orderName.trim() || null,
      lines: order.lines.map((l) => ({ name: l.name, qty: l.quantity, unit: l.unit_price, mods: l.modifiers })),
      subtotal: order.totals.subtotal,
      discounts: [
        { label: DAILY_COFFEE_LINE, amount: order.totals.daily_perk_discount ?? 0 },
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
      points: { earned: pointsEarned(order.totals), rewardUsed: order.pointsRedeemed && order.totals.redemption_discount > 0 },
    };
    setLastReceipt(receipt);
    const tickets: TicketSale[] = order.lines.filter((l) => l.screening_id).map((l) => ({ screeningId: l.screening_id as string, qty: l.quantity }));
    setLastTickets(tickets.length ? { orderNumber, lines: tickets } : null);
    void printAfterSale(receipt, payment.cash > 0, tickets);
    const parts = [`Order #${orderNumber} complete — ${money(order.totals.total + allTip)} charged (${payment.method})`];
    if (allTip > 0) parts.push(`${money(allTip)} tip`);
    if (payment.voucher && payment.method !== "voucher") parts.push(`${money(payment.voucher)} in vouchers`);
    if (change > 0) parts.push(`give ${money(change)} change`);
    const notes = [note, warning].filter(Boolean).join(" ");
    setToast(notes ? `${notes} ${parts.join(" — ")}` : parts.join(" — "));
    router.refresh();
    setTimeout(() => setToast(null), warning ? 30000 : note ? 15000 : 7000);
    return true;
  }

  async function retryUnsavedSale() {
    if (!unsavedSale || finalizingRef.current) return;
    finalizingRef.current = true;
    setBusy(true);
    let saved = false;
    try {
      const { draftOrderId } = unsavedSale.order;
      saved = await saveSale(unsavedSale);
      // If that tab was opened again meanwhile, it's closed now: take it off
      // the screen so it can't be charged a second time.
      if (saved && draftOrderId && draftOrderId === activeTabId) resetOrder();
    } finally {
      finalizingRef.current = false;
      setBusy(false);
    }
    // Another reader payment from before a reload may be waiting its turn.
    if (saved) void recoverReaderPayments();
  }

  // The way out if a save can never work, so one stuck sale can't keep the
  // register from charging. The card stays charged with no sale, so the
  // office is told (Reports -> Register checks).
  function stopTryingUnsavedSale() {
    const onTab = !!unsavedSale?.order.draftOrderId;
    setConfirmState({
      title: "Stop trying to save this sale?",
      description: `The card stays charged, but the sale won't be in Reports.${onTab ? " Its tab may still be open: have a manager cancel it, don't charge it again." : ""} Only do this if a manager says so.`,
      danger: true,
      confirmLabel: "Stop trying",
      onConfirm: async () => {
        setConfirmState(null);
        const sale = unsavedSale;
        keepUnsavedSale(null);
        if (!sale) return;
        const told = await logAbandonedSale(sale.order, sale.tries).then(
          () => true,
          () => false,
        );
        if (!told) setToast(`Stopped trying. The office couldn't be told, so tell a manager: a card was charged ${money(sale.order.payment.card)} with no sale saved.`);
        void recoverReaderPayments();
      },
    });
  }

  // Reader payments this browser started that never finished here: the
  // page was reloaded mid-payment (a deploy, a frozen screen). Each is
  // looked up with Stripe. One that went through becomes the "card WAS
  // charged" warning, so Retry saving records it; one still waiting on the
  // reader is stopped first, since nothing is watching it anymore and a tap
  // now would charge a sale nobody saves. One warning at a time: the next
  // waits until this one is dealt with.
  const recoveringRef = useRef(false);
  async function recoverReaderPayments() {
    if (recoveringRef.current) return;
    recoveringRef.current = true;
    try {
      for (const p of readPendingReaderSales()) {
        const paymentIntentId = p.order.payment.stripePaymentIntentId as string;
        const held = currentUnsavedSale();
        if (held?.order.payment.stripePaymentIntentId === paymentIntentId) {
          clearPendingReaderSale(paymentIntentId);
          continue;
        }
        let r = await checkReaderPayment(paymentIntentId).catch(() => null);
        // No answer (offline, or an out-of-date page): looked at again next load.
        if (!r) return;
        if (r.status !== "succeeded" && r.status !== "canceled") {
          await cancelReaderPayment(paymentIntentId, p.readerId).catch(() => {});
          r = await checkReaderPayment(paymentIntentId).catch(() => null);
          if (!r) return;
        }
        if (r.status === "succeeded") {
          // Its sale may have saved just before the page went: then there's
          // nothing to retry (and no receipt or drawer to repeat).
          const savedAs = await savedOrderForPayment(paymentIntentId).catch(() => undefined);
          if (typeof savedAs === "number") {
            clearPendingReaderSale(paymentIntentId);
            setToast(`The card payment from before the page reloaded went through and was saved as order #${savedAs}. Nothing more to do.`);
            continue;
          }
          if (held) return;
          const readerTip = r.tipCents / 100;
          keepUnsavedSale({
            // A sale that waited its turn is already final; one from the
            // reader gets the amount and tip the customer ended up paying.
            order: p.final ? p.order : { ...p.order, payment: { ...p.order.payment, card: r.amountCents / 100, tip: readerTip }, tip: cents((p.order.tip ?? 0) + readerTip) },
            memberName: p.memberName,
            tries: 0,
          });
          clearPendingReaderSale(paymentIntentId);
          setToast(
            p.final
              ? "Another card payment was charged but isn't saved yet. Tap Retry saving below, and don't charge that card again."
              : "A card payment from before the page reloaded went through but isn't saved yet. Tap Retry saving below.",
          );
        } else if (r.status === "canceled") {
          clearPendingReaderSale(paymentIntentId);
          if (Date.now() - p.startedAt < 30 * 60_000) {
            const pay = p.order.payment;
            // A split's cash part was taken before the card, and the note
            // that said to hand it back went with the reload.
            const cashBack = pay.method === "split" && pay.cash > 0 ? ` It was a split: hand back the ${money(pay.tendered ?? pay.cash)} cash they gave you first.` : "";
            // A tab is still open; a walk-up order went with the reload.
            const again = p.order.draftOrderId ? "Take payment on the tab again." : "Ring the order up again, then take payment.";
            setToast(`The card payment from before the page reloaded didn't go through, so nothing was charged.${cashBack} ${again}`);
          }
        } else {
          // Still going through: looked at again on the next load.
          setToast("A card payment from before the page reloaded is still going through. Don't charge that card again: reload in a minute to see if it went through.");
          return;
        }
      }
    } finally {
      recoveringRef.current = false;
    }
  }

  // Once, when the register opens.
  useEffect(() => {
    void recoverReaderPayments();
  }, []);

  return (
    <div className="grid gap-3 md:min-h-0 md:flex-1 md:grid-cols-[370px_1fr] lg:grid-cols-[440px_1fr]">
      {/* Cart panel. On a tablet the page is locked to the screen: the header
          and the checkout block stay put, and only the middle (the order
          itself) scrolls -- so the header and footer are kept to two rows each. */}
      <SignalFrame signal={signal} />
      <div
        className="card relative flex flex-col !p-3 md:min-h-0"
        style={signal ? { boxShadow: `0 0 0 3px ${signal === "plus" ? "var(--gold)" : "var(--accent)"}` } : undefined}
      >
        {/* Someone just checked in on the customer screen: over the top of
            the order for a few seconds, never over the menu or the total. */}
        <CheckinArrivals
          arrivals={checkins.arrivals}
          onDismiss={checkins.dismissArrival}
          onOpen={(id) => {
            checkins.dismissArrival(id);
            pickTab(CUSTOMERS_TAB);
            // A phone stacks the menu under the order: bring the tab up.
            if (!window.matchMedia("(min-width: 768px)").matches) menuScrollRef.current?.parentElement?.scrollIntoView({ block: "start" });
          }}
        />
        <div className="shrink-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <select className="input min-h-11 min-w-[7rem] flex-1 !py-2" aria-label="Cashier" value={employeeId} onChange={(e) => pickCashier(e.target.value ? { id: e.target.value, shiftKey } : null)}>
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
            {/* Everything about working a shift, with a red count of what
                needs a look (shift/StaffButton.tsx). It replaced the shift
                bar that took a whole row above the register. */}
            <StaffButton />
            <button className={`chip min-h-11 shrink-0 whitespace-nowrap !px-3 !py-1.5 text-sm ${heldListOpen ? "chip-selected" : ""}`} onClick={() => setHeldListOpen((v) => !v)}>
              Held {heldOrders.length}
            </button>
            <button className={`chip min-h-11 shrink-0 whitespace-nowrap !px-3 !py-1.5 text-sm ${tabsListOpen ? "chip-selected" : ""}`} onClick={() => setTabsListOpen((v) => !v)}>
              Tabs {openTabs.length}
            </button>
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
          {/* Across the top of the order, never scrolled away: a former
              unlimited member who isn't paying (with the two ways to set it
              up), or a paying Insiders+ member. */}
          {member && signal === "unlimited" ? (
            <UnlimitedBanner
              key={member.id}
              member={member}
              readerId={readerId}
              employeeId={employeeId}
              toTablet={checkins.toTablet}
              onDone={(m) => {
                attachMember(m);
                const done = `${firstNameFor(m.name)} is Insiders+ now.`;
                setToast(done);
                setTimeout(() => setToast((t) => (t === done ? null : t)), 8000);
              }}
            />
          ) : (
            member && signal === "plus" && <PlusRibbon name={member.name} discount={memberDiscountRate(member)} />
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

          {/* A check-in on the customer screen took over the order from whoever was on it. */}
          {swapShown && (
            <div className="notice notice-success flex items-center gap-2 !py-1 !pl-2.5 !pr-1 text-sm" role="status">
              <span className="min-w-0 flex-1 leading-snug">
                <strong>Now on this order: {shortName(swapShown.now.name)}</strong> (was {shortName(swapShown.was.name)})
              </span>
              <button
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-lg leading-none"
                style={{ color: "var(--muted)" }}
                aria-label="Dismiss"
                onClick={() => setSwapNote(null)}
              >
                ×
              </button>
            </div>
          )}
          {toast && (
            <div className="notice notice-success p-2.5 text-xs">
              {toast}
            </div>
          )}
          {cardNotices.map((n) => (
            <CardNoticeBanner key={n.key} notice={n.notice} onClose={() => setCardNotices((list) => list.filter((x) => x.key !== n.key))} />
          ))}
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
            cart.map((line, i) => (
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
                  {i === totals.dailyPerkLine && (
                    <div className="truncate text-xs font-bold" style={{ color: "var(--accent)" }}>
                      ☕ {line.qty > 1 ? "One free today" : "Free today"}
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

          {/* The Insiders+ daily coffee: on the order with a way to take it
              off, or off with a way to put it back. */}
          {memberId && coffeePick && totals.dailyPerkLine !== null ? (
            <div
              className="flex items-center gap-2 rounded-md border-2 px-2 py-1.5 text-xs"
              style={{ borderColor: "var(--foreground)", background: "var(--gold)", color: "var(--foreground)" }}
            >
              <span className="min-w-0 flex-1">
                ☕ <strong>{DAILY_COFFEE_TITLE}</strong>
                {/* Wraps on an upright iPad rather than cutting off. */}
                <span className="block">{cart[totals.dailyPerkLine]?.name} free, add-ons still charged</span>
              </span>
              <span className="shrink-0 font-bold tabular-nums">−{money(totals.dailyPerkDiscount)}</span>
              <button className="btn-secondary shrink-0 !px-2.5 !py-1.5 !text-xs" onClick={() => setCoffeeOffFor(memberId)}>
                Remove
              </button>
            </div>
          ) : (
            memberId &&
            coffeePick && (
              <div className="flex items-center gap-2 rounded-md border border-dashed px-2 py-1.5 text-xs" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                <span className="min-w-0 flex-1">☕ {DAILY_COFFEE_TITLE}: not on this order.</span>
                <button className="btn-secondary shrink-0 !px-2.5 !py-1.5 !text-xs" onClick={() => setCoffeeOffFor(null)}>
                  Use it
                </button>
              </div>
            )
          )}

          {/* Its "+ Add name" / "+ Add email" show on the customer screen as they're typed. */}
          <TabletSetupContext value={tabletSetup}>
          <PosMemberPanel
            member={member}
            onChange={attachMember}
            visit={checkins.visitFor(memberId)}
            coffee={
              isPlus
                ? {
                    today: coffeeToday,
                    onOrder: totals.dailyPerkDiscount > 0,
                    retry: () => {
                      setCoffee(null);
                      setCoffeeTry((n) => n + 1);
                    },
                  }
                : null
            }
            employeeId={employeeId}
            onRewardLine={(label) => setCart((prev) => [...prev, { key: `${Date.now()}-${Math.random()}`, menuItemId: null, name: label, unit: 0, qty: 1, mods: [], isAlcohol: false }])}
            onFind={() => {
              pickTab(CUSTOMERS_TAB);
              setFindAt(Date.now());
            }}
            readerId={readerId}
            toTablet={checkins.toTablet}
          />
          </TabletSetupContext>

          <div className="space-y-1 pt-1">
          {/* With a member on the order, their discount is ticked by itself
              (Insiders+ 10%; plain Insiders earn points instead) and the
              manual Monthly member tick is hidden, so the two can't stack. */}
          {member ? (
            isPlus && (
              <label className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--foreground)" }}>
                <input type="checkbox" checked readOnly disabled aria-readonly />
                Insiders+ · {Math.round(memberDiscountRate(member) * 100)}% off
              </label>
            )
          ) : (
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
              <input type="checkbox" checked={monthlyMember} onChange={(e) => setMonthlyMember(e.target.checked)} />
              Monthly member (10% off)
            </label>
          )}
          <label className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
            <input type="checkbox" checked={taxFree} onChange={(e) => (e.target.checked ? setAskTaxExempt(true) : setTaxFree(false))} />
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
            {employeeId ? "Complete order" : "Pick a cashier"}
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
              disabled={(!onOrder && !activeTabId) || busy}
              onClick={() => {
                // Leaving a tab is a routine, non-destructive action (it saves
                // first) -- only skip the confirm step for that case. Clearing
                // a walk-up order with items actually discards them, so that
                // one still asks first. With nothing rung up (just a member,
                // a name or a tick box), there's nothing to lose: it clears
                // straight away.
                if (activeTabId) {
                  void putAwayTab();
                  return;
                }
                if (cart.length === 0) {
                  resetOrder();
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
              rickroll={rickroll}
            />
            {/* This register's reader, printer, drawer and the customer
                screen's sounds. Down here in the row's spare cells, so the
                top row has room for the Staff button. */}
            <DevicesPanel
              buttonClassName="btn-secondary relative whitespace-nowrap !px-2 py-2 text-sm"
              fallbackReaderId={defaultReaderId}
              onReprintTickets={lastTickets && printTarget ? () => printTickets(printTarget, lastTickets.orderNumber, lastTickets.lines) : null}
              onReprint={lastReceipt && printTarget ? () => sendPrint(printTarget, "receipt", receiptXml(lastReceipt), `Receipt #${lastReceipt.orderNumber} (again)`) : null}
              sendToTablet={sendToTablet}
            />
            {/* Booths held today (it used to be a box above the register). */}
            <BoothsButton className="btn-secondary whitespace-nowrap !px-2 py-2 text-sm" />
            {/* Admins only. Docked here, in the row's spare cells, rather than
                floating over the menu buttons the way it used to. */}
            {canNote && (
              <button
                className="btn-secondary inline-flex items-center justify-center gap-1 whitespace-nowrap !px-2 py-2 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                onClick={() => setNoteOpen(true)}
                title="Leave a dev note about the register or the customer screen"
                aria-label="Dev note"
              >
                <NoteIcon size={16} />
                Note
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Menu panel: category buttons pinned, items scroll. */}
      <div className="card flex flex-col !p-3 md:min-h-0">
        {/* Category buttons share the row evenly, big enough to hit fast. */}
        <div className="mb-3 flex shrink-0 flex-wrap gap-2">
          <button
            className={`chip flex min-w-[5.5rem] flex-1 items-center justify-center gap-2 !px-3 !py-2.5 !text-base font-bold ${categoryId === MOVIES_TAB ? "chip-selected" : ""}`}
            onClick={() => pickTab(MOVIES_TAB)}
          >
            <CategoryIcon category="movies" />
            Movies
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`chip flex min-w-[5.5rem] flex-1 items-center justify-center gap-2 !px-3 !py-2.5 !text-base ${categoryId === c.id ? "chip-selected" : ""}`}
              onClick={() => pickTab(c.id)}
            >
              {/* An icon reads at this size where a tiny photo doesn't. */}
              <CategoryIcon category={c.key} label={c.label} />
              {c.label}
            </button>
          ))}
          {/* Last, so the menu tabs keep their places. A dot when there's
              something there to look at (nothing pops up over the menu
              buttons). Never narrower than its name (an upright iPad gives
              it a row of its own). */}
          <button
            className={`chip relative flex min-w-fit flex-1 items-center justify-center gap-2 !px-3 !py-2.5 !text-base font-bold ${categoryId === CUSTOMERS_TAB ? "chip-selected" : ""}`}
            onClick={() => pickTab(CUSTOMERS_TAB)}
            aria-label={`Customers${customersNote ? ": something to look at" : ""}`}
          >
            <CustomersIcon />
            Customers
            {customersNote && categoryId !== CUSTOMERS_TAB && <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--foreground)" }} aria-hidden />}
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

        <div ref={menuScrollRef} data-menu-scroll className="md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain">
        {categoryId === CUSTOMERS_TAB ? (
          // Its "New phone account" shows on the customer screen as it's typed.
          <TabletSetupContext value={tabletSetup}>
            <CustomersTab checkins={checkins} current={member} hasOrder={cart.length > 0 || !!activeTabId} onAttach={attachMember} findAt={findAt} readerId={readerId} employeeId={employeeId} />
          </TabletSetupContext>
        ) : categoryId === MOVIES_TAB ? (
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
                    <CategoryIcon category={section.key} label={section.label} size={18} />
                    {section.label}
                  </div>
                )}
                <div className={`grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4`}>
                  {section.items.map((item) => {
                    const out = outs.get(item.id) ?? null;
                    return (
                      <MenuTile
                        key={item.id}
                        name={item.name}
                        price={money(item.price)}
                        imageUrl={item.image_url}
                        // Its label tile when there's no photo, and press and hold for its settings.
                        {...tileExtras(item, category, section.label, out)}
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
        <TipModal subtotal={totals.subtotal} tabName={activeTab?.order_name ?? "Tab"} onConfirm={(t) => continueAfterTip(t, true)} onCancel={() => setTipOpen(false)} />
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
          total={cents(totals.total + tip)}
          readerId={readerId}
          tipEligible={tip > 0 || tipAsked ? null : totals.total - totals.tax}
          tipTaken={tipAsked}
          tabCard={activeTab?.card_label ? { tabId: activeTab.id, label: activeTab.card_label } : null}
          tabName={activeTab?.order_name ?? "Tab"}
          onReaderStarted={keepReaderPayment}
          onReaderCanceled={clearPendingReaderSale}
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

      {askTaxExempt && (
        <ManagerPinModal
          title="Tax-exempt sale"
          description={`Only for a customer with a Missouri tax exemption certificate. Everything else is taxed at ${SALES_TAX_PERCENT}%. A manager approves each one.`}
          onCancel={() => setAskTaxExempt(false)}
          onSubmit={handleTaxExempt}
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
          initialValue={tabNameSuggestion}
          note={tabNameTaken ? `A tab named ${tabNameSuggestion} is already open.` : null}
          onCancel={() => setOpenTabPromptOpen(false)}
          onSubmit={handleOpenTab}
        />
      )}

      {noteOpen && <DevNoteDialog about={NOTE_ABOUT} onClose={() => setNoteOpen(false)} />}

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

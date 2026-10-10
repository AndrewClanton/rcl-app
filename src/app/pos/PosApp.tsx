"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MenuCategory, Employee, Recipe } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import {
  EMPTY_CART_SNAPSHOT,
  TABLET_SOUND_DEFAULT,
  type MemberOff,
  parseCardOnFileAnswer,
  type ReaderPrompt,
  type RegisterCartSnapshot,
  type RickrollState,
  type TabletProfile,
  type TabletSound,
} from "@/lib/registerChannel";
import { TabletSetupContext, type TabletSetupLink } from "./tablet-setup";
import ItemBuilder, { type BuiltLine } from "./ItemBuilder";
import PaymentModal, { type CardOnFileLink, type CardOnFileListener } from "./PaymentModal";
import TipModal from "./TipModal";
import CustomItemModal from "./CustomItemModal";
import GiftCardSellModal from "./GiftCardSellModal";
import { GIFT_CARD_LINE_NAME, giftCodeTail, type IssuedGiftCard } from "@/lib/gift-cards";
import TabCardModal from "./TabCardModal";
import InfoTip from "@/components/help/InfoTip";
import { useOnShift } from "./shift/on-shift-store";
import { publishCashier, useRanOut } from "./shift/ran-out-store";
import { ItemOutDialog } from "./shift/RanOut";
import MenuTile from "@/components/menu/MenuTile";
import CategoryIcon from "@/components/menu/CategoryIcon";
import BarTab from "./BarTab";
import OrderLineRow from "./OrderLineRow";
import {
  DOUBLE,
  SERVE_MOD,
  canServe,
  doubleUpcharge,
  hasLiquorChoice,
  hasOwnDouble,
  hasOwnServe,
  isDouble,
  isServeMod,
  optionsUpcharge,
  serveOf,
  type DoubleContext,
  type DoubleLine,
  type Serve,
} from "@/lib/bar/double";
import { doubleSettingsOf, type BarPrices } from "@/lib/bar/pricing";
import { iconSpecFor, type BarSection, type IconSpec } from "@/lib/bar/icons";
import { customSpec } from "@/lib/bar/match";
import BarBook from "./BarBook";
import WhatsInIt from "./WhatsInIt";
import { loadBarBook } from "./bar-book-actions";
import { barSectionOf, isBarCategory, itemIconSpec } from "@/lib/bar/menu";
import { countMakeable, type BookRecipe, type BookStock, type MenuRef } from "@/lib/bar/book";
import { useMenuTileExtras } from "./item-settings/ItemSettings";
import type { RegisterOut } from "@/lib/ops/shared";
import MovieTickets from "./MovieTickets";
import { checkTicketSeats, type RegisterScreening } from "./ticket-actions";
import { POINTS_PER_REWARD, REWARD_VALUE, rewardLabel, rewardPointsFor } from "@/lib/loyalty";
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
import TaxExemptModal from "./TaxExemptModal";
import type { TaxExemptMark, TaxExemptReason } from "@/lib/tax-exempt";
import { approvalText } from "@/lib/pin-rules";
import PromptModal from "@/components/PromptModal";
import ConfirmModal from "@/components/ConfirmModal";
import { drawerXml, giftCardSlipXml, visitSlipXml, type ReceiptData, type VisitSlip } from "@/lib/print/receipt";
import VisitSlipNotice from "./VisitSlipNotice";
import { printTickets, type TicketSale } from "./print-tickets";
import { useScanner } from "./useScanner";
import { handleDoorScan } from "./door-print";
import RecentOrders from "./RecentOrders";
import RecentDeclines from "./RecentDeclines";
import EasterEggs, { useRickroll } from "./EasterEggs";
import { flourishLines, type FlourishKey } from "@/lib/print/flourishes";
import { sendPrint, usePrintTarget } from "./printing";
import { customerReceipt, receiptPatterns } from "./receipt-print";
import { receiptClaimUrl } from "./receipt-claim";
import DevicesPanel from "./devices/DevicesPanel";
import { useReaderMonitor } from "./devices/reader-monitor";
import { READER_OFFLINE_MESSAGE, readerNeedsLook } from "@/lib/terminal/reader-status";
import { BoothsButton, StaffButton } from "./shift/StaffButton";
import { SeatOrdersButton } from "./SeatOrders";
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
import OldCardPrompt from "./OldCardPrompt";
import type { OldCardOffer } from "@/lib/fortis-claim";
import type { CardNotice } from "@/lib/card-match";
import { isStaleBuildError } from "@/lib/deployment";
import {
  cents,
  dailyPerkPick,
  ENFORCE_REGISTER_TOTALS,
  memberDiscountRate,
  OWNER_RATE_NAME,
  ownerCartKey,
  ownerOrderTotals,
  isGiftCardLine,
  pointsEarned,
  registerTotals,
} from "@/lib/register-totals";
import { quoteOwnerRate, type OwnerRateQuote } from "./owner-rate-actions";
import { DAILY_COFFEE_LINE, DAILY_COFFEE_TITLE, type DailyCoffeeState } from "@/lib/daily-perk";
import { getDailyCoffee, getPosMember, getTabletProfile } from "./member-actions";
import { approveShortRewards, checkOrderReward, checkRewardsBeforePay } from "./reward-actions";
import { parseRewardAdd, type RewardAdded } from "@/lib/rewards";
import { approveOrgOverLimit, getOrgOnOrder } from "./org-actions";
import { compCountText, isDayPassName, orgCompPlan, roleLabel, TAX_INCLUDED_NOTE, type OrgOnOrder } from "@/lib/orgs";
import { groupCompPlan, groupInput, groupPeople, groupTaxIncluded, joinPlans, type OrgGroupOnOrder } from "@/lib/orgs";
import { OrgGroupCard, OrgGuestsButton, OrgGuestsPicker } from "./OrgGuests";
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

// An organization visit's slip, before the order has its number.
type VisitDetails = Omit<VisitSlip, "orderNumber" | "at" | "reprint">;

interface CartLine {
  key: string;
  menuItemId: string | null;
  screeningId?: string | null; // a movie ticket for this showing
  name: string;
  unit: number;
  qty: number;
  mods: string[];
  isAlcohol: boolean;
  // A Bar Book drink rung up off the menu (BarBook.tsx → Add to order): a
  // one-off line like "+ Custom item" that knows its recipe.
  recipeId?: string | null;
  // A custom drink from "What's in it?" (WhatsInIt.tsx): a one-off line
  // that knows what's in it.
  customRecipe?: { ingredient_id: string; quantity: number }[] | null;
  // A reward the member picked on the customer screen ("Spend points"): a
  // $0 line, one each, its points taken when the sale is saved.
  rewardId?: string | null;
  rewardPoints?: number;
  rewardMember?: string | null; // whose points: it comes off if they leave the order
  // A gift card being sold (the Gift card button): the member it goes on.
  giftMemberId?: string | null;
}

// "Reward: Personal popcorn (−40 pts)" -> 40, for a reward line loaded back from a tab.
function rewardPointsOf(name: string): number {
  const m = name.match(/\(−(\d+) pts\)$/);
  return m ? Number(m[1]) : 0;
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
    // Only when there's one, so every other sale saves as it always has.
    ...(t.orgCompDiscount > 0 ? { org_comp_discount: t.orgCompDiscount } : {}),
    ...(t.taxIncluded ? { tax_included: true } : {}),
    ...(t.giftCardSales > 0 ? { gift_card_sales: t.giftCardSales } : {}),
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
  ownerMembers,
  barPrices,
  dayPass,
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
  ownerMembers: string[]; // the owners' own member accounts that get the owner rate (Back office, Owner rate)
  barPrices: BarPrices; // the Prices sheet: doubles, neat or rocks and the off-menu rule (lib/bar/pricing.ts)
  dayPass?: MenuCategory["items"][number] | null; // the Day pass, for organization comps (its Tickets category stays off the item buttons)
}) {
  const doubleSettings = useMemo(() => doubleSettingsOf(barPrices), [barPrices]);
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
  // Patterned receipts' setting, fetched now so the first receipt has it.
  useEffect(() => {
    void receiptPatterns();
  }, []);
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
  // A reward someone picked with their points comes off the order with them
  // (adjusted as the member changes, during render, not in an effect).
  const [rewardsFor, setRewardsFor] = useState<string | null>(memberId);
  if (rewardsFor !== memberId) {
    setRewardsFor(memberId);
    setCart((prev) => (prev.some((l) => l.rewardMember && l.rewardMember !== memberId) ? prev.filter((l) => !l.rewardMember || l.rewardMember === memberId) : prev));
  }
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
  // Looked up again after they unlock a perk on the customer screen.
  const [cardTry, setCardTry] = useState(0);
  useEffect(() => {
    if (!memberId) return;
    let live = true;
    getTabletProfile(memberId).then(
      (profile) => {
        if (live) setTabletCard({ memberId, profile });
      },
      () => {
        // A second look that fails keeps the card already up.
        if (live) setTabletCard((c) => (c?.memberId === memberId ? c : { memberId, profile: null }));
      },
    );
    return () => {
      live = false;
    };
  }, [memberId, cardTry]);
  const tabletProfile = memberId && tabletCard?.memberId === memberId ? tabletCard.profile : null;
  // On this order unless it's used, unknown, or staff took it off. Only one
  // member is on an order, so only their coffee can be.
  const coffeeOn = !!memberId && !!coffeeToday && !coffeeToday.usedAt && coffeeOffFor !== memberId;
  // The member's organization (lib/orgs.ts): their comps today and, for a
  // supported guest, tax-included prices. Looked up when they're put on the
  // order, like the coffee; looked up again after a sale or a refused check.
  const [orgState, setOrgState] = useState<{ memberId: string; org: OrgOnOrder | null } | null>(null);
  const [orgTry, setOrgTry] = useState(0);
  useEffect(() => {
    if (!memberId) return;
    let live = true;
    getOrgOnOrder(memberId).then(
      (org) => {
        if (live) setOrgState({ memberId, org });
      },
      () => {
        if (live) setOrgState({ memberId, org: null });
      },
    );
    return () => {
      live = false;
    };
  }, [memberId, orgTry]);
  const orgOnOrder = memberId && orgState?.memberId === memberId ? orgState.org : null;
  // A manager's OK to comp past today's limit, for one organization.
  const [orgApproval, setOrgApproval] = useState<{ orgId: string; token: string } | null>(null);
  const [orgPinOpen, setOrgPinOpen] = useState(false);
  // Reward lines the member can't have now (points short, past a limit, out
  // of stock): a manager PIN lets the sale go ahead (code review N12).
  const [rewardPin, setRewardPin] = useState<string[] | null>(null);
  const orgOverride = !!orgOnOrder && orgApproval?.orgId === orgOnOrder.orgId;
  const orgTaxIncluded = !!orgOnOrder?.active && orgOnOrder.role === "supported";
  // Organization guests with no account (OrgGuests.tsx), for the order
  // they were added to (key: its tab, null for a walk-up order).
  const [groupState, setGroupState] = useState<{ key: string | null; g: OrgGroupOnOrder } | null>(null);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
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
  const [giftSellOpen, setGiftSellOpen] = useState(false);
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
  // Ticking "Tax exempt" waits for a reason and a manager PIN
  // (approveTaxExempt); the mark goes on the order for Reports.
  const [askTaxExempt, setAskTaxExempt] = useState(false);
  const [taxExemptMark, setTaxExemptMark] = useState<TaxExemptMark | null>(null);
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
  // "Old card on file?" (OldCardPrompt.tsx), newest first.
  const [oldCardOffers, setOldCardOffers] = useState<{ key: number; offer: OldCardOffer }[]>([]);
  const devices = useDeviceSettings();
  // Where this register prints: its station's printer through the website,
  // or straight to a printer IP (Devices).
  const printTarget = usePrintTarget();
  const readerId = devices.readerId || defaultReaderId;
  // Is this register's card reader up? Checked about once a minute
  // (devices/reader-monitor.ts): a red strip over the order while it's
  // offline, the details under Devices.
  const readerMonitor = useReaderMonitor(readerId || null);
  const readerDown = !!readerId && readerNeedsLook(readerMonitor.health);
  const checkReader = readerMonitor.check;
  // A charge couldn't start because the reader is offline: the customer
  // screen says it's waking up (never an error in front of the guest).
  const [readerWaking, setReaderWaking] = useState(false);
  const onReaderOffline = useCallback(
    (offline: boolean) => {
      setReaderWaking(offline);
      if (offline) checkReader();
    },
    [checkReader],
  );
  // A card payment waiting on the reader (PaymentModal): the customer
  // screen says "Finish on the card reader".
  const [readerPrompt, setReaderPrompt] = useState<ReaderPrompt | null>(null);
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
  // The last organization visit recorded (Record visit): its slip, to
  // print again.
  const [visitSlip, setVisitSlip] = useState<VisitSlip | null>(null);
  // The last sale's movie tickets, kept for "Reprint last tickets".
  const [lastTickets, setLastTickets] = useState<{ orderNumber: number; lines: TicketSale[] } | null>(null);
  const [busy, setBusy] = useState(false);
  // The owner rate (lib/register-totals.ts): the "Owner rate" tick, shown
  // only while an owner's own member account is on the order. ownerFor: the
  // member it was ticked for (another member on the order turns it off).
  // It never changes the order's own prices (a tab saves those), only what's
  // charged, so unticking puts the order straight back to menu prices.
  // ownerQuote: the server's prices for the order as it was (cartKey); the
  // register asks again whenever the order changes.
  const [ownerFor, setOwnerFor] = useState<string | null>(null);
  const [ownerQuote, setOwnerQuote] = useState<{ cartKey: string; memberId: string; q: Extract<OwnerRateQuote, { ok: true }> } | null>(null);

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
    // The Bar tab's cocktails start on their first page again.
    setBarPage(0);
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
    // The Day pass isn't on a button (its Tickets category is off the
    // register), but organization comps still need to know it's the Day pass.
    if (dayPass && !byId.has(dayPass.id)) byId.set(dayPass.id, dayPass);
    return (id: string | null) => (id ? (byId.get(id) ?? null) : null);
  }, [categories, dayPass]);
  const builderItem = findItem(builderItemId);
  // A menu button's tap, wherever it is (a tile, the Bar tab): its choices,
  // or for an 86'd item the question first (sell anyway, or it's back).
  // double: rung up as a double from a Bar Book card or "What's in it?".
  function tapItem(id: string, double = false) {
    setBuilderDouble(double);
    if (outs.get(id)) setOutPromptId(id);
    else setBuilderItemId(id);
  }
  // The bar's category draws as the one-screen Bar tab (BarTab.tsx).
  const barTab = !!category && isBarCategory(category) && !builderItem && categoryId !== MOVIES_TAB && categoryId !== CUSTOMERS_TAB;

  // The Bar Book (BarBook.tsx): read when the Bar tab first shows, and again
  // each time it opens. Until the Bar Book migration is applied it reports
  // not ready and the Bar tab shows no book button.
  const [book, setBook] = useState<{ state: "idle" | "ready" | "not-ready" | "error"; recipes: BookRecipe[]; stock: BookStock[]; target: number }>({
    state: "idle",
    recipes: [],
    stock: [],
    target: 0.2,
  });
  const [bookOpen, setBookOpen] = useState(false);
  const [whatsOpen, setWhatsOpen] = useState(false); // "What's in it?"
  // What the Bar tab's "Find a drink" box opened the book searching for.
  const [bookQuery, setBookQuery] = useState("");
  // Which page of cocktails the Bar tab is on: kept here, so ringing a
  // drink up (its choices replace the tab for a moment) or a change to the
  // order doesn't lose it. Only switching tabs starts it over (pickTab).
  const [barPage, setBarPage] = useState(0);
  const [bookLoading, setBookLoading] = useState(false);
  const bookAsked = useRef(false);
  // State changes only once the answer is back (the opening tap shows
  // "checking stock" itself).
  const refreshBook = useCallback(() => {
    loadBarBook()
      .then(
        (r) =>
          setBook((prev) =>
            r.ok
              ? { state: "ready", recipes: r.recipes, stock: r.stock, target: r.target }
              : prev.state === "ready" && !r.notReady
                ? prev
                : { state: r.notReady ? "not-ready" : "error", recipes: [], stock: [], target: prev.target },
          ),
        () => setBook((prev) => (prev.state === "ready" ? prev : { ...prev, state: "error" })),
      )
      .finally(() => setBookLoading(false));
  }, []);
  useEffect(() => {
    if (!barTab || bookAsked.current) return;
    bookAsked.current = true;
    refreshBook();
  }, [barTab, refreshBook]);
  // The book rings up register items, so it knows only the alcohol ones
  // that are on the register (not hidden), with where each sits on the Bar
  // tab (the cocktails make the card's average pour cost).
  const bookMenu = useMemo<MenuRef[]>(() => {
    const list: MenuRef[] = [];
    for (const c of categories) {
      const bar = isBarCategory(c);
      for (const i of c.items) if (i.is_alcohol) list.push({ id: i.id, name: i.name, price: Number(i.price), section: "other" });
      for (const sub of c.subcategories) {
        const section = bar ? barSectionOf(sub) : "other";
        for (const i of sub.items) if (i.is_alcohol) list.push({ id: i.id, name: i.name, price: Number(i.price), section });
      }
    }
    return list;
  }, [categories]);
  // ---------- doubles and drink icons on the order ----------
  // Where each menu item sits on the Bar tab (beer, wine, cocktails,
  // shots, other), or null outside the bar.
  const sectionById = useMemo(() => {
    const m = new Map<string, BarSection | null>();
    for (const c of categories) {
      const bar = isBarCategory(c);
      for (const i of c.items) m.set(i.id, bar ? "other" : null);
      for (const sub of c.subcategories) for (const i of sub.items) m.set(i.id, bar ? barSectionOf(sub) : null);
    }
    return m;
  }, [categories]);
  const recipeLinesOf = (r: Recipe | undefined): DoubleLine[] | null =>
    r ? r.ingredients.map((i) => ({ name: i.ingredient_name, quantity: i.quantity, unit: i.unit, kind: i.kind ?? null, optional: i.optional === true })) : null;
  // How a line would be doubled (or poured neat or on the rocks), or null
  // when it can't be: a menu drink by its section, name and recipe, a Bar
  // Book drink and a custom drink by their own lists. A plain custom item
  // never is (nobody knows what's in it).
  function lineDoubleCtx(line: CartLine): DoubleContext | null {
    if (line.screeningId || !line.isAlcohol) return null;
    if (line.menuItemId) {
      const item = findItem(line.menuItemId);
      if (!item) return null;
      const groups = item.modifier_groups;
      const ownServe = hasOwnServe(groups);
      return {
        isAlcohol: item.is_alcohol,
        section: sectionById.get(item.id) ?? null,
        ownDouble: hasOwnDouble(groups),
        recipe: recipeLinesOf(recipesByItem[item.id]),
        name: item.name,
        liquor: hasLiquorChoice(groups),
        ownServe,
        serve: serveOf(line.mods, ownServe),
      };
    }
    if (line.recipeId) {
      const r = book.recipes.find((x) => x.id === line.recipeId);
      return { isAlcohol: true, section: "cocktails", ownDouble: false, recipe: r ? r.lines : null };
    }
    if (line.customRecipe?.length) {
      const byId = new Map(book.stock.map((x) => [x.id, x]));
      const lines = line.customRecipe.flatMap((c) => {
        const st = byId.get(c.ingredient_id);
        return st ? [{ name: st.name, quantity: c.quantity, unit: st.unit ?? "oz", kind: st.kind ?? null }] : [];
      });
      return { isAlcohol: true, section: "other", ownDouble: false, recipe: lines.length ? lines : null };
    }
    return null;
  }
  // A drink's icon on its order line.
  function lineIcon(line: CartLine): IconSpec | null {
    if (!line.isAlcohol) return null;
    if (line.menuItemId) {
      const section = sectionById.get(line.menuItemId);
      if (!section) return null;
      return itemIconSpec(recipesByItem[line.menuItemId], section);
    }
    if (line.recipeId) {
      const r = book.recipes.find((x) => x.id === line.recipeId);
      return r ? iconSpecFor({ glassware: r.glassware, garnishes: r.garnishes, ice: r.ice, ingredients: r.lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, family: l.family, kind: l.kind })) }) : null;
    }
    if (line.customRecipe?.length) {
      const byId = new Map(book.stock.map((x) => [x.id, x]));
      const picked = line.customRecipe.flatMap((c) => {
        const st = byId.get(c.ingredient_id);
        return st ? [{ id: st.id, name: st.name, unit: st.unit ?? "oz", family: st.family ?? null, kind: st.kind ?? null, amount: c.quantity }] : [];
      });
      return picked.length ? customSpec(picked) : null;
    }
    return null;
  }
  // The order line's chips: Double, and on a Liquor shot Neat or Rocks (one
  // choice: off, Neat or Rocks). A change takes what the line's options
  // added off its price and puts the new ones' on, with "Double", "Neat" or
  // "On the rocks" on the line. Taxed and discounted like anything else.
  function setLineOptions(key: string, change: (cur: { serve: Serve | null; double: boolean }) => { serve: Serve | null; double: boolean }) {
    setCart((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const ctx = lineDoubleCtx(l);
        if (!ctx) return l;
        const cur = { serve: ctx.serve ?? null, double: !ctx.ownDouble && isDouble(l.mods) };
        const next = change(cur);
        const was = optionsUpcharge(ctx, cur, doubleSettings);
        const now = optionsUpcharge(ctx, next, doubleSettings);
        if (was === null || now === null) return l;
        const rest = l.mods.filter((m) => !(m === DOUBLE && !ctx.ownDouble) && !(isServeMod(m) && !ctx.ownServe));
        const mods = [...rest, ...(next.serve ? [SERVE_MOD[next.serve]] : []), ...(next.double ? [DOUBLE] : [])];
        return { ...l, unit: Math.round((l.unit - was + now) * 100) / 100, mods };
      }),
    );
  }
  // A double picked on a Bar Book card or "What's in it?" before ringing a
  // menu drink up: the choices sheet opens with Double already on.
  const [builderDouble, setBuilderDouble] = useState(false);

  const bookMakeable = useMemo(() => {
    if (book.state !== "ready") return 0;
    return countMakeable(book.recipes, book.stock, bookMenu);
  }, [book, bookMenu]);
  const outPromptItem = findItem(outPromptId);
  const outPrompt = outPromptItem ? (outs.get(outPromptItem.id) ?? null) : null;

  // The owner rate: the tick shows only for an owner's own account on the
  // order. Ticked, the order is priced by the server (each line's owner
  // price and how it was priced, taxed, nothing else off) for the order as
  // it is now; while a changed order is being priced again (ownerPending),
  // it can't be paid. Member perks, an organization's comps and tax-included
  // pricing are off while it's on, and the organization's banner (and its
  // manager override) is hidden, so they can't be turned on.
  const isOwnerAccount = !!memberId && ownerMembers.includes(memberId);
  const ownerTicked = isOwnerAccount && ownerFor === memberId;
  const cartKeyNow = ownerCartKey(cart);
  const ownerRate = ownerTicked && ownerQuote && ownerQuote.memberId === memberId && ownerQuote.cartKey === cartKeyNow ? ownerQuote.q : null;
  const ownerPending = ownerTicked && !ownerRate && cart.length > 0;
  const ownerLines = ownerRate ? ownerRate.lines : null;
  const ownerTotals = ownerRate ? ownerRate.totals : null;
  // Ticked, and the order isn't the one priced last: ask the server again.
  // If it can't be rung at the owner rate, the tick comes off and says why.
  useEffect(() => {
    if (!ownerTicked || !memberId || cart.length === 0) return;
    if (ownerQuote && ownerQuote.memberId === memberId && ownerQuote.cartKey === cartKeyNow) return;
    let live = true;
    const key = cartKeyNow;
    const forMember = memberId;
    quoteOwnerRate(forMember, currentFields().lines).then(
      (q) => {
        if (!live) return;
        if (q.ok) return setOwnerQuote({ cartKey: key, memberId: forMember, q });
        setOwnerFor(null);
        setToast(q.error);
      },
      () => {
        if (!live) return;
        setOwnerFor(null);
        setToast("Couldn't get the owner prices. Check the connection and tick Owner rate again.");
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerTicked, memberId, cartKeyNow]);
  // The tick: on, the member perks, tax exempt and an organization's
  // override come off (they don't go with it); off, the order is back to
  // its normal prices.
  function tickOwnerRate(on: boolean) {
    if (!on || !memberId) return setOwnerFor(null);
    setOwnerFor(memberId);
    setMonthlyMember(false);
    setPointsRedeemed(false);
    setTaxFree(false);
    setOrgApproval(null);
  }
  // A line can be the free coffee if its item is ticked as a daily coffee
  // (Back office -> Menu): its menu price comes off, its add-ons don't.
  // An organization member's comps: their day pass and one ticket per
  // showing, at $0 (lib/orgs.ts).
  const compLines = cart.map((l) => ({ dayPass: !l.screeningId && isDayPassName(findItem(l.menuItemId)?.name), screeningId: l.screeningId ?? null, qty: l.qty, unit: l.unit }));
  const memberCompPlan = orgCompPlan(compLines, ownerTicked ? null : orgOnOrder, orgOverride);
  // Organization guests with no account: a day pass each, their tickets,
  // and tax-included pricing while the cashier leaves it on.
  const orgGroup = groupState && groupState.key === activeTabId ? groupState.g : null;
  const groupOverride = !!orgGroup && orgApproval?.orgId === orgGroup.orgId;
  const groupPlan = groupCompPlan(compLines, ownerTicked ? null : orgGroup, groupOverride, memberCompPlan.comps);
  const compPlan = joinPlans(memberCompPlan, groupPlan);
  const compOrgName = orgOnOrder?.orgName ?? orgGroup?.orgName;
  const totalsLines = cart.map((l, i) => {
    const item = findItem(l.menuItemId);
    return { unit: l.unit, qty: l.qty, perkBase: item?.daily_perk ? Number(item.price) : null, comp: compPlan.comps[i], giftCard: isGiftCardLine(l) };
  });
  // At the owner rate, what's charged is the server's owner prices, taxed,
  // with nothing else off.
  const totals = ownerRate
    ? ownerOrderTotals(ownerRate.lines.map((l) => ({ unit: l.unit_price, qty: l.quantity, giftCard: isGiftCardLine(l) })))
    : registerTotals(totalsLines, member, monthlyOn, taxFree, pointsRedeemed, coffeeOn, { taxIncluded: !ownerTicked && (orgTaxIncluded || groupTaxIncluded(orgGroup)) });
  const menuSubtotal = cents(cart.reduce((s, l) => s + l.unit * l.qty, 0));
  // Whose comps the manager PIN is for: the group's when they're the
  // blocked ones, else the member's.
  const pinOrg = groupPlan.blocked && orgGroup ? orgGroup : orgOnOrder;
  // An organization group's visit with nothing to pay: every line is the
  // group's comp and the total is $0. "Record visit" saves it like a $0
  // cash sale (same comps, same order), with no payment screen, tip, age
  // check or drawer, and prints a visit slip. A member on the order, a tab,
  // the owner rate or anything paid keeps the normal Complete order.
  const visitOnly =
    !!orgGroup && !member && !activeTabId && !ownerTicked && cart.length > 0 && !groupPlan.blocked && Math.abs(totals.total) < 0.005 && cart.every((l, i) => (groupPlan.comps[i] ?? 0) >= l.qty);
  // Any order (or tab) whose total is $0.00: a points reward covering it,
  // comps, the owner rate at 100% off, a free ticket. Nothing to pay, so
  // "Complete order ($0)" saves it like Cash for $0 on the payment screen
  // (same payment record), with no payment screen, tip, reader or drawer.
  // Alcohol still gets the 21+ check.
  const zeroTotal = cart.length > 0 && Math.abs(totals.total) < 0.005;
  const setOrgGroup = (g: OrgGroupOnOrder | null) => setGroupState(g ? { key: activeTabId, g } : null);
  // A new group: its day passes go on the order (the Day pass menu item).
  function applyOrgGroup(g: OrgGroupOnOrder) {
    setGroupPickerOpen(false);
    setOrgGroup(g);
    if (g.groupId) return setToast(`${g.orgName} group (today) is on the order: no new comps.`);
    const pass = dayPass ?? categories.flatMap((c) => [...c.items, ...c.subcategories.flatMap((s) => s.items)]).find((i) => isDayPassName(i.name));
    if (!pass) return setToast("There's no Day pass on the menu to comp. Add one in Back office → Menu.");
    const n = groupPeople(g);
    setCart((prev) => [...prev, { key: `${Date.now()}-${Math.random()}`, menuItemId: pass.id, name: pass.name, unit: Number(pass.price), qty: n, mods: [], isAlcohol: false }]);
  }
  // The line it would go on, whether or not it's on: "Use it" puts it back.
  const coffeePick = coffeeToday && !coffeeToday.usedAt ? dailyPerkPick(totalsLines) : null;
  const itemCount = cart.reduce((s, l) => s + l.qty, 0);
  const activeTab = activeTabId ? openTabs.find((t) => t.id === activeTabId) : null;
  // Anything on the order at all, rung up or not: Clear takes it all off.
  const onOrder = cart.length > 0 || !!member || !!orderName.trim() || taxFree || monthlyMember || pointsRedeemed || !!orgGroup;
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
      taxExempt: taxFree ? taxExemptMark : null,
      monthlyMember: monthlyOn,
      pointsRedeemed,
      station: devices.station,
      orgGroup: orgGroup ? groupInput(orgGroup) : null,
      // The lines stay as rung (menu prices): the server prices them.
      ...(ownerTicked ? { ownerRate: true } : {}),
      lines: cart.map((l) => ({
        menu_item_id: l.menuItemId,
        name: l.name,
        unit_price: l.unit,
        quantity: l.qty,
        modifiers: l.mods,
        is_alcohol: l.isAlcohol,
        screening_id: l.screeningId ?? null,
        ...(l.recipeId ? { recipe_id: l.recipeId } : {}),
        ...(l.customRecipe?.length ? { custom_recipe: l.customRecipe } : {}),
        ...(l.rewardId ? { reward_id: l.rewardId } : {}),
        ...(l.giftMemberId && isGiftCardLine(l) ? { gift_member_id: l.giftMemberId } : {}),
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
        recipeId: l.recipe_id ?? null,
        customRecipe: l.custom_recipe?.length ? l.custom_recipe.map((c) => ({ ingredient_id: c.ingredient_id, quantity: c.quantity })) : null,
        ...(l.reward_id ? { rewardId: l.reward_id, rewardPoints: rewardPointsOf(l.name), rewardMember: f.member?.id ?? null } : {}),
        ...(l.gift_member_id ? { giftMemberId: l.gift_member_id } : {}),
      }))
    );
    setOrderName(f.order_name ?? "");
    setMember(f.member);
    setTaxFree(f.tax_free);
    setTaxExemptMark(f.tax_exempt);
    setMonthlyMember(f.monthly_member);
    setPointsRedeemed(f.points_redeemed);
    setCoffeeOffFor(null);
    setOwnerFor(null);
  }

  function addLine(line: BuiltLine) {
    setCart((prev) => [...prev, { key: `${Date.now()}-${Math.random()}`, ...line }]);
    setBuilderItemId(null);
  }

  function updateQty(key: string, delta: number) {
    // Minus on the last one takes the line off, same as the ×. A reward
    // line stays one: another is another tap on the customer screen.
    setCart((prev) => prev.flatMap((l) => (l.key !== key ? [l] : l.qty + delta <= 0 ? [] : l.rewardId && delta > 0 ? [l] : [{ ...l, qty: l.qty + delta }])));
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

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
  }, [activeTabId, cart, orderName, taxFree, taxExemptMark, monthlyOn, pointsRedeemed, memberId, coffeeOn, compPlan.amount, orgTaxIncluded, totals.taxIncluded, !!ownerRate]);

  // Mirrors the cart onto the customer-facing kiosk display in real time,
  // via Realtime broadcast rather than a database row -- entirely separate
  // from the draft/tab persistence above, so this can't affect payment or
  // order-history logic. cartSnapshotRef always holds the latest snapshot
  // (written after every render by the effect under cartSnapshot, which
  // runs before the effects that read it: the debounced broadcast-on-change
  // effect below and the request-state handler in the subscribe effect),
  // which avoids a stale closure in the long-lived channel subscription.
  const cartSnapshotRef = useRef<RegisterCartSnapshot>(EMPTY_CART_SNAPSHOT);
  const finalizingRef = useRef(false);
  // Points this order spends once it's paid: its reward lines (Spend points
  // on the customer screen) and the $5 off.
  const rewardLines = cart.filter((l) => l.rewardId);
  const discountOn = pointsRedeemed && totals.redemptionDiscount > 0;
  const orderRewardPoints = rewardLines.reduce((s, l) => s + (l.rewardPoints ?? 0) * l.qty, 0) + (discountOn ? totals.redemptionPoints : 0);
  // A card sale that was charged but didn't save (kept across reloads).
  const unsavedSale = useUnsavedSale();
  // "Put a card on file?" for a tab (right after opening it, or from its chip).
  const [tabCardFor, setTabCardFor] = useState<{ id: string; name: string } | null>(null);
  const cartSnapshot: RegisterCartSnapshot = ownerTotals
    ? {
        // The owner rate: the menu prices, the owner rate as what came off
        // them, and the owner's total. No member perks or points with it.
        orderName,
        items: cart.map((l) => ({ name: l.name, quantity: l.qty, modifiers: l.mods, lineTotal: Math.round(l.unit * l.qty * 100) / 100 })),
        subtotal: menuSubtotal,
        tax: ownerTotals.tax,
        total: ownerTotals.total,
        discounts: [{ label: `Owner rate (${OWNER_RATE_NAME})`, amount: cents(menuSubtotal - ownerTotals.subtotal) }].filter((d) => d.amount > 0),
        member: null,
        pointsToEarn: 0,
      }
    : {
    orderName,
    items: cart.map((l) => ({ name: l.name, quantity: l.qty, modifiers: l.mods, lineTotal: Math.round(l.unit * l.qty * 100) / 100 })),
    subtotal: totals.subtotal,
    tax: totals.tax,
    taxIncluded: totals.taxIncluded,
    total: totals.total,
    // The customer screen's live tally: savings, whose order it is, and the
    // points it earns (1 per $1 after discounts, as completeOrder pays).
    discounts: [
      { label: compOrgName ? `${compOrgName} comp` : "Comp", amount: totals.orgCompDiscount },
      { label: DAILY_COFFEE_LINE, amount: totals.dailyPerkDiscount },
      // Named for the guest: "Insiders+ 10% off" is the perk they see applied.
      { label: isPlus && !member?.legacyUnlimited ? `Insiders+ ${Math.round(memberDiscountRate(member) * 100)}% off` : "Member discount", amount: totals.tierDiscount },
      { label: "Monthly member discount", amount: totals.monthlyDiscount },
      { label: rewardLabel(totals.redemptionDiscount), amount: totals.redemptionDiscount },
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
          rewardPoints: orderRewardPoints,
          rewards: rewardLines.map((l) => ({ id: l.rewardId as string, qty: l.qty })),
        }
      : null,
    pointsToEarn: Math.round(pointsEarned(totalsPayload(totals))),
    // The payment screen is up: "ready to pay" on the customer screen.
    paying: payOpen,
    readerWaking: payOpen && readerWaking,
    reader: payOpen && readerPrompt ? readerPrompt : null,
  };
  useEffect(() => {
    cartSnapshotRef.current = cartSnapshot;
  });
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
  // "Charge card on file": the guest's yes on the customer screen
  // (PaymentModal asks; "cof-seen" and "cof-answer" come back here).
  const cofHandler = useRef<CardOnFileListener | null>(null);
  const cofLink = useMemo<CardOnFileLink>(
    () => ({
      send: (event, payload) => registerChannelRef.current?.send({ type: "broadcast", event, payload }),
      listen: (h) => {
        cofHandler.current = h;
      },
    }),
    [],
  );
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

  // "Spend points" on the customer screen: the guest tapped Use on a good
  // (or the $5 off). The server checks it (still offered, within its
  // limits, covered after what this order already uses) and it goes on as a
  // $0 line, "Reward: Personal popcorn (−40 pts)", with no PIN; its points
  // come off when the sale is saved, so taking the line off or cancelling
  // costs them nothing. Staff get a note (an alcohol reward: check ID, as
  // the pay screen asks anyway). The screen hears back either way.
  const onRewardAdd = useEffectEvent(async (p: unknown) => {
    const a = parseRewardAdd(p);
    if (!a) return;
    const reply = (ok: boolean, message: string) => {
      const answer: RewardAdded = { id: a.id, ok, message };
      registerChannelRef.current?.send({ type: "broadcast", event: "reward-added", payload: answer });
    };
    if (!member || firstNameFor(member.name) !== a.firstName) return reply(false, "Ask at the bar to put you on the order first.");
    if (ownerTicked) return reply(false, "Rewards don't go on this order. Ask at the bar.");
    if (payOpen) return reply(false, "Your order is being paid. Use it on your next one.");
    const who = member;
    let r: Awaited<ReturnType<typeof checkOrderReward>>;
    try {
      r = await checkOrderReward({
        memberId: who.id,
        rewardId: a.rewardId,
        pending: rewardLines.map((l) => ({ rewardId: l.rewardId as string, qty: l.qty })),
        pendingPoints: orderRewardPoints,
        discountOn,
      });
    } catch {
      return reply(false, "That didn't go through. Ask at the bar.");
    }
    if (!r.ok) return reply(false, r.error);
    if (memberNow.current?.id !== who.id) return reply(false, "Ask at the bar to put you on the order first.");
    const reward = r;
    if (reward.kind === "discount") setPointsRedeemed(true);
    else {
      setCart((prev) => [
        ...prev,
        {
          key: `${Date.now()}-${Math.random()}`,
          menuItemId: null,
          name: reward.lineName,
          unit: 0,
          qty: 1,
          mods: [],
          isAlcohol: reward.isAlcohol,
          rewardId: reward.rewardId,
          rewardPoints: reward.points,
          rewardMember: who.id,
        },
      ]);
    }
    const message = `${who.name} used ${reward.points} points: ${reward.name}${reward.isAlcohol ? ". Check their ID" : ""}.`;
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? null : t)), 10_000);
    reply(true, reward.kind === "discount" ? "$5 off is on your order." : `${reward.name} is on your order.`);
  });

  // A perk unlocked on the customer screen: their points and card again.
  const onRewardsChanged = useEffectEvent((p: { firstName?: unknown } | null) => {
    if (!member || p?.firstName !== firstNameFor(member.name)) return;
    const id = member.id;
    getPosMember(id).then(
      (m) => {
        if (m && memberNow.current?.id === id) setMember(m);
      },
      () => {},
    );
    setCardTry((n) => n + 1);
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
      .on("broadcast", { event: "reward-add" }, (msg) => void onRewardAdd(msg.payload))
      .on("broadcast", { event: "rewards-changed" }, (msg) => onRewardsChanged(msg.payload))
      .on("broadcast", { event: "rickroll-state" }, (msg) => onRickrollState(msg.payload))
      .on("broadcast", { event: "cof-seen" }, (msg) => {
        const id = msg.payload?.id;
        if (typeof id === "string") cofHandler.current?.seen(id);
      })
      .on("broadcast", { event: "cof-answer" }, (msg) => {
        const a = parseCardOnFileAnswer(msg.payload);
        if (a) cofHandler.current?.answer(a);
      })
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
  }, [cart, orderName, totals.subtotal, totals.tax, totals.total, totals.discount, member, coffeeToday, tabletProfile, payOpen, readerWaking, readerPrompt, ownerTotals?.total]);

  function resetOrder() {
    setCart([]);
    setOrderName("");
    setMember(null);
    setTaxFree(false);
    setTaxExemptMark(null);
    setMonthlyMember(false);
    setPointsRedeemed(false);
    setActiveTabId(null);
    setGroupState(null);
    // Looked up again for the next order: a coffee just used shows as used.
    setCoffee(null);
    setCoffeeOffFor(null);
    setOwnerFor(null);
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

  async function handleTaxExempt(reason: TaxExemptReason, note: string, pin: string) {
    const r = await approveTaxExempt({ pin, tabId: activeTabId, cashierId: employeeId || null, reason, note });
    if (!r.ok) throw new Error(r.error); // shown in the box
    setTaxExemptMark(r.mark);
    setTaxFree(true);
    setAskTaxExempt(false);
    setToast(`Tax exempt. ${approvalText(r)}`);
    setTimeout(() => setToast(null), 7000);
  }

  // rewardsApproved: a manager's PIN let short rewards through just now.
  async function startCheckout(rewardsApproved = false) {
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
    // Reward lines from Spend points, all checked together before anyone
    // pays. One that's short needs a manager PIN to go ahead. If the check
    // can't run, the sale goes ahead (the save still checks and flags).
    const rewardsOnOrder = cart.filter((l) => l.rewardId).map((l) => ({ rewardId: l.rewardId as string, qty: l.qty }));
    if (rewardsOnOrder.length && memberId && !rewardsApproved) {
      setBusy(true);
      const rc = await checkRewardsBeforePay({ memberId, rewards: rewardsOnOrder, discountOn: pointsRedeemed && totals.redemptionDiscount > 0, discountPoints: totals.redemptionPoints }).catch(() => null);
      setBusy(false);
      if (rc && !rc.ok) return setRewardPin(rc.problems);
    }
    // A points reward the member no longer has the points for, or a daily
    // coffee they've already had today (on the other register, say), comes
    // off before anyone pays. If the check can't run, the sale goes ahead.
    // An organization comp is checked again too: the other register may
    // have used today's last one.
    // The owner rate is checked too: the owner's account, and the server's prices.
    if ((pointsRedeemed && totals.redemptionDiscount > 0) || totals.dailyPerkDiscount > 0 || totals.orgCompDiscount > 0 || ownerTicked || ENFORCE_REGISTER_TOTALS) {
      setBusy(true);
      const r = await checkBeforePayment(currentFields(), totalsPayload(totals), orgOverride || groupOverride ? orgApproval?.token : null).catch(() => null);
      setBusy(false);
      if (r && !r.ok) {
        // The other register used the last comp: look again (the order
        // shows it's full, with the manager override).
        if (r.orgFull) setOrgTry((n) => n + 1);
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
    if (visitOnly && orgGroup) return recordVisit(orgGroup);
    if (zeroTotal) {
      setTip(0);
      setTipAsked(false);
      if (cart.some((l) => l.isAlcohol)) return setAgeConfirmOpen(true);
      return completeZeroOrder();
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
    if (hasAlcohol) {
      setAgeConfirmOpen(true);
    } else setPayOpen(true);
  }

  // A $0.00 order: saved with the payment Cash for $0 gives (cash 0, card
  // 0), so reports, the drawer count and tax are the same. No cash taken,
  // so no drawer; the receipt prints per the auto-print setting.
  function completeZeroOrder() {
    void finalizeCheckout({ method: "cash", cash: 0, card: 0 });
  }

  // Record visit: the group's $0 order, saved as a $0 cash sale with no
  // cash taken (so no drawer), and its slip.
  function recordVisit(g: OrgGroupOnOrder) {
    const people = groupPeople(g);
    const movies = [...new Set(cart.filter((l) => l.screeningId).map((l) => l.name))];
    void finalizeCheckout({ method: "cash", cash: 0, card: 0 }, undefined, {
      orgName: g.orgName,
      supported: g.supported,
      helpers: g.helpers,
      used: g.groupId ? g.used : g.used + people,
      limit: g.limit,
      movies,
    });
  }

  // A gift card slip for each card sold: printed whatever the receipt
  // setting (it's what gets handed over). Without a printer, the codes are
  // in the sale's note on screen.
  async function printGiftSlips(cards: IssuedGiftCard[], orderNumber: number, at: string) {
    if (!printTarget || !cards.length) return;
    const xml = cards.map((c) => giftCardSlipXml({ code: c.code, amount: c.amount, member: c.member, orderNumber, at }));
    const r = await sendPrint(printTarget, "receipt", xml, `Gift card slip${cards.length === 1 ? "" : "s"} #${orderNumber}`);
    if (!r.ok) setPrintNote(`Gift card slip didn't print: ${r.error}. The code${cards.length === 1 ? " is" : "s are"} ${cards.map((c) => c.code).join(", ")}.`);
  }

  async function printVisitSlip(slip: VisitSlip, again = false) {
    if (!printTarget) return;
    const r = await sendPrint(printTarget, "receipt", visitSlipXml(slip), `Visit slip #${slip.orderNumber}${again ? " (again)" : ""}`);
    setPrintNote(r.ok ? null : `Visit slip didn't print: ${r.error}`);
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
        ? await sendPrint(printTarget, "receipt", await customerReceipt(receipt, { openDrawer, flourish: surprise, claimUrl }), `Receipt #${receipt.orderNumber}`)
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
      orgApproval: orgOverride || groupOverride ? (orgApproval?.token ?? null) : null,
    };
  }

  // A payment just sent to the reader: kept in this browser until it's
  // saved or canceled, so a reload mid-payment can still find it (see
  // recoverReaderPayments).
  function keepReaderPayment(payment: CheckoutPayment) {
    if (readerId) keepPendingReaderSale({ readerId, order: orderFor(payment), memberName: member?.name ?? null, startedAt: Date.now() });
  }
  // A member's card on file, about to be charged (no reader, and the amount
  // and tip are already final): kept the same way.
  function keepCardOnFilePayment(payment: CheckoutPayment) {
    keepPendingReaderSale({ readerId: readerId ?? "", order: orderFor(payment), memberName: member?.name ?? null, startedAt: Date.now(), final: true });
  }

  async function finalizeCheckout(payment: CheckoutPayment, note?: string, visit?: VisitDetails) {
    // A double tap (or a second "paid" answer from the reader) must not save
    // or print the sale twice.
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    // The customer screen's "Finish on the card reader" says "Approved"
    // (it ignores this unless that screen is up).
    if (payment.stripePaymentIntentId) sendToTablet("card-approved", {});
    setPayOpen(false);
    setBusy(true);
    try {
      const saved = await saveSale({ order: orderFor(payment), memberName: member?.name ?? null, tries: 0 }, note, visit);
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
  async function saveSale(sale: UnsavedSale, note?: string, visit?: VisitDetails): Promise<boolean> {
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
    let soldCards: IssuedGiftCard[] = [];
    let giftLeft: { code: string; balance: number } | undefined;
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
      soldCards = r.giftCards ?? [];
      giftLeft = r.giftCardLeft;
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
    // A card from the old register nobody has claimed? Asked after the sale
    // is saved and never waited on (lib/old-card-offer.ts): a member
    // attached and paid by card on the reader. A plain fetch, not a Server
    // Action, so it can't hold up the next sale.
    const piForOldCard = payment.stripePaymentIntentId;
    if (piForOldCard && order.memberId) {
      fetch("/api/pos/old-card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentIntentId: piForOldCard }), cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<{ offer: OldCardOffer | null }>) : null))
        .then((r) => {
          const offer = r?.offer;
          if (offer) setOldCardOffers((list) => [{ key: Date.now(), offer }, ...list.filter((o) => o.offer.cardId !== offer.cardId)].slice(0, 2));
        })
        .catch(() => {});
    }
    const receipt: ReceiptData = {
      orderNumber,
      at: new Date().toISOString(),
      cashier: employees.find((e) => e.id === order.employeeId)?.name ?? null,
      // Only a member staff attached. One found by the card isn't printed:
      // whoever paid takes the receipt, and it may not be their card.
      member: sale.memberName,
      orderName: order.orderName.trim() || null,
      // A gift card's line carries its code(s), in the order they were made.
      lines: (() => {
        const codes = soldCards.map((c) => c.code);
        return order.lines.map((l) => ({
          name: l.name,
          qty: l.quantity,
          unit: l.unit_price,
          mods: isGiftCardLine(l) ? [...l.modifiers, ...codes.splice(0, Math.max(0, Math.round(l.quantity))).map((c) => `Code: ${c}`)] : l.modifiers,
        }));
      })(),
      // At the owner rate the lines are at menu prices, and the owner rate is what came off them.
      subtotal: order.ownerRate ? cents(order.lines.reduce((s, l) => s + l.unit_price * l.quantity, 0)) : order.totals.subtotal,
      discounts: [
        { label: `Owner rate (${OWNER_RATE_NAME})`, amount: order.ownerRate ? cents(order.lines.reduce((s, l) => s + l.unit_price * l.quantity, 0) - order.totals.subtotal) : 0 },
        { label: "Organization comp", amount: order.totals.org_comp_discount ?? 0 },
        { label: DAILY_COFFEE_LINE, amount: order.totals.daily_perk_discount ?? 0 },
        { label: "Member discount", amount: order.totals.tier_discount },
        { label: "Monthly member discount", amount: order.totals.monthly_discount },
        { label: rewardLabel(order.totals.redemption_discount), amount: order.totals.redemption_discount },
      ],
      tax: order.totals.tax,
      taxIncluded: !!order.totals.tax_included,
      tip: allTip,
      total: order.totals.total + allTip,
      payments: [
        { label: "Voucher", amount: payment.voucher ?? 0 },
        ...(payment.giftCard && payment.giftCard.amount > 0 ? [{ label: `Gift card ..${giftCodeTail(payment.giftCard.code)}`, amount: payment.giftCard.amount }] : []),
        ...(giftLeft ? [{ label: `Left on gift card ..${giftCodeTail(giftLeft.code)}`, amount: giftLeft.balance }] : []),
        { label: "Cash", amount: payment.cash },
        { label: "Card", amount: payment.card },
        ...(change > 0 ? [{ label: "Cash given", amount: payment.tendered ?? 0 }, { label: "Change", amount: change }] : []),
      ],
      points: { earned: order.ownerRate ? 0 : pointsEarned(order.totals), rewardUsed: order.pointsRedeemed && order.totals.redemption_discount > 0, rewardPoints: order.pointsRedeemed ? rewardPointsFor(order.totals.redemption_discount) : 0 },
    };
    setLastReceipt(receipt);
    const tickets: TicketSale[] = order.lines.filter((l) => l.screening_id).map((l) => ({ screeningId: l.screening_id as string, qty: l.quantity }));
    setLastTickets(tickets.length ? { orderNumber, lines: tickets } : null);
    if (visit) {
      // A visit: its slip prints (whatever the receipt setting: it's the
      // point), then any tickets. No receipt, no drawer.
      const slip: VisitSlip = { ...visit, orderNumber, at: receipt.at };
      setVisitSlip(slip);
      void (async () => {
        setPrintNote(null);
        await printVisitSlip(slip);
        if (printTarget && devices.printTickets && tickets.length) {
          const t = await printTickets(printTarget, orderNumber, tickets);
          if (!t.ok) setPrintNote(`Tickets didn't print: ${t.error}`);
        }
      })();
      setToast(`Visit recorded for ${visit.orgName} — Order #${orderNumber}, no charge.${warning ? ` ${warning}` : ""}`);
      router.refresh();
      setTimeout(() => setToast(null), warning ? 30000 : 7000);
      return true;
    }
    setVisitSlip(null);
    void printAfterSale(receipt, payment.cash > 0, tickets).then(() => printGiftSlips(soldCards, orderNumber, receipt.at));
    const noCharge = Math.abs(order.totals.total + allTip) < 0.005;
    const parts = [noCharge ? `Order #${orderNumber} complete — no charge` : `Order #${orderNumber} complete — ${money(order.totals.total + allTip)} charged (${payment.method})`];
    if (allTip > 0) parts.push(`${money(allTip)} tip`);
    if (payment.voucher && payment.method !== "voucher") parts.push(`${money(payment.voucher)} in vouchers`);
    if (payment.giftCard && payment.giftCard.amount > 0) parts.push(`${money(payment.giftCard.amount)} on gift card ..${giftCodeTail(payment.giftCard.code)}${giftLeft ? ` (${money(giftLeft.balance)} left on it)` : ""}`);
    for (const c of soldCards) parts.push(`gift card ${c.code} (${money(c.amount)}) made`);
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
            {/* Orders from guests' phones (SeatOrders.tsx). */}
            <SeatOrdersButton />
            <button className={`chip min-h-11 shrink-0 whitespace-nowrap !px-3 !py-1.5 text-sm ${heldListOpen ? "chip-selected" : ""}`} onClick={() => setHeldListOpen((v) => !v)}>
              Held {heldOrders.length}
            </button>
            <button className={`chip min-h-11 shrink-0 whitespace-nowrap !px-3 !py-1.5 text-sm ${tabsListOpen ? "chip-selected" : ""}`} onClick={() => setTabsListOpen((v) => !v)}>
              Tabs {openTabs.length}
            </button>
          </div>

          {/* One thin line, only while the reader is offline; clears by
              itself when it's back. Tap to check again. */}
          {readerDown && (
            <button
              className="notice notice-warn mb-2 flex w-full items-center gap-2 !px-3 !py-1.5 text-left text-xs font-semibold"
              style={{ borderColor: "var(--danger-text)", color: "var(--danger-text)" }}
              disabled={readerMonitor.checking}
              onClick={() => checkReader(true)}
              role="status"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: "var(--danger-text)" }} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{READER_OFFLINE_MESSAGE}</span>
              <span className="shrink-0 underline">{readerMonitor.checking ? "Checking…" : "Check again"}</span>
            </button>
          )}

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
          {oldCardOffers.map((o) => (
            <OldCardPrompt key={o.key} offer={o.offer} onClose={() => setOldCardOffers((list) => list.filter((x) => x.key !== o.key))} />
          ))}
          {visitSlip && (
            <VisitSlipNotice slip={visitSlip} onPrint={printTarget ? () => printVisitSlip(visitSlip, true) : null} onClose={() => setVisitSlip(null)} />
          )}
          {lastReceipt && printTarget && (printNote || (!devices.autoPrint && !visitSlip)) && (
            <div className={`notice ${printNote ? "notice-warn" : ""} flex flex-wrap items-center justify-between gap-2 p-2.5 text-xs`}>
              <span>{printNote ?? `Order #${lastReceipt.orderNumber}`}</span>
              <button
                className="chip !px-3 !py-1"
                onClick={async () => {
                  const r = await sendPrint(printTarget, "receipt", await customerReceipt(lastReceipt), `Receipt #${lastReceipt.orderNumber}`);
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
            cart.map((line, i) => {
              // A drink that can be a double gets its chip (a Liquor shot its
              // Neat and Rocks chips too), and a drink its icon.
              const ctx = lineDoubleCtx(line);
              const doubled = !!ctx && !ctx.ownDouble && isDouble(line.mods);
              const up = ctx ? doubleUpcharge(ctx, doubleSettings) : null;
              return (
                <OrderLineRow
                  key={line.key}
                  line={line}
                  icon={lineIcon(line)}
                  double={ctx && up !== null ? { on: doubled, upcharge: up } : null}
                  serve={ctx && canServe(ctx) ? { value: ctx.serve ?? null, upcharge: doubleSettings.serveUpcharge } : null}
                  freeToday={!ownerLines && i === totals.dailyPerkLine}
                  comp={compPlan.comps[i] > 0 ? compOrgName : null}
                  // With the owner rate on: the server's owner price for this line, the menu price struck through.
                  owner={ownerLines?.[i] ? { unit: ownerLines[i].unit_price, how: ownerLines[i].owner_pricing } : null}
                  onLess={() => updateQty(line.key, -1)}
                  onMore={() => updateQty(line.key, 1)}
                  onRemove={() => removeLine(line.key)}
                  onDouble={() => setLineOptions(line.key, (o) => ({ ...o, double: !o.double }))}
                  onServe={(serve) => setLineOptions(line.key, (o) => ({ ...o, serve }))}
                />
              );
            })
          )}

          {/* The owner rate: whose, and what it means for this order. Member
              perks don't go with it, so their rows are hidden until it's unticked. */}
          {ownerTicked && (
            <div className="rounded-md border-2 px-2.5 py-2 text-xs" style={{ borderColor: "var(--foreground)", background: "var(--gold)", color: "var(--foreground)" }} role="status">
              <div className="flex items-baseline justify-between gap-2">
                <strong className="text-sm">Owner rate{ownerRate ? ` · ${ownerRate.firstName}` : ""} · {OWNER_RATE_NAME}</strong>
                <span className="shrink-0 tabular-nums">menu value {money(menuSubtotal)}</span>
              </div>
              <p className="mt-0.5 leading-snug">
                {ownerRate
                  ? `Menu items at ${OWNER_RATE_NAME}, or half price with no cost on file. Tickets and custom items at their normal price. Taxed as usual; no member discount, daily coffee, reward or points. Paid like any order.`
                  : cart.length
                    ? "Getting the owner prices…"
                    : "Ring the order up: it's priced at the owner rate as it goes."}
              </p>
            </div>
          )}

          {/* The Insiders+ daily coffee: on the order with a way to take it
              off, or off with a way to put it back. */}
          {ownerTicked ? null : memberId && coffeePick && totals.dailyPerkLine !== null ? (
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

          {/* An organization member (lib/orgs.ts): whose, today's comps,
              and what's comped or why not. */}
          {orgOnOrder && !ownerTicked && (
            <div
              className="rounded-md border-2 px-2 py-1.5 text-xs"
              style={{ borderColor: memberCompPlan.blocked ? "var(--danger-text)" : "var(--accent)", color: "var(--foreground)" }}
              role="status"
            >
              <div className="font-bold">
                {orgOnOrder.orgName} · comps today {compCountText(orgOnOrder.used, orgOnOrder.limit)}
                <InfoTip topic="organizations" />
              </div>
              <div style={{ color: "var(--muted)" }}>
                {roleLabel(orgOnOrder.role)}
                {!orgOnOrder.active
                  ? " · this organization is paused, so nothing is comped"
                  : orgOnOrder.personCompedToday
                    ? " · already comped today: their movies today are free"
                    : " · day pass and movies today ring up at $0"}
              </div>
              {memberCompPlan.blocked && (
                <div className="mt-1 flex items-center gap-2">
                  <span className="min-w-0 flex-1 font-semibold" style={{ color: "var(--danger-text)" }}>
                    All {orgOnOrder.limit} comps are used today, so the day pass and tickets are charged.
                  </span>
                  <button className="btn-secondary shrink-0 !px-2.5 !py-1.5 !text-xs" onClick={() => setOrgPinOpen(true)}>
                    Manager override
                  </button>
                </div>
              )}
              {memberCompPlan.overLimit && <div className="mt-1 font-semibold">Over the limit: a manager approved this comp.</div>}
            </div>
          )}

          {/* Organization guests with no account (OrgGuests.tsx). */}
          {orgGroup ? (
            <OrgGroupCard
              group={orgGroup}
              plan={groupPlan}
              onChange={setOrgGroup}
              onRemove={() => setOrgGroup(null)}
              onOverride={() => setOrgPinOpen(true)}
              refreshKey={orgTry}
            />
          ) : (
            <OrgGuestsButton className="w-full" onClick={() => setGroupPickerOpen(true)} />
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
            onRewardLine={(label) => {
              setCart((prev) => [...prev, { key: `${Date.now()}-${Math.random()}`, menuItemId: null, name: label, unit: 0, qty: 1, mods: [], isAlcohol: false }]);
            }}
            onFind={() => {
              pickTab(CUSTOMERS_TAB);
              setFindAt(Date.now());
            }}
            readerId={readerId}
            toTablet={checkins.toTablet}
            onOrgChange={() => setOrgTry((n) => n + 1)}
          />
          </TabletSetupContext>

          <div className="space-y-1 pt-1">
          {/* The owner rate: only with an owner's own account on the order
              (an owner with the owner rate on in Back office). Ticked, the
              member perks and Tax exempt are hidden: they don't go with it. */}
          {isOwnerAccount && (
            <label className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--foreground)" }}>
              <input type="checkbox" checked={ownerTicked} disabled={busy} onChange={(e) => tickOwnerRate(e.target.checked)} />
              Owner rate ({OWNER_RATE_NAME})
              <InfoTip topic="owner-rate" />
            </label>
          )}
          </div>
          <div className={`space-y-1 ${ownerTicked ? "hidden" : ""}`}>
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
              {totals.rewardAvailable > 0 ? `Points reward: ${money(totals.rewardAvailable)} off (${rewardPointsFor(totals.rewardAvailable)} pts)` : `Redeem ${POINTS_PER_REWARD} pts for ${money(REWARD_VALUE)} off`}
            </label>
          )}
          </div>
        </div>

        <div className="shrink-0">
          {unsavedSale && <UnsavedSaleBanner sale={unsavedSale} busy={busy} onRetry={retryUnsavedSale} onStop={stopTryingUnsavedSale} />}
          <div className="mt-2 flex items-end justify-between gap-3 border-t pt-2" style={{ borderColor: "var(--border)" }}>
            {ownerTotals ? (
              <div className="text-xs leading-5 tabular-nums" style={{ color: "var(--muted)" }}>
                <div>
                  Owner rate {money(ownerTotals.subtotal)} <s>{money(menuSubtotal)}</s>
                </div>
                <div>Tax {money(ownerTotals.tax)}</div>
              </div>
            ) : (
              <div className="text-xs leading-5 tabular-nums" style={{ color: "var(--muted)" }}>
                <div>Subtotal {money(totals.subtotal)}</div>
                {totals.orgCompDiscount > 0 && <div>Comp -{money(totals.orgCompDiscount)}</div>}
                {totals.discount - totals.orgCompDiscount > 0.004 && <div>Discount -{money(totals.discount - totals.orgCompDiscount)}</div>}
                {totals.taxIncluded ? (
                  <div className="font-semibold" style={{ color: "var(--foreground)" }}>
                    {TAX_INCLUDED_NOTE((orgTaxIncluded ? orgOnOrder?.orgName : orgGroup?.orgName) ?? "organization")}: {money(totals.tax)}
                  </div>
                ) : (
                  <div>Tax {money(totals.tax)}</div>
                )}
              </div>
            )}
            <div className="text-right">
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                {ownerTotals ? "Owner rate" : "Total"} · {itemCount} item{itemCount === 1 ? "" : "s"}
              </div>
              <div className="text-2xl font-semibold leading-tight tabular-nums" style={{ color: "var(--accent)" }}>
                {money(ownerTotals ? ownerTotals.total : totals.total)}
              </div>
            </div>
          </div>
          {/* No new charges while a charged sale is unsaved: if sales aren't
              saving, the register shouldn't keep charging cards. Nor while
              the owner rate's prices are still coming. */}
          <button className="btn-primary mt-2 w-full py-3 text-base" disabled={cart.length === 0 || !employeeId || busy || !!unsavedSale || ownerPending} onClick={() => void startCheckout()}>
            {!employeeId ? "Pick a cashier" : ownerPending ? "Getting owner prices…" : visitOnly ? "Record visit" : zeroTotal ? "Complete order ($0)" : "Complete order"}
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
            <RecentDeclines target={printTarget} />
            <EasterEggs
              next={flourish}
              onPick={setFlourish}
              canPrint={!!printTarget && devices.autoPrint}
              memeStation={printTarget?.via === "station" ? printTarget.station : null}
              onCelebrate={() => registerChannelRef.current?.send({ type: "broadcast", event: "celebrate", payload: {} })}
              rickroll={rickroll}
            />
            {/* This register's reader, printer, drawer and the customer
                screen's sounds. Down here in the row's spare cells, so the
                top row has room for the Staff button. */}
            <DevicesPanel
              buttonClassName="btn-secondary relative whitespace-nowrap !px-2 py-2 text-sm"
              fallbackReaderId={defaultReaderId}
              reader={readerMonitor}
              onReprintTickets={lastTickets && printTarget ? () => printTickets(printTarget, lastTickets.orderNumber, lastTickets.lines) : null}
              onReprint={lastReceipt && printTarget ? async () => sendPrint(printTarget, "receipt", await customerReceipt(lastReceipt), `Receipt #${lastReceipt.orderNumber} (again)`) : null}
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
              {/* The bar's category is "Alcohol" in Back office and Bar here. */}
              {isBarCategory(c) ? "Bar" : c.label}
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
        {giftSellOpen && (
          <GiftCardSellModal
            memberName={member?.name ?? null}
            onCancel={() => setGiftSellOpen(false)}
            onAdd={(g) => {
              setCart((prev) => [
                ...prev,
                {
                  key: `${Date.now()}-${Math.random()}`,
                  menuItemId: null,
                  name: GIFT_CARD_LINE_NAME,
                  unit: g.amount,
                  qty: 1,
                  mods: g.toMember && member ? [`On ${member.name}'s account`] : [],
                  isAlcohol: false,
                  giftMemberId: g.toMember && member ? member.id : null,
                },
              ]);
              setGiftSellOpen(false);
            }}
          />
        )}
        {customOpen && (
          <CustomItemModal
            onCancel={() => setCustomOpen(false)}
            onAdd={(l) => {
              setCart((prev) => [...prev, { key: `${Date.now()}-${Math.random()}`, menuItemId: null, name: l.name, unit: l.unit, qty: 1, mods: [], isAlcohol: l.isAlcohol }]);
              setCustomOpen(false);
            }}
          />
        )}

        <div
          ref={menuScrollRef}
          data-menu-scroll
          // The Bar tab fills this box exactly and scrolls inside its own parts.
          className={`md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain ${barTab ? "md:flex md:flex-col" : ""}`}
        >
        {categoryId === CUSTOMERS_TAB ? (
          // Its "New phone account" shows on the customer screen as it's typed.
          <TabletSetupContext value={tabletSetup}>
            <div className="mb-3 flex items-center gap-2 rounded-md border p-2 text-sm" style={{ borderColor: "var(--border)" }}>
              <span className="min-w-0 flex-1" style={{ color: "var(--muted)" }}>
                A group with Easter Seals or another organization, no account needed:
              </span>
              <OrgGuestsButton onClick={() => setGroupPickerOpen(true)} />
            </div>
            <CustomersTab checkins={checkins} current={member} hasOrder={cart.length > 0 || !!activeTabId} onAttach={attachMember} findAt={findAt} readerId={readerId} employeeId={employeeId} />
          </TabletSetupContext>
        ) : categoryId === MOVIES_TAB ? (
          <MovieTickets
            initial={initialScreenings}
            inCart={ticketsInCart}
            insidersPlus={member?.tier === "Insiders+"}
            onAdd={(t) => {
              setCart((prev) => [...prev, { key: `${Date.now()}-${Math.random()}`, menuItemId: null, screeningId: t.screeningId, name: t.name, unit: t.unit, qty: t.qty, mods: t.mods, isAlcohol: false }]);
            }}
          />
        ) : builderItem ? (
          <ItemBuilder
            key={builderItem.id}
            item={builderItem}
            recipe={recipesByItem[builderItem.id] ?? null}
            // A drink's icon, large, so it doesn't vanish when its button is tapped.
            icon={sectionById.get(builderItem.id) ? itemIconSpec(recipesByItem[builderItem.id], sectionById.get(builderItem.id)!) : null}
            double={{
              ctx: {
                isAlcohol: builderItem.is_alcohol,
                section: sectionById.get(builderItem.id) ?? null,
                ownDouble: hasOwnDouble(builderItem.modifier_groups),
                recipe: recipeLinesOf(recipesByItem[builderItem.id]),
                name: builderItem.name,
              },
              settings: doubleSettings,
              start: builderDouble,
            }}
            onAdd={addLine}
            onCancel={() => setBuilderItemId(null)}
          />
        ) : barTab && category ? (
          <BarTab
            category={category}
            recipesByItem={recipesByItem}
            outs={outs}
            onTap={tapItem}
            onCustom={() => setCustomOpen(true)}
            page={barPage}
            onPage={setBarPage}
            book={{
              // Before the Bar Book migration (or if it can't be read) there's no strip.
              state: book.state === "ready" ? "ready" : book.state === "idle" ? "loading" : "off",
              count: book.state === "ready" ? bookMakeable : null,
              onOpen: (query) => {
                setBookQuery(query ?? "");
                setBookOpen(true);
                setBookLoading(true);
                refreshBook();
              },
              onWhatsInIt: () => {
                setWhatsOpen(true);
                refreshBook();
              },
            }}
          />
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
                        onClick={() => tapItem(item.id)}
                      />
                    );
                  })}
                  {/* Anything the menu can't describe; each use files a dev note. */}
                  {i === menuSections.length - 1 && (
                    <>
                      <button className="card-flat flex min-h-[84px] items-center justify-center p-3 text-center text-sm" style={{ borderStyle: "dashed", color: "var(--muted)" }} onClick={() => setCustomOpen(true)}>
                        + Custom item
                      </button>
                      <button className="card-flat flex min-h-[84px] items-center justify-center p-3 text-center text-sm" style={{ borderStyle: "dashed", color: "var(--muted)" }} onClick={() => setGiftSellOpen(true)}>
                      Gift card
                    </button>
                    </>
                  )}
                </div>
              </section>
            ))}
            {menuSections.length === 0 && (
              <div className="flex gap-2">
                <button className="card-flat flex min-h-[84px] w-40 items-center justify-center p-3 text-sm" style={{ borderStyle: "dashed", color: "var(--muted)" }} onClick={() => setCustomOpen(true)}>
                  + Custom item
                </button>
                <button className="card-flat flex min-h-[84px] w-40 items-center justify-center p-3 text-sm" style={{ borderStyle: "dashed", color: "var(--muted)" }} onClick={() => setGiftSellOpen(true)}>
                      Gift card
                    </button>
              </div>
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
                  // A $0 order has nothing to pay: it's saved right away.
                  if (zeroTotal && tip === 0) completeZeroOrder();
                  else setPayOpen(true);
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
          tipEligible={tip > 0 || tipAsked ? null : totals.total - totals.tax - totals.giftCardSales}
          giftCardOk={!cart.some((l) => isGiftCardLine(l))}
          giftCardMax={totals.total}
          tipTaken={tipAsked}
          tabCard={activeTab?.card_label ? { tabId: activeTab.id, label: activeTab.card_label } : null}
          tabName={activeTab?.order_name ?? "Tab"}
          onReaderStarted={keepReaderPayment}
          memberId={memberId}
          cardOnFileLink={cofLink}
          onCardOnFileStarted={keepCardOnFilePayment}
          onReaderCanceled={clearPendingReaderSale}
          onConfirm={finalizeCheckout}
          onCancel={() => setPayOpen(false)}
          readerDown={readerDown}
          onReaderOffline={onReaderOffline}
          onReaderPrompt={setReaderPrompt}
        />
      )}

      {groupPickerOpen && <OrgGuestsPicker onApply={applyOrgGroup} onClose={() => setGroupPickerOpen(false)} />}

      {orgPinOpen && pinOrg && (
        <ManagerPinModal
          title="Comp past today's limit?"
          description={`${pinOrg.orgName} has used ${pinOrg.used} of its ${pinOrg.limit} comps today. A manager's PIN comps this anyway.`}
          onCancel={() => setOrgPinOpen(false)}
          onSubmit={async (pin) => {
            const r = await approveOrgOverLimit(pin, pinOrg.orgId);
            if (!r.ok) throw new Error(r.error);
            setOrgApproval({ orgId: pinOrg.orgId, token: r.token });
            setOrgPinOpen(false);
            setToast(`Comp approved${r.approvedBy ? ` by ${r.approvedBy}` : ""}. Take payment when ready.`);
          }}
        />
      )}

      {rewardPin && (
        <ManagerPinModal
          title="Reward can't be covered"
          description={`${rewardPin.join(" ")} Take the reward off the order, or a manager's PIN lets the sale go ahead (a manager is told).`}
          onCancel={() => setRewardPin(null)}
          onSubmit={async (pin) => {
            const r = await approveShortRewards(pin);
            if (!r.ok) throw new Error(r.error);
            setRewardPin(null);
            void startCheckout(true);
          }}
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
        <TaxExemptModal onCancel={() => setAskTaxExempt(false)} onSubmit={handleTaxExempt} />
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

      {whatsOpen && book.state === "ready" && (
        <WhatsInIt
          recipes={book.recipes}
          stock={book.stock}
          menuItems={bookMenu}
          target={book.target}
          outs={outs}
          doubleSettings={doubleSettings}
          prices={barPrices}
          onClose={() => setWhatsOpen(false)}
          // Exactly what tapping its button on the Bar tab does.
          onRingUp={(id, double) => {
            setWhatsOpen(false);
            tapItem(id, double);
          }}
          // The Bar Book's own off-menu line, and a custom drink: both the
          // same one-off line as "+ Custom item".
          onAddLine={(l, note) => {
            setWhatsOpen(false);
            setCart((prev) => [...prev, { key: `${Date.now()}-${Math.random()}`, menuItemId: null, name: l.name, unit: l.unit, qty: 1, mods: l.mods, isAlcohol: true, recipeId: l.recipeId }]);
            if (note) {
              setToast(note);
              setTimeout(() => setToast((t) => (t === note ? null : t)), 8000);
            }
          }}
          onAddCustom={(l, note) => {
            setWhatsOpen(false);
            setCart((prev) => [...prev, { key: `${Date.now()}-${Math.random()}`, menuItemId: null, name: l.name, unit: l.unit, qty: 1, mods: l.mods, isAlcohol: l.isAlcohol, customRecipe: l.customRecipe }]);
            if (note) {
              setToast(note);
              setTimeout(() => setToast((t) => (t === note ? null : t)), 8000);
            }
          }}
        />
      )}

      {bookOpen && book.state === "ready" && (
        <BarBook
          initialQuery={bookQuery}
          recipes={book.recipes}
          stock={book.stock}
          menuItems={bookMenu}
          target={book.target}
          outs={outs}
          updating={bookLoading}
          // Owners and admins (canNote is hasAdminAccess); the server checks again.
          canMakeMenuItems={canNote}
          doubleSettings={doubleSettings}
          prices={barPrices}
          onClose={() => setBookOpen(false)}
          // The same one-off line as "+ Custom item", knowing its recipe.
          onAddLine={(l, note) => {
            setBookOpen(false);
            setCart((prev) => [...prev, { key: `${Date.now()}-${Math.random()}`, menuItemId: null, name: l.name, unit: l.unit, qty: 1, mods: l.mods, isAlcohol: true, recipeId: l.recipeId }]);
            if (note) {
              setToast(note);
              setTimeout(() => setToast((t) => (t === note ? null : t)), 8000);
            }
          }}
          // A new menu item: the register's buttons and the book read again.
          onMenuChanged={() => {
            router.refresh();
            refreshBook();
          }}
          // Exactly what tapping its button on the Bar tab does.
          onRingUp={(id, double) => {
            setBookOpen(false);
            tapItem(id, double);
          }}
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

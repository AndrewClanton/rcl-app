"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { MenuCategory, Employee, Member, Recipe } from "@/lib/types";
import ItemBuilder, { type BuiltLine } from "./ItemBuilder";
import PaymentModal from "./PaymentModal";
import TipModal from "./TipModal";
import ManagerPinModal from "@/components/ManagerPinModal";
import PromptModal from "@/components/PromptModal";
import ConfirmModal from "@/components/ConfirmModal";
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

const TAX_RATE = 0.08;
const POINTS_REDEEM_COST = 100;
const POINTS_REDEEM_VALUE = 5;

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

interface CartLine {
  key: string;
  menuItemId: string | null;
  name: string;
  unit: number;
  qty: number;
  mods: string[];
  isAlcohol: boolean;
}

function memberDiscountRate(member: Member | null) {
  if (!member) return 0;
  return member.tier === "Insiders+" ? 0.1 : 0.05;
}

function computeTotals(cart: CartLine[], member: Member | null, monthlyMember: boolean, taxFree: boolean, pointsRedeemed: boolean) {
  const subtotal = cart.reduce((s, l) => s + l.unit * l.qty, 0);
  const tierDiscount = subtotal * memberDiscountRate(member);
  const monthlyDiscount = monthlyMember ? subtotal * 0.1 : 0;
  const canRedeem = !!member && member.points >= POINTS_REDEEM_COST;
  const redemptionDiscount = canRedeem && pointsRedeemed ? POINTS_REDEEM_VALUE : 0;
  const discount = tierDiscount + monthlyDiscount + redemptionDiscount;
  const taxable = subtotal - discount;
  const tax = taxFree ? 0 : taxable * TAX_RATE;
  const total = Math.max(0, taxable) + tax;
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
  members,
  heldOrders,
  openTabs,
  recipesByItem,
  readerAvailable,
}: {
  categories: MenuCategory[];
  employees: Employee[];
  members: Member[];
  heldOrders: DraftOrderSummary[];
  openTabs: DraftOrderSummary[];
  recipesByItem: Record<string, Recipe>;
  readerAvailable: boolean;
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
  const [memberId, setMemberId] = useState<string | null>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const [taxFree, setTaxFree] = useState(false);
  const [monthlyMember, setMonthlyMember] = useState(false);
  const [pointsRedeemed, setPointsRedeemed] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
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
  const [busy, setBusy] = useState(false);

  const category = useMemo(() => categories.find((c) => c.id === nav.categoryId) ?? null, [categories, nav.categoryId]);
  const subcategory = useMemo(() => category?.subcategories.find((s) => s.id === nav.subcategoryId) ?? null, [category, nav.subcategoryId]);
  const items = subcategory ? subcategory.items : category?.subcategories.length ? [] : category?.items ?? [];
  const builderItem = useMemo(() => {
    for (const c of categories) {
      for (const i of c.items) if (i.id === builderItemId) return i;
      for (const s of c.subcategories) for (const i of s.items) if (i.id === builderItemId) return i;
    }
    return null;
  }, [categories, builderItemId]);

  const member = useMemo(() => members.find((m) => m.id === memberId) ?? null, [members, memberId]);
  const totals = computeTotals(cart, member, monthlyMember, taxFree, pointsRedeemed);
  const itemCount = cart.reduce((s, l) => s + l.qty, 0);
  const memberMatches = memberQuery.trim()
    ? members.filter((m) => m.name.toLowerCase().includes(memberQuery.trim().toLowerCase()))
    : [];
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
      }))
    );
    setOrderName(f.order_name ?? "");
    setMemberId(f.member_id);
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

  function resetOrder() {
    setCart([]);
    setOrderName("");
    setMemberId(null);
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

  function startCheckout() {
    if (!employeeId || cart.length === 0) return;
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

  async function finalizeCheckout(payment: CheckoutPayment) {
    setPayOpen(false);
    setBusy(true);
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
        tip,
        draftOrderId: activeTabId,
      });
      const parts = [`Order #${orderNumber} complete — ${money(totals.total + tip)} charged (${payment.method})`];
      if (tip > 0) parts.push(`${money(tip)} tip`);
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
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      {/* Cart panel */}
      <div className="card flex flex-col">
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
        </div>

        <div className="mb-3 flex items-center justify-between">
          <span className="eyebrow">Current order</span>
          <span className="text-sm" style={{ color: "var(--muted)" }}>
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </span>
        </div>

        {activeTab && (
          <div className="chip chip-selected mb-2 inline-flex w-fit">
            Tab: {activeTab.order_name}
          </div>
        )}

        <input className="input mb-3" placeholder="Order / guest name" value={orderName} onChange={(e) => setOrderName(e.target.value)} />

        <div className="max-h-[320px] space-y-2 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="rounded-lg border border-dashed py-6 text-center text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
              No items yet
            </div>
          ) : (
            cart.map((line) => (
              <div key={line.key} className="card-flat p-2.5">
                <div className="flex justify-between gap-2 text-sm">
                  <span className="font-medium" style={{ color: "var(--foreground)" }}>
                    {line.qty > 1 ? `${line.qty}× ` : ""}
                    {line.name}
                  </span>
                  <span style={{ color: "var(--foreground)" }}>{money(line.unit * line.qty)}</span>
                </div>
                {line.mods.length > 0 && (
                  <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
                    {line.mods.join(", ")}
                  </div>
                )}
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    className="h-7 w-7 rounded-md border text-sm"
                    style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
                    onClick={() => updateQty(line.key, -1)}
                  >
                    −
                  </button>
                  <span className="text-xs" style={{ color: "var(--foreground)" }}>
                    {line.qty}
                  </span>
                  <button
                    className="h-7 w-7 rounded-md border text-sm"
                    style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
                    onClick={() => updateQty(line.key, 1)}
                  >
                    +
                  </button>
                  <button className="ml-auto text-xs hover:underline" style={{ color: "var(--danger-text)" }} onClick={() => removeLine(line.key)}>
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

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

          <label className="mt-2.5 flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
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
              Redeem {POINTS_REDEEM_COST} pts for {money(POINTS_REDEEM_VALUE)} off
            </label>
          )}
        </div>

        <button className="btn-primary mt-3 w-full py-3 text-base" disabled={cart.length === 0 || !employeeId || busy} onClick={startCheckout}>
          Complete order
        </button>
        <div className="mt-2 flex gap-2">
          <button
            className="btn-secondary flex-1 py-2 text-sm"
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
            {activeTabId ? "Put tab away" : "Clear order"}
          </button>
          <button className="btn-secondary flex-1 py-2 text-sm" disabled={cart.length === 0 || busy} onClick={handleHold}>
            Hold order
          </button>
        </div>
        <button className="btn-secondary mt-2 w-full py-2 text-sm" onClick={() => setHeldListOpen((v) => !v)}>
          Held orders ({heldOrders.length})
        </button>
        <div className="mt-2 flex gap-2">
          <button className="btn-secondary flex-1 py-2 text-sm" disabled={!employeeId || busy} onClick={() => setOpenTabPromptOpen(true)}>
            Open a tab
          </button>
          <button className="btn-secondary flex-1 py-2 text-sm" onClick={() => setTabsListOpen((v) => !v)}>
            Tabs ({openTabs.length})
          </button>
        </div>

        {heldListOpen && (
          <div className="card-flat mt-2 p-3" style={{ background: "var(--surface-hover)" }}>
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
          <div className="card-flat mt-2 p-3" style={{ background: "var(--surface-hover)" }}>
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
          <div className="notice notice-success mt-3 p-2.5 text-xs">
            {toast}
          </div>
        )}

        <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <div className="eyebrow mb-2">Member</div>
          <div className="mb-2 text-sm" style={{ color: "var(--muted)" }}>
            {member ? `${member.name} — ${member.tier}` : "No member attached"}
          </div>
          <input className="input" placeholder="Search members..." value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} />
          {memberMatches.length > 0 && (
            <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
              {memberMatches.map((m) => (
                <div
                  key={m.id}
                  className="cursor-pointer px-2 py-1.5 text-sm"
                  style={{ color: "var(--foreground)" }}
                  onClick={() => {
                    setMemberId(m.id);
                    setMemberQuery("");
                  }}
                >
                  {m.name} — {m.tier}
                </div>
              ))}
            </div>
          )}
          {member && (
            <button className="mt-2 text-xs hover:underline" style={{ color: "var(--accent)" }} onClick={() => setMemberId(null)}>
              Remove member
            </button>
          )}
          <div className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
            {member ? `Loyalty points: ${Math.round(member.points)}` : "Loyalty points: — (attach a member)"}
          </div>
        </div>
      </div>

      {/* Menu panel */}
      <div className="card">
        <div className="mb-3 flex flex-wrap gap-2">
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
        </div>

        {category?.subcategories.length ? (
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            {!nav.subcategoryId
              ? category.subcategories.map((s) => (
                  <button key={s.id} className="chip" onClick={() => setNav({ categoryId: category.id, subcategoryId: s.id })}>
                    {s.label}
                  </button>
                ))
              : (
                  <button className="chip" onClick={() => setNav({ categoryId: category.id, subcategoryId: null })}>
                    ← Back
                  </button>
                )}
          </div>
        ) : null}

        {builderItem ? (
          <ItemBuilder item={builderItem} recipe={recipesByItem[builderItem.id] ?? null} onAdd={addLine} onCancel={() => setBuilderItemId(null)} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
        <PaymentModal total={totals.total + tip} readerAvailable={readerAvailable} onConfirm={finalizeCheckout} onCancel={() => setPayOpen(false)} />
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

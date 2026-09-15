"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { MenuCategory, Employee, Member } from "@/lib/types";
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

export default function PosApp({
  categories,
  employees,
  members,
  heldOrders,
  openTabs,
  readerAvailable,
}: {
  categories: MenuCategory[];
  employees: Employee[];
  members: Member[];
  heldOrders: DraftOrderSummary[];
  openTabs: DraftOrderSummary[];
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
      await updateDraftOrder(activeTabId, currentFields());
      return;
    }
    if (cart.length > 0) {
      // Auto-hold rather than asking -- never silently lose an in-progress
      // order; it'll sit in the held list for the cashier to clean up.
      const fields = currentFields();
      fields.orderName = fields.orderName || `Held ${new Date().toLocaleTimeString()}`;
      await saveDraftOrder("held", fields);
    }
  }

  async function handleHold() {
    if (cart.length === 0) return;
    setBusy(true);
    try {
      const fields = currentFields();
      fields.orderName = fields.orderName || `Held ${new Date().toLocaleTimeString()}`;
      await saveDraftOrder("held", fields);
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
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      {/* Cart panel */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mb-2 flex items-center gap-2 text-sm">
          <span>Cashier:</span>
          <select
            className="rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">Not logged in</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-2 flex items-center justify-between text-sm text-neutral-500">
          <span>Items: {itemCount}</span>
        </div>

        {activeTab && (
          <div className="mb-2 inline-block rounded-full border border-neutral-400 px-2.5 py-0.5 text-xs text-neutral-600 dark:text-neutral-400">
            Tab: {activeTab.order_name}
          </div>
        )}

        <input
          className="mb-3 w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          placeholder="Order / guest name"
          value={orderName}
          onChange={(e) => setOrderName(e.target.value)}
        />

        <div className="max-h-[320px] space-y-2 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="py-6 text-center text-sm text-neutral-500">No items yet</div>
          ) : (
            cart.map((line) => (
              <div key={line.key} className="rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
                <div className="flex justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {line.qty > 1 ? `${line.qty}× ` : ""}
                    {line.name}
                  </span>
                  <span>{money(line.unit * line.qty)}</span>
                </div>
                {line.mods.length > 0 && <div className="mt-0.5 text-xs text-neutral-500">{line.mods.join(", ")}</div>}
                <div className="mt-1 flex items-center gap-2">
                  <button className="h-6 w-6 rounded border border-neutral-300 text-xs dark:border-neutral-700" onClick={() => updateQty(line.key, -1)}>
                    −
                  </button>
                  <span className="text-xs">{line.qty}</span>
                  <button className="h-6 w-6 rounded border border-neutral-300 text-xs dark:border-neutral-700" onClick={() => updateQty(line.key, 1)}>
                    +
                  </button>
                  <button className="ml-auto text-xs text-red-600 hover:underline" onClick={() => removeLine(line.key)}>
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 border-t border-neutral-200 pt-2 text-sm dark:border-neutral-800">
          <div className="flex justify-between text-neutral-500">
            <span>Subtotal</span>
            <span>{money(totals.subtotal)}</span>
          </div>
          {totals.discount > 0 && (
            <div className="flex justify-between text-neutral-500">
              <span>Discount</span>
              <span>-{money(totals.discount)}</span>
            </div>
          )}
          <div className="flex justify-between text-neutral-500">
            <span>Tax</span>
            <span>{money(totals.tax)}</span>
          </div>
          <div className="mt-1 flex justify-between text-base font-semibold text-neutral-900 dark:text-neutral-100">
            <span>Total</span>
            <span>{money(totals.total)}</span>
          </div>

          <label className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
            <input type="checkbox" checked={monthlyMember} onChange={(e) => setMonthlyMember(e.target.checked)} />
            Monthly member (10% off)
          </label>
          <label className="flex items-center gap-2 text-xs text-neutral-500">
            <input type="checkbox" checked={taxFree} onChange={(e) => setTaxFree(e.target.checked)} />
            Tax exempt
          </label>
          {totals.canRedeem && (
            <label className="flex items-center gap-2 text-xs text-neutral-500">
              <input type="checkbox" checked={pointsRedeemed} onChange={(e) => setPointsRedeemed(e.target.checked)} />
              Redeem {POINTS_REDEEM_COST} pts for {money(POINTS_REDEEM_VALUE)} off
            </label>
          )}
        </div>

        <button
          className="mt-3 w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          disabled={cart.length === 0 || !employeeId || busy}
          onClick={startCheckout}
        >
          Complete order
        </button>
        <div className="mt-2 flex gap-2">
          <button
            className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm text-red-600 dark:border-neutral-700"
            disabled={cart.length === 0 || busy}
            onClick={() =>
              setConfirmState({
                title: activeTabId ? "Leave this tab?" : "Clear the current order?",
                description: activeTabId ? "Your changes will be saved and you can switch back to it later." : undefined,
                danger: true,
                confirmLabel: activeTabId ? "Leave tab" : "Clear",
                onConfirm: async () => {
                  setConfirmState(null);
                  if (activeTabId) await stashCurrentWork();
                  resetOrder();
                  router.refresh();
                },
              })
            }
          >
            Clear order
          </button>
          <button className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm dark:border-neutral-700" disabled={cart.length === 0 || busy} onClick={handleHold}>
            Hold order
          </button>
        </div>
        <button className="mt-2 w-full rounded-lg border border-neutral-300 py-2 text-sm dark:border-neutral-700" onClick={() => setHeldListOpen((v) => !v)}>
          Held orders ({heldOrders.length})
        </button>
        <div className="mt-2 flex gap-2">
          <button
            className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm dark:border-neutral-700"
            disabled={!employeeId || busy}
            onClick={() => setOpenTabPromptOpen(true)}
          >
            Open a tab
          </button>
          <button className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm dark:border-neutral-700" onClick={() => setTabsListOpen((v) => !v)}>
            Tabs ({openTabs.length})
          </button>
        </div>

        {heldListOpen && (
          <div className="mt-2 rounded-lg border border-neutral-300 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Held orders</div>
            {heldOrders.length === 0 ? (
              <div className="text-sm text-neutral-500">No held orders.</div>
            ) : (
              heldOrders.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-2 border-b border-neutral-200 py-1.5 text-sm last:border-0 dark:border-neutral-800">
                  <span>
                    {h.order_name || "Held order"} ({h.item_count} item{h.item_count === 1 ? "" : "s"})
                  </span>
                  <div className="flex gap-1">
                    <button className="rounded border border-neutral-300 px-2 py-0.5 text-xs dark:border-neutral-700" onClick={() => handleResumeHeld(h.id)}>
                      Resume
                    </button>
                    <button className="rounded border border-neutral-300 px-2 py-0.5 text-xs dark:border-neutral-700" onClick={() => handleDiscardHeld(h.id)}>
                      Discard
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tabsListOpen && (
          <div className="mt-2 rounded-lg border border-neutral-300 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Open tabs</div>
            {openTabs.length === 0 ? (
              <div className="text-sm text-neutral-500">No open tabs.</div>
            ) : (
              openTabs.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 border-b border-neutral-200 py-1.5 text-sm last:border-0 dark:border-neutral-800">
                  <span>
                    {t.order_name} — {money(t.total)} ({t.item_count} item{t.item_count === 1 ? "" : "s"})
                    {t.id === activeTabId ? " · active now" : ""}
                  </span>
                  <div className="flex gap-1">
                    {t.id !== activeTabId && (
                      <button className="rounded border border-neutral-300 px-2 py-0.5 text-xs dark:border-neutral-700" onClick={() => handleSwitchTab(t.id)}>
                        Switch to
                      </button>
                    )}
                    <button className="rounded border border-neutral-300 px-2 py-0.5 text-xs dark:border-neutral-700" onClick={() => setCancelTabId(t.id)}>
                      Cancel tab
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {toast && (
          <div className="mt-3 rounded-lg border border-green-400 bg-green-50 p-2 text-xs text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
            {toast}
          </div>
        )}

        <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <div className="mb-2 text-sm text-neutral-500">{member ? `Member: ${member.name} — ${member.tier}` : "No member attached"}</div>
          <input
            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            placeholder="Search members..."
            value={memberQuery}
            onChange={(e) => setMemberQuery(e.target.value)}
          />
          {memberMatches.length > 0 && (
            <div className="mt-1 max-h-32 overflow-y-auto rounded border border-neutral-200 dark:border-neutral-800">
              {memberMatches.map((m) => (
                <div
                  key={m.id}
                  className="cursor-pointer px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
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
            <button className="mt-2 text-xs text-neutral-500 hover:underline" onClick={() => setMemberId(null)}>
              Remove member
            </button>
          )}
          <div className="mt-2 text-xs text-neutral-500">{member ? `Loyalty points: ${Math.round(member.points)}` : "Loyalty points: — (attach a member)"}</div>
        </div>
      </div>

      {/* Menu panel */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mb-3 flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c.id}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                nav.categoryId === c.id
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                  : "border-neutral-300 dark:border-neutral-700"
              }`}
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
                  <button
                    key={s.id}
                    className="rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700"
                    onClick={() => setNav({ categoryId: category.id, subcategoryId: s.id })}
                  >
                    {s.label}
                  </button>
                ))
              : (
                  <button
                    className="rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700"
                    onClick={() => setNav({ categoryId: category.id, subcategoryId: null })}
                  >
                    ← Back
                  </button>
                )}
          </div>
        ) : null}

        {builderItem ? (
          <ItemBuilder item={builderItem} onAdd={addLine} onCancel={() => setBuilderItemId(null)} />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {items.map((item) => (
              <button
                key={item.id}
                className="flex min-h-[80px] flex-col items-center justify-center gap-1 rounded-lg border border-neutral-200 p-3 text-center hover:border-neutral-400 dark:border-neutral-800"
                onClick={() => setBuilderItemId(item.id)}
              >
                <span className="text-sm font-medium">{item.name}</span>
                <span className="text-xs text-neutral-500">{money(item.price)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {tipOpen && (
        <TipModal subtotal={totals.subtotal} tabName={activeTab?.order_name ?? "Tab"} onConfirm={continueAfterTip} onCancel={() => setTipOpen(false)} />
      )}

      {ageConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-xl dark:bg-neutral-900">
            <h3 className="text-lg font-semibold">Age verification</h3>
            <p className="mt-1 text-sm text-neutral-500">This order includes alcohol. Confirm you&apos;ve checked ID and the customer is 21 or older.</p>
            <div className="mt-4 flex justify-center gap-2">
              <button className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700" onClick={() => setAgeConfirmOpen(false)}>
                Cancel
              </button>
              <button
                className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
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

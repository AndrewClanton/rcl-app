"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { DayOrder, DayReport } from "@/lib/data/reports";
import type { DayDrillData } from "@/lib/data/day-drill";
import { BOOTHS_LABEL, FOOD_AND_DRINK, FOOD_AND_DRINK_CATEGORIES, TICKETS_LABEL } from "@/lib/report-categories";
import { DRILL_PARAMS, closeDrill, forgetPush, setDrillParams, type DrillParam } from "./drill-nav";
import DrillLink from "./DrillLink";
import TipsDrill from "./TipsDrill";
import { Lines, Section, money, time } from "./drill-ui";

// Reports -> Day: what's behind each figure. Tapping a figure opens one of
// these in a sheet (full screen on a phone, a panel on the right on a wider
// screen), and the address says which (?show=tips), so it can be sent or
// bookmarked. Every list adds up to the figure it came from: the money is
// the report's own (getDayReport), only broken down.

export type DrillView = "net" | "collected" | "orders" | "tax" | "tickets" | "refunds" | "tips";
const VIEWS: DrillView[] = ["net", "collected", "orders", "tax", "tickets", "refunds", "tips"];

const NO_CASHIER = "(none)";

function inCategory(category: string, wanted: string) {
  return wanted === FOOD_AND_DRINK ? FOOD_AND_DRINK_CATEGORIES.includes(category) : category === wanted;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// What each order counts for, figure by figure (completed orders only).
const goods = (o: DayOrder) => o.total - o.tax - o.tip - (o.refunded - o.refundedTax);
const moneyIn = (o: DayOrder) => (o.source === "pos" ? o.cash + o.card - o.refundedCash - o.refundedCard : o.total - o.refunded);

type Pay = "card" | "cash" | "vouchers" | "online";
const PAY_LABEL: Record<Pay, string> = { card: "Card", cash: "Cash", vouchers: "Vouchers", online: "Online" };

type Filters = { status: string; pay: Pay | ""; who: string; cat: string; item: string; q: string };

function readFilters(sp: URLSearchParams): Filters {
  const pay = sp.get("pay");
  return {
    status: sp.get("status") ?? "completed",
    pay: pay === "card" || pay === "cash" || pay === "vouchers" || pay === "online" ? pay : "",
    who: sp.get("who") ?? "",
    cat: sp.get("cat") ?? "",
    item: sp.get("item") ?? "",
    q: sp.get("q") ?? "",
  };
}

function matches(o: DayOrder, f: Filters) {
  if (f.status !== "all" && o.status !== f.status) return false;
  if (f.pay === "card" && !(o.source === "pos" && o.card > 0)) return false;
  if (f.pay === "cash" && !(o.source === "pos" && o.cash > 0)) return false;
  if (f.pay === "vouchers" && !(o.source === "pos" && o.voucher > 0)) return false;
  if (f.pay === "online" && o.source === "pos") return false;
  if (f.who && (f.who === NO_CASHIER ? !!o.cashier : o.cashier !== f.who)) return false;
  if (f.cat && !o.lines.some((l) => inCategory(l.category, f.cat))) return false;
  if (f.item && !o.lines.some((l) => l.name === f.item)) return false;
  if (f.q) {
    const q = f.q.trim().toLowerCase().replace(/^#/, "");
    if (q && !String(o.orderNumber).startsWith(q) && !o.items.toLowerCase().includes(q) && !(o.name ?? "").toLowerCase().includes(q)) return false;
  }
  return true;
}

export default function DayDrill({ r, drill, canRecord, dayLabel }: { r: DayReport; drill: DayDrillData; canRecord: boolean; dayLabel: string }) {
  const sp = useSearchParams();
  const show = sp.get("show") as DrillView | null;
  const view = show && VIEWS.includes(show) ? show : null;

  useEffect(() => {
    window.addEventListener("popstate", forgetPush);
    return () => window.removeEventListener("popstate", forgetPush);
  }, []);

  // Another drill-down, from inside this one (keeps the day and range).
  const hrefFor = (p: Partial<Record<DrillParam, string>>) => {
    const q = new URLSearchParams(sp.toString());
    for (const k of DRILL_PARAMS) q.delete(k);
    for (const [k, v] of Object.entries(p)) if (v) q.set(k, v);
    return `?${q.toString()}`;
  };
  const orderHref = (n: number) => `/admin/reports?date=${r.date}&order=${n}`;

  if (!view) return null;
  const filters = readFilters(sp);
  const title =
    view === "tips"
      ? "Tips"
      : view === "net"
        ? "Net sales"
        : view === "collected"
          ? "Collected"
          : view === "tax"
            ? "Sales tax"
            : view === "tickets"
              ? "Tickets"
              : view === "refunds"
                ? "Refunds"
                : filters.item
                  ? filters.item
                  : filters.cat
                    ? filters.cat
                    : filters.pay
                      ? PAY_LABEL[filters.pay]
                      : "Orders";

  return (
    <Sheet title={title} subtitle={dayLabel} viewKey={`${view}`}>
      {view === "tips" && <TipsDrill r={r} drill={drill} canRecord={canRecord} orderHref={orderHref} splitParam={sp.get("split")} />}
      {view === "tax" && <TaxView r={r} hrefFor={hrefFor} orderHref={orderHref} />}
      {view === "tickets" && <TicketsView r={r} drill={drill} />}
      {view === "refunds" && <RefundsView r={r} drill={drill} orderHref={orderHref} />}
      {(view === "net" || view === "collected" || view === "orders") && <OrdersView view={view} r={r} filters={filters} hrefFor={hrefFor} orderHref={orderHref} />}
    </Sheet>
  );
}

// ---------- the sheet ----------

function Sheet({ title, subtitle, viewKey, children }: { title: string; subtitle: string; viewKey: string; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrill();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 print:hidden" onClick={closeDrill}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drill-title"
        tabIndex={-1}
        className="flex h-full w-full flex-col bg-[var(--background)] shadow-2xl outline-none sm:max-w-2xl sm:border-l sm:border-[var(--border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="drill-title" className="truncate text-lg font-bold leading-tight">
              {title}
            </h2>
            <p className="text-xs text-[var(--muted)]">{subtitle}</p>
          </div>
          <button type="button" onClick={closeDrill} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-lg hover:border-[var(--foreground)]" aria-label="Close">
            ✕
          </button>
        </header>
        <div key={viewKey} className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}

// ---------- small parts ----------

function Select({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="min-w-0 text-xs text-[var(--muted)]">
      {label}
      <select className="mt-0.5 block h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--foreground)]" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------- Net sales, Collected, Orders (and Card, Cash, an item, a category) ----------

function OrdersView({
  view,
  r,
  filters: f,
  hrefFor,
  orderHref,
}: {
  view: "net" | "collected" | "orders";
  r: DayReport;
  filters: Filters;
  hrefFor: (p: Partial<Record<DrillParam, string>>) => string;
  orderHref: (n: number) => string;
}) {
  // What each row's figure is: the part of the order this drill-down is about.
  const measure: { label: string; of: (o: DayOrder) => number } = f.item
    ? { label: `${f.item} on the order`, of: (o) => o.lines.filter((l) => l.name === f.item).reduce((s, l) => s + l.amount, 0) }
    : f.cat
      ? { label: `${f.cat} on the order, before discounts`, of: (o) => o.lines.filter((l) => inCategory(l.category, f.cat)).reduce((s, l) => s + l.amount, 0) }
      : f.pay === "card"
        ? { label: "Paid by card, less partial refunds", of: (o) => o.card - o.refundedCard }
        : f.pay === "cash"
          ? { label: "Paid in cash, less partial refunds", of: (o) => o.cash - o.refundedCash }
          : f.pay === "vouchers"
            ? { label: "Paid with vouchers", of: (o) => o.voucher }
            : f.pay === "online"
              ? { label: "Paid online, less partial refunds", of: (o) => o.total - o.refunded }
              : view === "net"
                ? { label: "Goods: before tax and tip, after discounts and partial refunds", of: goods }
                : view === "collected"
                  ? { label: "Money in, with tax and tip, less partial refunds", of: moneyIn }
                  : { label: "Order total, with tax and tip", of: (o) => o.total };

  const shown = r.orders.filter((o) => matches(o, f)).sort((a, b) => a.at.localeCompare(b.at));
  const counted = shown.filter((o) => o.status === "completed");
  const sum = round2(counted.reduce((s, o) => s + measure.of(o), 0));
  const cashiers = [...new Set(r.orders.map((o) => o.cashier ?? NO_CASHIER))].sort();
  const categories = [...new Set(r.orders.flatMap((o) => o.lines.map((l) => l.category)))].sort();
  const onlineTickets = r.ticketLines.filter((t) => t.online && t.revenue > 0);
  const ticketMoney = round2(onlineTickets.reduce((s, t) => s + t.revenue + t.tax, 0));
  const boothMoney = round2(r.boothLines.reduce((s, b) => s + b.fee + b.tax, 0));
  const set = (patch: Partial<Record<DrillParam, string | null>>) => setDrillParams(patch);
  const anyFilter = f.status !== "completed" || f.pay || f.who || f.cat || f.item || f.q;

  return (
    <>
      {view === "net" && (
        <Section title={money(r.netSales)} subtitle="Net sales: what sold, before tax and tips, after member discounts and partial refunds.">
          <Lines
            rows={[
              ...r.sold.map((s) => ({
                key: s.label,
                label: (
                  <>
                    {s.label}
                    {s.detail && <span className="ml-1.5 text-xs text-[var(--muted)]">{s.detail}</span>}
                  </>
                ),
                value: money(s.amount),
                href: s.label === TICKETS_LABEL ? hrefFor({ show: "tickets" }) : s.label === BOOTHS_LABEL ? hrefFor({ show: "orders", pay: "online" }) : hrefFor({ show: "orders", cat: s.label }),
              })),
              ...(r.discounts > 0 ? [{ key: "disc", label: "Member discounts", value: `−${money(r.discounts)}`, muted: true }] : []),
              ...(r.partialRefunds > 0 ? [{ key: "part", label: "Given back in partial refunds", value: `−${money(r.partialRefunds)}`, muted: true, href: hrefFor({ show: "refunds" }) }] : []),
              { key: "net", label: "Net sales", value: money(r.netSales), strong: true },
            ]}
          />
        </Section>
      )}

      {view === "collected" && (
        <Section title={money(r.collected)} subtitle="Collected: the money that came in, with tax and tips, less partial refunds.">
          <Lines
            rows={[
              { key: "card", label: "Card (register)", value: money(r.card), href: hrefFor({ show: "orders", pay: "card" }) },
              { key: "cash", label: "Cash (register)", value: money(r.cash), href: hrefFor({ show: "orders", pay: "cash" }) },
              { key: "online", label: "Online (tickets, booths, web orders)", value: money(r.online), href: hrefFor({ show: "orders", pay: "online" }) },
              { key: "total", label: "Collected", value: money(r.collected), strong: true },
              ...(r.vouchers > 0 ? [{ key: "v", label: "Vouchers used (no money in, not counted)", value: money(r.vouchers), muted: true, href: hrefFor({ show: "orders", pay: "vouchers" }) }] : []),
              { key: "tips", label: "Of it, tips", value: money(r.tips), muted: true, href: hrefFor({ show: "tips" }) },
              { key: "tax", label: "Of it, sales tax", value: money(r.tax), muted: true, href: hrefFor({ show: "tax" }) },
            ]}
          />
        </Section>
      )}

      {view === "orders" && f.pay === "card" && (
        <p className="text-xs text-[var(--muted)]">Card processing fees aren&apos;t recorded here; Stripe&apos;s dashboard has them per payment.</p>
      )}

      <Section
        title={view === "orders" && !f.pay && !f.cat && !f.item ? `${counted.length} finished order${counted.length === 1 ? "" : "s"}` : "The orders behind it"}
        subtitle={measure.label}
        action={
          anyFilter && view === "orders" ? (
            <DrillLink replace href={hrefFor({ show: "orders" })} className="text-[var(--muted)] hover:underline">
              All orders
            </DrillLink>
          ) : undefined
        }
      >
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Select
            label="Status"
            value={f.status}
            onChange={(v) => set({ status: v === "completed" ? null : v })}
            options={[
              { value: "completed", label: "Finished" },
              { value: "refunded", label: "Refunded" },
              { value: "voided", label: "Voided" },
              { value: "all", label: "All" },
            ]}
          />
          <Select
            label="Paid"
            value={f.pay}
            onChange={(v) => set({ pay: v || null })}
            options={[{ value: "", label: "Any way" }, ...(Object.keys(PAY_LABEL) as Pay[]).map((p) => ({ value: p, label: PAY_LABEL[p] }))]}
          />
          <Select label="Cashier" value={f.who} onChange={(v) => set({ who: v || null })} options={[{ value: "", label: "Anyone" }, ...cashiers.map((c) => ({ value: c, label: c === NO_CASHIER ? "No cashier" : c }))]} />
          <Select
            label="Category"
            value={f.cat}
            onChange={(v) => set({ cat: v || null })}
            options={[{ value: "", label: "Any" }, ...categories.map((c) => ({ value: c, label: c })), ...(f.cat === FOOD_AND_DRINK ? [{ value: FOOD_AND_DRINK, label: FOOD_AND_DRINK }] : [])]}
          />
          <label className="col-span-2 text-xs text-[var(--muted)] sm:col-span-4">
            Search
            <input
              className="mt-0.5 block h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--foreground)]"
              placeholder="Order #, item or tab name"
              defaultValue={f.q}
              onChange={(e) => set({ q: e.target.value || null })}
            />
          </label>
          {f.item && (
            <div className="col-span-2 flex items-center gap-2 text-sm sm:col-span-4">
              <span className="rounded-full border border-[var(--foreground)] px-3 py-1">Item: {f.item}</span>
              <button type="button" className="text-xs text-[var(--muted)] hover:underline" onClick={() => set({ item: null })}>
                Clear
              </button>
            </div>
          )}
        </div>

        <OrderList orders={shown} of={measure.of} orderHref={orderHref} />

        <div className="mt-3 border-t border-[var(--border)] pt-2 text-sm">
          <div className="flex items-baseline justify-between gap-3 font-semibold">
            <span>
              {counted.length} finished order{counted.length === 1 ? "" : "s"}
              {shown.length > counted.length && <span className="font-normal text-[var(--muted)]"> (refunded and voided ones aren&apos;t counted)</span>}
            </span>
            <span className="tabular-nums">{money(sum)}</span>
          </div>
          {view === "orders" && !f.pay && !f.cat && !f.item && counted.length > 0 && (
            <p className="mt-1 text-xs text-[var(--muted)]">
              Goods (before tax and tip): {money(counted.reduce((s, o) => s + goods(o), 0))}, an average of {money(counted.reduce((s, o) => s + goods(o), 0) / counted.length)} an order.
            </p>
          )}
          {(view === "net" || view === "collected" || f.pay === "online") && !f.who && !f.cat && !f.item && !f.q && (onlineTickets.length > 0 || r.boothLines.length > 0) && (
            <div className="mt-2 space-y-1 text-xs text-[var(--muted)]">
              {onlineTickets.length > 0 && (
                <div className="flex justify-between gap-3">
                  <DrillLink replace href={hrefFor({ show: "tickets" })} className="hover:underline">
                    Plus online tickets ({onlineTickets.reduce((s, t) => s + t.paid, 0)} paid){view === "net" ? ", before tax" : ", with tax"} ›
                  </DrillLink>
                  <span className="tabular-nums">{money(view === "net" ? onlineTickets.reduce((s, t) => s + t.revenue, 0) : ticketMoney)}</span>
                </div>
              )}
              {r.boothLines.length > 0 && (
                <div className="flex justify-between gap-3">
                  <span>
                    Plus {r.boothLines.length} booth booking{r.boothLines.length === 1 ? "" : "s"}
                    {view === "net" ? ", before tax" : ", with tax"}
                  </span>
                  <span className="tabular-nums">{money(view === "net" ? r.boothLines.reduce((s, b) => s + b.fee, 0) : boothMoney)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </Section>
    </>
  );
}

// One line per order, oldest first; the number opens the order (with its refund button).
export function OrderList({ orders, of, orderHref }: { orders: DayOrder[]; of: (o: DayOrder) => number; orderHref: (n: number) => string }) {
  if (orders.length === 0) return <p className="py-3 text-sm text-[var(--muted)]">No orders match.</p>;
  return (
    <ul className="divide-y divide-[var(--border)]">
      {orders.map((o) => {
        const off = o.status !== "completed";
        return (
          <li key={o.id} className={`flex items-baseline gap-3 py-2 text-sm ${off ? "text-[var(--muted)]" : ""}`}>
            <Link href={orderHref(o.orderNumber)} className="w-14 shrink-0 font-semibold tabular-nums underline-offset-2 hover:underline">
              #{o.orderNumber}
            </Link>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-[var(--muted)]">
                {time(o.at)}
                {o.cashier ? ` · ${o.cashier}` : o.source === "pos" ? "" : " · website"}
                {o.method ? ` · ${o.method}` : ""}
                {off ? ` · ${o.status}` : ""}
                {o.tip > 0 ? ` · tip ${money(o.tip)}` : ""}
              </div>
              <div className="truncate">
                {o.name && <span className="font-medium">{o.name}: </span>}
                {o.items}
              </div>
            </div>
            <span className={`shrink-0 font-semibold tabular-nums ${off ? "line-through" : ""}`}>{money(off ? o.total : of(o))}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Sales tax ----------

function TaxView({ r, hrefFor, orderHref }: { r: DayReport; hrefFor: (p: Partial<Record<DrillParam, string>>) => string; orderHref: (n: number) => string }) {
  const completed = r.orders.filter((o) => o.status === "completed");
  const sumTax = (os: DayOrder[]) => os.reduce((s, o) => s + o.tax, 0);
  const onlineTickets = r.ticketLines.filter((t) => t.online);
  const refundTax = completed.reduce((s, o) => s + o.refundedTax, 0);

  // Sales per category, taxable or not (lines before member discounts).
  const byCat = new Map<string, { taxable: number; free: number }>();
  const add = (cat: string, amount: number, taxed: boolean) => {
    const c = byCat.get(cat) ?? { taxable: 0, free: 0 };
    c[taxed ? "taxable" : "free"] += amount;
    byCat.set(cat, c);
  };
  for (const o of completed) for (const l of o.lines) add(l.category, l.amount, !o.taxFree);
  for (const t of onlineTickets) add("Online tickets", t.revenue, t.tax > 0);
  for (const b of r.boothLines) add("Booths", b.fee, b.tax > 0);
  const cats = [...byCat.entries()].sort((a, b) => b[1].taxable + b[1].free - (a[1].taxable + a[1].free));
  const taxFree = completed.filter((o) => o.taxFree);

  return (
    <>
      <Section title={money(r.tax)} subtitle="Sales tax collected, by where it came from.">
        <Lines
          rows={[
            { key: "pos", label: "Register orders", value: money(sumTax(completed.filter((o) => o.source === "pos"))), href: hrefFor({ show: "orders" }) },
            ...(completed.some((o) => o.source !== "pos") ? [{ key: "web", label: "Website orders", value: money(sumTax(completed.filter((o) => o.source !== "pos"))) }] : []),
            ...(onlineTickets.length ? [{ key: "tix", label: "Online tickets", value: money(onlineTickets.reduce((s, t) => s + t.tax, 0)), href: hrefFor({ show: "tickets" }) }] : []),
            ...(r.boothLines.length ? [{ key: "booth", label: "Booths", value: money(r.boothLines.reduce((s, b) => s + b.tax, 0)) }] : []),
            ...(refundTax > 0 ? [{ key: "ref", label: "Given back in partial refunds", value: `−${money(refundTax)}`, muted: true, href: hrefFor({ show: "refunds" }) }] : []),
            { key: "total", label: "Sales tax", value: money(r.tax), strong: true },
          ]}
        />
      </Section>

      <Section title="Taxable and tax-free sales" subtitle="By category, before member discounts. Tax is charged on the whole order, so it isn't split by category.">
        {cats.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Nothing sold this day.</p>
        ) : (
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-[var(--muted)]">
                <th className="pb-1.5 font-medium">Category</th>
                <th className="pb-1.5 text-right font-medium">Taxable</th>
                <th className="pb-1.5 text-right font-medium">No tax</th>
              </tr>
            </thead>
            <tbody>
              {cats.map(([cat, v]) => (
                <tr key={cat} className="border-t border-[var(--border)]">
                  <td className="py-1.5">{cat}</td>
                  <td className="py-1.5 text-right">{money(v.taxable)}</td>
                  <td className="py-1.5 text-right">{v.free > 0 ? money(v.free) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={`Rung up tax-free · ${taxFree.length}`} subtitle="Register orders marked tax-free (a nonprofit, say). Online tickets and booths without tax were sold before tax was added to them.">
        <OrderList orders={taxFree} of={goods} orderHref={orderHref} />
      </Section>
    </>
  );
}

// ---------- Tickets ----------

function TicketsView({ r, drill }: { r: DayReport; drill: DayDrillData }) {
  const groups = new Map<string, { online: number; register: number; free: number; revenue: number }>();
  for (const t of r.ticketLines) {
    const key = t.screeningId ?? "";
    const g = groups.get(key) ?? { online: 0, register: 0, free: 0, revenue: 0 };
    g[t.online ? "online" : "register"] += t.paid;
    g.free += t.free;
    g.revenue += t.revenue;
    groups.set(key, g);
  }
  const rows = [...groups.entries()]
    .map(([id, g]) => ({ id, show: drill.showings[id], ...g }))
    .sort((a, b) => (a.show?.startsAt ?? "").localeCompare(b.show?.startsAt ?? ""));
  const seats = (g: { online: number; register: number; free: number }) =>
    [g.online ? `${g.online} online` : "", g.register ? `${g.register} at the register` : "", g.free ? `${g.free} free` : ""].filter(Boolean).join(" · ") || "none";

  return (
    <Section title={`${r.ticketsSold} ticket${r.ticketsSold === 1 ? "" : "s"}`} subtitle="By showing, counted on the day they were sold (a ticket sold today for Friday counts today). Free: Insiders+ seats and free shows. Money before tax.">
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No tickets sold this day.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)] text-sm tabular-nums">
          {rows.map((g) => (
            <li key={g.id} className="flex items-baseline gap-3 py-2">
              <div className="min-w-0 flex-1">
                {g.show?.title ?? "A showing no longer listed"}
                {g.show && (
                  <span className="block text-xs text-[var(--muted)]">
                    {g.show.startsAt ? new Date(g.show.startsAt).toLocaleString("en-US", { weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) : ""}
                    {g.show.room ? ` · ${g.show.room}` : ""}
                  </span>
                )}
                <span className="block text-xs">{seats(g)}</span>
              </div>
              <span className="shrink-0 font-semibold">{money(g.revenue)}</span>
            </li>
          ))}
          <li className="flex items-baseline gap-3 border-t-2 border-[var(--foreground)] py-2 font-semibold">
            <div className="min-w-0 flex-1">
              Total
              <span className="block text-xs font-normal">{seats(r.tickets)}</span>
            </div>
            <span className="shrink-0">{money(r.tickets.revenue)}</span>
          </li>
        </ul>
      )}
    </Section>
  );
}

// ---------- Refunds ----------

function RefundsView({ r, drill, orderHref }: { r: DayReport; drill: DayDrillData; orderHref: (n: number) => string }) {
  const full = drill.refunds.filter((x) => x.kind === "full");
  const partial = drill.refunds.filter((x) => x.kind === "partial");
  const voided = r.orders.filter((o) => o.status === "voided");
  const partialTotal = partial.reduce((s, x) => s + x.amount, 0);
  const fullTotal = full.reduce((s, x) => s + x.amount, 0);

  return (
    <>
      <Section title="Refunds and voids" subtitle="Refunds come off the day the order was sold.">
        <Lines
          rows={[
            { key: "p", label: `Partial refunds · ${partial.length}`, value: money(partialTotal) },
            { key: "pg", label: "Of it, goods (taken off net sales)", value: money(r.partialRefunds), muted: true },
            { key: "f", label: `Refunded in full · ${full.length}`, value: money(fullTotal) },
            { key: "fn", label: "Full refunds aren't counted in any figure (the sale is left out altogether).", value: "", muted: true },
            { key: "v", label: `Voided · ${voided.length}`, value: voided.length ? money(voided.reduce((s, o) => s + o.total, 0)) : "—" },
          ]}
        />
      </Section>

      {drill.refunds.length > 0 && (
        <Section title="Each refund">
          <ul className="divide-y divide-[var(--border)] text-sm">
            {[...partial, ...full].map((x, i) => (
              <li key={`${x.orderId}-${i}`} className="py-2">
                <div className="flex items-baseline gap-2">
                  <Link href={orderHref(x.orderNumber)} className="font-semibold tabular-nums hover:underline">
                    #{x.orderNumber}
                  </Link>
                  <span className={`rounded-full border px-2 text-xs ${x.kind === "full" ? "border-[var(--danger-text)] text-[var(--danger-text)]" : "border-[var(--border)] text-[var(--muted)]"}`}>{x.kind === "full" ? "Full" : "Partial"}</span>
                  <span className="ml-auto font-semibold tabular-nums">{money(x.amount)}</span>
                </div>
                <div className="mt-0.5 text-xs text-[var(--muted)]">
                  Sold {time(x.soldAt)}
                  {x.at ? ` · refunded ${time(x.at)}` : ""}
                  {x.kind === "partial" && (x.card > 0 || x.cash > 0) ? ` · ${[x.card > 0 ? `${money(x.card)} to the card` : "", x.cash > 0 ? `${money(x.cash)} cash` : ""].filter(Boolean).join(", ")}` : ""}
                </div>
                <div className="text-xs">
                  Approved by {x.approvedBy ?? <span className="text-[var(--muted)]">the shared PIN (or not recorded)</span>}
                  {x.refundedBy ? ` · signed in: ${x.refundedBy}` : ""}
                </div>
                {x.reason && <div className="text-xs italic text-[var(--muted)]">&ldquo;{x.reason}&rdquo;</div>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {voided.length > 0 && (
        <Section title="Voided" subtitle="Cancelled before any money changed hands.">
          <OrderList orders={voided} of={(o) => o.total} orderHref={orderHref} />
        </Section>
      )}
    </>
  );
}

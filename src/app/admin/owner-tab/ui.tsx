import type { MonthStatus, OwnerMonth, OwnerTabOrder } from "@/lib/data/owner-tab";

// Small pieces the Owner tab page and its statements share.

export const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
export const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" });
export const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
// A plain date ("2026-11-02"), as written.
export const plainDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export const statementHref = (ownerId: string, month: string) => `/admin/owner-tab/statement?owner=${ownerId}&month=${month}`;

// Where a month's statement stands.
export function StatusPill({ m }: { m: Pick<OwnerMonth, "status" | "balance"> }) {
  const text: Record<MonthStatus, string> = {
    running: "This month, still running",
    settled: "Settled",
    part: `Part paid · ${money(m.balance)} left`,
    unpaid: "Not paid",
    credit: `Paid ${money(-m.balance)} more than owed`,
  };
  const tone =
    m.status === "settled"
      ? "border-[var(--success-text)] text-[var(--success-text)]"
      : m.status === "unpaid" || m.status === "part"
        ? "border-[var(--danger-text)] text-[var(--danger-text)]"
        : "border-[var(--border)] text-[var(--muted)]";
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}>{text[m.status]}</span>;
}

// An order taken off the tab: by which owner, and why. An inline block, so
// the struck-out row's line doesn't run through it.
export function RemovedNote({ order, suffix = "" }: { order: Pick<OwnerTabOrder, "removedBy" | "removedReason">; suffix?: string }) {
  return (
    <span className="inline-block whitespace-normal text-xs text-[var(--danger-text)]">
      Taken off{order.removedBy ? ` by ${order.removedBy}` : ""}
      {order.removedReason ? `: ${order.removedReason}` : ""}
      {suffix}
    </span>
  );
}

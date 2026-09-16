import Link from "next/link";
import { getDashboardSummary } from "@/lib/data/reports";

export const dynamic = "force-dynamic";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default async function AdminDashboardPage() {
  const summary = await getDashboardSummary();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          ["Today's revenue", money(summary.todaysRevenue)],
          ["Today's orders", String(summary.todaysOrders)],
          ["Total members", String(summary.totalMembers)],
          ["Free/community members", String(summary.compedMembers)],
          ["Upcoming screenings", String(summary.upcomingScreenings)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
            <div className="text-xs text-neutral-500">{label}</div>
            <div className="mt-1 text-lg font-semibold">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
      <Link
        href="/admin/menu"
        className="rounded-xl border border-neutral-200 bg-white p-5 hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950"
      >
        <div className="text-base font-medium">Menu management</div>
        <div className="mt-1 text-sm text-neutral-500">Categories, items, prices, and modifiers.</div>
      </Link>
      <Link
        href="/admin/screenings"
        className="rounded-xl border border-neutral-200 bg-white p-5 hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950"
      >
        <div className="text-base font-medium">Showtime scheduler</div>
        <div className="mt-1 text-sm text-neutral-500">Movies, screening times, rooms.</div>
      </Link>
      <Link
        href="/admin/members"
        className="rounded-xl border border-neutral-200 bg-white p-5 hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950"
      >
        <div className="text-base font-medium">Members</div>
        <div className="mt-1 text-sm text-neutral-500">Loyalty tiers, points, monthly membership.</div>
      </Link>
      <Link
        href="/admin/events"
        className="rounded-xl border border-neutral-200 bg-white p-5 hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950"
      >
        <div className="text-base font-medium">Event bookings</div>
        <div className="mt-1 text-sm text-neutral-500">Deposits, balances, and venue rentals.</div>
      </Link>
      <Link
        href="/pos"
        className="rounded-xl border border-neutral-200 bg-white p-5 hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950"
      >
        <div className="text-base font-medium">Point of sale</div>
        <div className="mt-1 text-sm text-neutral-500">Ring up an order.</div>
      </Link>
      <Link
        href="/admin/reports"
        className="rounded-xl border border-neutral-200 bg-white p-5 hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950"
      >
        <div className="text-base font-medium">Reports</div>
        <div className="mt-1 text-sm text-neutral-500">Sales, top sellers, tips, order history.</div>
      </Link>
      <Link
        href="/display/kitchen"
        className="rounded-xl border border-neutral-200 bg-white p-5 hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950"
      >
        <div className="text-base font-medium">Kitchen display</div>
        <div className="mt-1 text-sm text-neutral-500">Live prep tickets as POS orders complete.</div>
      </Link>
      <Link
        href="/display/box-office"
        className="rounded-xl border border-neutral-200 bg-white p-5 hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950"
      >
        <div className="text-base font-medium">Box office signage</div>
        <div className="mt-1 text-sm text-neutral-500">Lobby showtimes display.</div>
      </Link>
      </div>
    </div>
  );
}

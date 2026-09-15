import Link from "next/link";

export default function AdminDashboardPage() {
  return (
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
    </div>
  );
}

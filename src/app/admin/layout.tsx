import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { signOut } from "@/app/login/actions";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h1 className="text-xl font-semibold">Royale Cinema Lounge — Back office</h1>
        <nav className="flex flex-wrap items-center gap-4 text-sm">
          <Link href="/admin" className="hover:underline">
            Dashboard
          </Link>
          <Link href="/admin/menu" className="hover:underline">
            Menu
          </Link>
          <Link href="/admin/ingredients" className="hover:underline">
            Ingredients
          </Link>
          <Link href="/admin/screenings" className="hover:underline">
            Showtimes
          </Link>
          <Link href="/admin/members" className="hover:underline">
            Members
          </Link>
          <Link href="/admin/events" className="hover:underline">
            Events
          </Link>
          <Link href="/admin/booths" className="hover:underline">
            Booths
          </Link>
          <Link href="/admin/reports" className="hover:underline">
            Reports
          </Link>
          <Link href="/admin/schedule-graphic" className="hover:underline">
            Schedule graphic
          </Link>
          <Link href="/" className="text-neutral-500 hover:underline">
            View site
          </Link>
          <span className="text-neutral-400">|</span>
          <span className="text-neutral-500">{staff.name}</span>
          <form action={signOut}>
            <button type="submit" className="text-neutral-500 hover:underline">
              Sign out
            </button>
          </form>
        </nav>
      </div>
      {children}
    </div>
  );
}

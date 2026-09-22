import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { getOpenDevNoteCount } from "@/lib/data/devNotes";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const openDevNotes = staff.role === "admin" ? await getOpenDevNoteCount() : 0;

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
          {staff.role === "admin" && (
            <Link href="/admin/dev-notes" className="hover:underline">
              Develop Mate{openDevNotes > 0 && <span className="ml-1 rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-bold text-white">{openDevNotes}</span>}
            </Link>
          )}
          <Link href="/" className="text-[var(--muted)] hover:underline">
            View site
          </Link>
          <span className="text-[var(--muted)]">|</span>
          <span className="text-[var(--muted)]">{staff.name}</span>
          <form action={signOut}>
            <button type="submit" className="text-[var(--muted)] hover:underline">
              Sign out
            </button>
          </form>
        </nav>
      </div>
      {children}
    </div>
  );
}

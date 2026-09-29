import Link from "next/link";
import { requireStaff, hasAdminAccess, hasManagerAccess } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { getOpenDevNoteCount } from "@/lib/data/devNotes";
import { getPinStatus } from "@/lib/data/employees";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const isAdmin = hasAdminAccess(staff.role);
  const [openDevNotes, pinStatus] = await Promise.all([isAdmin ? getOpenDevNoteCount() : 0, getPinStatus(staff.employeeId)]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h1 className="text-xl font-semibold">Royale Cinema Lounge — Back office</h1>
        <nav className="flex flex-wrap items-center gap-4 text-sm">
          <Link href="/admin" className="hover:underline">
            Dashboard
          </Link>
          <Link href="/pos" className="hover:underline">
            Point of sale
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
          {hasManagerAccess(staff.role) && (
            <Link href="/admin/team" className="hover:underline">
              Team
            </Link>
          )}
          <Link href="/admin/schedule-graphic" className="hover:underline">
            Schedule graphic
          </Link>
          <Link href="/display" className="hover:underline">
            Displays
          </Link>
          {isAdmin && (
            <Link href="/admin/dev-notes" className="hover:underline">
              Dev Notes{openDevNotes > 0 && <span className="ml-1 rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-bold text-white">{openDevNotes}</span>}
            </Link>
          )}
          {staff.role === "owner" && (
            <Link href="/admin/staff" className="hover:underline">
              Staff
            </Link>
          )}
          <Link href="/" className="text-[var(--muted)] hover:underline">
            View site
          </Link>
          <span className="text-[var(--muted)]">|</span>
          <span className="text-[var(--muted)]">{staff.name}</span>
          <Link href="/admin/my-pin" className="text-[var(--muted)] hover:underline">
            My PIN
          </Link>
          <form action={signOut}>
            <button type="submit" className="text-[var(--muted)] hover:underline">
              Sign out
            </button>
          </form>
        </nav>
      </div>
      {/* Everyone started on 9999, and it keeps working until they pick
          their own -- this nags until they do (src/app/admin/my-pin). */}
      {(pinStatus === "default" || pinStatus === "temporary") && (
        <div className="notice notice-warn mb-6 flex flex-wrap items-center justify-between gap-2">
          <span>
            {pinStatus === "default" ? "Your PIN is still 9999, the one everyone knows. Pick your own." : "You're on a temporary PIN the owner set. Pick your own."}
            {hasManagerAccess(staff.role) && " Until you do, anyone who knows it can approve refunds as you."}
          </span>
          <Link href="/admin/my-pin" className="font-bold underline">
            Set my PIN
          </Link>
        </div>
      )}
      {children}
    </div>
  );
}

import Link from "next/link";
import { requireMember } from "@/lib/member-auth";
import { getStaffSession, hasAdminAccess } from "@/lib/auth";
import { getMemberBookings, getMemberOrders, getWatchedMovies } from "@/lib/data/member-account";
import MemberQrCode from "@/components/MemberQrCode";
import MoviePoster from "@/components/MoviePoster";
import SignOutButton from "./SignOutButton";
import BillingPortalButton from "./BillingPortalButton";
import AvatarUpload from "./AvatarUpload";

export const dynamic = "force-dynamic";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
}

export default async function AccountPage() {
  const member = await requireMember();
  const [bookings, orders, watched, staffSession] = await Promise.all([
    getMemberBookings(member.id),
    getMemberOrders(member.id),
    getWatchedMovies(member.id),
    getStaffSession(),
  ]);
  const isStaffAdmin = !!staffSession && hasAdminAccess(staffSession.role);

  const purchases = [
    ...bookings.map((b) => ({
      id: `booking-${b.id}`,
      date: b.created_at,
      label: `${b.quantity}× ${b.screening.movie.title}`,
      amount: b.unit_price * b.quantity,
      status: b.status,
    })),
    ...orders.map((o) => ({
      id: `order-${o.id}`,
      date: o.completed_at,
      label: `Order #${o.order_number} (${o.item_count} item${o.item_count === 1 ? "" : "s"})`,
      amount: o.total,
      status: "completed",
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <AvatarUpload name={member.name} avatarUrl={member.avatar_url} />
          <div>
            <div className="eyebrow mb-2">My account</div>
            <h1 className="font-display text-3xl font-semibold">{member.name}</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {member.email} · {member.tier}
              {member.tier === "Insiders+" && member.subscription_status ? ` (${member.subscription_status})` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isStaffAdmin && (
            <Link href="/admin" className="btn-secondary !px-4 !py-2 text-sm">
              Back office
            </Link>
          )}
          <SignOutButton />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card">
          <div className="eyebrow mb-2">Points balance</div>
          <div className="font-display text-3xl font-semibold text-[var(--accent)]">{Math.round(member.points)}</div>
          <p className="mt-1 text-sm text-[var(--muted)]">100 pts = $5 off at the register.</p>
        </div>
        <div className="card flex items-center gap-4">
          <MemberQrCode memberId={member.id} />
          <div>
            <div className="eyebrow mb-1">Member ID</div>
            <p className="text-sm text-[var(--muted)]">Show this at the register or door to scan in as a member.</p>
          </div>
        </div>
      </div>

      {member.tier === "Insiders+" ? (
        <div className="card flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="eyebrow mb-1">Subscription</div>
            <p className="text-sm text-[var(--muted)]">
              {member.price_tier ? `${member.price_tier[0].toUpperCase()}${member.price_tier.slice(1)} plan` : "Insiders+"} ·{" "}
              {member.subscription_status ?? "unknown status"}
            </p>
          </div>
          {member.stripe_customer_id && <BillingPortalButton />}
        </div>
      ) : (
        <div className="card flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="eyebrow mb-1">Upgrade</div>
            <p className="text-sm text-[var(--muted)]">Get unlimited free entry to every screening with Insiders+.</p>
          </div>
          <Link href="/membership" className="btn-secondary">
            Explore Insiders+
          </Link>
        </div>
      )}

      {watched.length > 0 && (
        <section>
          <h2 className="font-display mb-4 text-xl font-semibold">Movies you&apos;ve seen at RCL</h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {watched.map((w) => (
              <div key={w.title}>
                <MoviePoster posterUrl={w.poster_url} title={w.title} sizes="150px" />
                <div className="mt-1 text-xs text-[var(--muted)]">{dateLabel(w.watched_at)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="font-display mb-4 text-xl font-semibold">Purchase history</h2>
        {purchases.length === 0 ? (
          <div className="card text-sm text-[var(--muted)]">No purchases yet.</div>
        ) : (
          <div className="space-y-2">
            {purchases.map((p) => (
              <div key={p.id} className="card-flat flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{p.label}</div>
                  <div className="text-xs text-[var(--muted)]">
                    {dateLabel(p.date)}
                    {p.status !== "confirmed" && p.status !== "completed" ? ` · ${p.status}` : ""}
                  </div>
                </div>
                <div className="text-sm font-semibold text-[var(--accent)]">{money(p.amount)}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

import Link from "next/link";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DISPLAYS = [
  { href: "/display/kitchen", title: "Kitchen", description: "Food prep tickets -- tap an item to mark it ready." },
  { href: "/display/bar", title: "Bar", description: "Drink prep tickets -- tap an item to mark it ready." },
  { href: "/display/customer", title: "Customer-facing", description: "Point-of-service tablet: this week's lineup, sign in by phone, live order as it's rung up." },
  { href: "/display/box-office", title: "Box office signage", description: "Lobby showtimes board. Public -- no sign-in needed on this one." },
];

// The hub Andrew asked for: log into the admin side on whichever tablet,
// come here, pick which live display this particular device is for. Each
// choice below is its own full-screen page -- once picked, that tablet just
// stays on it.
export default async function DisplayHubPage() {
  await requireStaff();
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="font-display mb-1 text-2xl">Live displays</h1>
      <p className="mb-6 text-sm text-[var(--muted)]">Pick which display this device shows.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {DISPLAYS.map((d) => (
          <Link key={d.href} href={d.href} className="card-flat block !p-5">
            <div className="text-lg font-medium">{d.title}</div>
            <div className="mt-1 text-sm text-[var(--muted)]">{d.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

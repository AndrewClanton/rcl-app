import Link from "next/link";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DISPLAYS: { href: string; title: string; description: string; variants?: { href: string; label: string }[] }[] = [
  { href: "/display/kitchen", title: "Kitchen", description: "Food prep tickets -- tap an item to mark it ready." },
  { href: "/display/bar", title: "Bar", description: "Drink prep tickets -- tap an item to mark it ready." },
  { href: "/display/customer", title: "Customer-facing", description: "Point-of-service tablet: this week's lineup, sign in by phone, live order as it's rung up." },
  { href: "/display/box-office", title: "Box office signage", description: "Lobby showtimes board. Public -- no sign-in needed on this one." },
  {
    href: "/display/ramp",
    title: "Ramp TV (portrait)",
    description:
      "Big poster + countdown to the next film; stays on it 20 minutes after it starts, then moves to the next. If the TV only outputs landscape it turns itself upright -- use the other direction if it comes out upside down.",
    variants: [
      { href: "/display/ramp?rotate=ccw", label: "Turn the other way" },
      { href: "/display/ramp?rotate=off", label: "No rotation" },
    ],
  },
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
          <div key={d.href} className="card-flat !p-5">
            <Link href={d.href} className="block">
              <div className="text-lg font-medium">{d.title}</div>
              <div className="mt-1 text-sm text-[var(--muted)]">{d.description}</div>
            </Link>
            {d.variants && (
              <div className="mt-3 flex flex-wrap gap-3 text-xs">
                {d.variants.map((v) => (
                  <Link key={v.href} href={v.href} className="text-[var(--accent)] hover:underline">
                    {v.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

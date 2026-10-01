"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/account", label: "Overview" },
  { href: "/account/points", label: "Points" },
  { href: "/account/purchases", label: "Purchases" },
  { href: "/account/movies", label: "Movies" },
  { href: "/account/billing", label: "Billing" },
  { href: "/account/profile", label: "Profile" },
  { href: "/account/email", label: "Emails" },
];

export default function AccountNav() {
  const path = usePathname();
  return (
    <nav aria-label="Account" className="-mx-4 overflow-x-auto px-4 pb-2">
      <ul className="flex min-w-max gap-2">
        {TABS.map((t) => {
          const active = t.href === "/account" ? path === "/account" : path.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link href={t.href} aria-current={active ? "page" : undefined} className={`day-chip inline-block ${active ? "day-chip-today" : ""}`}>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

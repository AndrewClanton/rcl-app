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
];

export default function AccountNav() {
  const path = usePathname();
  return (
    <nav aria-label="Account" className="-mx-4 overflow-x-auto overflow-y-hidden border-b border-[var(--border)] px-4">
      <ul className="flex min-w-max gap-6 text-sm font-bold">
        {TABS.map((t) => {
          const active = t.href === "/account" ? path === "/account" : path.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`-mb-px inline-block border-b-2 py-3 transition-colors ${
                  active ? "border-[var(--accent)] text-[var(--foreground)]" : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

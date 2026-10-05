"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// The Reports tabs. On a phone they scroll sideways inside their own strip
// (the page itself never does), and the open one is brought into view.
const TABS = [
  { href: "/admin/reports", label: "Day" },
  { href: "/admin/reports/week", label: "Week" },
  { href: "/admin/reports/month", label: "Month" },
  { href: "/admin/reports/box-office", label: "Box office" },
  { href: "/admin/reports/tax", label: "Sales tax" },
  { href: "/admin/reports/bar", label: "Bar usage" },
  { href: "/admin/reports/members", label: "Members" },
  { href: "/admin/reports/organizations", label: "Organizations" },
  // Managers and up (the pages check too).
  { href: "/admin/reports/usage", label: "Website usage", managers: true },
  { href: "/admin/reports/register-checks", label: "Register checks", managers: true },
];

function activeTab(pathname: string) {
  if (pathname === "/admin/reports" || pathname.startsWith("/admin/reports/daily")) return "/admin/reports";
  return TABS.find((t) => t.href !== "/admin/reports" && pathname.startsWith(t.href))?.href ?? null;
}

export default function ReportsNav({ manager = false }: { manager?: boolean }) {
  const pathname = usePathname();
  const active = activeTab(pathname);
  const tabs = TABS.filter((t) => manager || !t.managers);
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>("[aria-current=page]");
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);

  return (
    // Bleeds to the edges of the page's padding (px-4, md:px-6, xl:px-8 in
    // the back office frame) so the pinned strip covers what scrolls under it.
    <nav aria-label="Reports" className="sticky top-0 z-20 -mx-4 bg-[var(--background)]/95 px-4 py-2 backdrop-blur md:-mx-6 md:px-6 xl:-mx-8 xl:px-8 print:hidden">
      <div ref={strip} className="flex gap-1 overflow-x-auto rounded-full border border-[var(--border)] bg-[var(--surface)] p-1 [scrollbar-width:none] sm:inline-flex">
        {tabs.map((t) => {
          const on = t.href === active;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors ${on ? "bg-[var(--foreground)] text-[var(--background)]" : "text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"}`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

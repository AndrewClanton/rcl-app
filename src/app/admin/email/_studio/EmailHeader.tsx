import Link from "next/link";
import { areaLabel } from "@/app/admin/_nav/areas";
import NewEmail from "./NewEmail";

// The top of the Email pages: the area, a big "Email", New email (ink),
// and the tabs. Each tab is its own page (/admin/email, /campaigns,
// /automations, /suppressions, /settings) that renders this with its own
// tab marked, so the composer and Ready to send keep their own headers.
// The never-mail list is for admins, so only they see its tab (its page
// checks again).

export type EmailTab = "overview" | "campaigns" | "automations" | "suppressions" | "settings";

const TABS: { key: EmailTab; href: string; label: string; admin?: boolean }[] = [
  { key: "overview", href: "/admin/email", label: "Overview" },
  { key: "campaigns", href: "/admin/email/campaigns", label: "Campaigns" },
  { key: "automations", href: "/admin/email/automations", label: "Automations" },
  { key: "suppressions", href: "/admin/email/suppressions", label: "Never-mail list", admin: true },
  { key: "settings", href: "/admin/email/settings", label: "Settings" },
];

export default function EmailHeader({ tab, isAdmin, purpose }: { tab: EmailTab; isAdmin: boolean; purpose?: string }) {
  return (
    <header className="bo-area-guests mb-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="bo-eyebrow mb-1.5">
            <span className="bo-dot" />
            {areaLabel("guests")}
          </div>
          <h1 className="font-display text-4xl leading-none sm:text-5xl">Email</h1>
          {purpose && <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">{purpose}</p>}
        </div>
        <NewEmail />
      </div>
      <nav aria-label="Email sections" className="flex flex-wrap gap-x-6 border-b border-[var(--border)] sm:gap-x-7">
        {TABS.filter((t) => !t.admin || isAdmin).map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.key === tab ? "page" : undefined}
            className={`-mb-px inline-flex min-h-11 items-center border-b-[3px] ${t.key === tab ? "border-[var(--foreground)] font-bold text-[var(--foreground)]" : "border-transparent font-semibold text-[var(--muted)] hover:text-[var(--foreground)]"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

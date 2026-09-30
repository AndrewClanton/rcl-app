import Link from "next/link";
import { areaLabel, type AreaKey } from "@/app/admin/_nav/areas";

// The top of every back-office page: which area you're in (in that area's
// color, the same as the menu), the page's name, one line on what it's for,
// and its main buttons on the right. Anything else that belongs up top (a
// row of tabs, a week picker) goes in as children, under the title.
//
// titleAside sits right next to the title, for a small extra like a help
// "i" button. No browser code here, so it works on any page.
export default function PageHeader({
  title,
  titleAside,
  purpose,
  area,
  eyebrow,
  back,
  actions,
  children,
  className = "",
}: {
  title: React.ReactNode;
  titleAside?: React.ReactNode;
  purpose?: React.ReactNode;
  area?: AreaKey;
  eyebrow?: React.ReactNode; // instead of the area's name
  back?: { href: string; label: string };
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const kicker = eyebrow ?? (area ? areaLabel(area) : null);
  return (
    <header className={`mb-6 ${area ? `bo-area-${area}` : ""} ${className}`}>
      {back && (
        <Link href={back.href} className="-ml-1 mb-1 inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)] print:hidden">
          <span aria-hidden>←</span> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-72">
          {kicker && (
            <div className="bo-eyebrow mb-1.5">
              {area && <span className="bo-dot" />}
              {kicker}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="text-2xl font-bold leading-tight">{title}</h1>
            {titleAside}
          </div>
          {purpose && <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">{purpose}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </header>
  );
}

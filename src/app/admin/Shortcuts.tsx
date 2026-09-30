"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { pickShortcuts, type ShortcutEntry } from "./_nav/shortcuts";
import { rankVisits, subscribeVisits, visitsSnapshot } from "./_nav/visits";

// Today → Your shortcuts: the pages this person opens most on this device,
// topped up with what people in their role use most. The page arrives with
// the role's list; this device's own picks replace it as soon as it loads.

export default function Shortcuts({
  employeeId,
  entries,
  fromRole,
  defaults,
  roleName,
}: {
  employeeId: string;
  entries: ShortcutEntry[];
  fromRole: string[]; // hrefs, most used by the role first
  defaults: string[];
  roleName: string; // "managers"
}) {
  const raw = useSyncExternalStore(
    subscribeVisits,
    () => visitsSnapshot(employeeId),
    () => null
  );
  const mine = rankVisits(raw).map((v) => v.href);
  const picked = pickShortcuts(entries, [mine, fromRole, defaults]);
  const ownCount = picked.filter((p) => mine.includes(p.href)).length;

  if (picked.length === 0) return null;
  return (
    <section aria-labelledby="shortcuts-heading">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h2 id="shortcuts-heading" className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
          Your shortcuts
        </h2>
        <p className="text-xs text-[var(--muted)]">
          {ownCount === 0
            ? `What ${roleName} open most. Yours take over as you use the back office on this device.`
            : ownCount === picked.length
              ? "The pages you open most on this device."
              : `The pages you open most on this device, then what ${roleName} open most.`}
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {picked.map((s) => (
          <li key={s.href} className="min-w-0">
            <Link
              href={s.href}
              title={s.about}
              className={`bo-card flex min-h-12 items-center gap-2 !px-3 !py-2 text-sm font-semibold hover:bg-[var(--surface-hover)] ${s.area ? `bo-area-${s.area}` : ""}`}
            >
              <span className="bo-dot" />
              <span className="min-w-0 flex-1 leading-tight">{s.label}</span>
              <span aria-hidden className="text-[var(--muted)]">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

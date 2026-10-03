import Link from "next/link";
import { hasAdminAccess, requireManager } from "@/lib/auth";
import { automationStats } from "@/lib/email/reports";
import EmailHeader from "../_studio/EmailHeader";
import { ensureAutomations } from "@/lib/email/automations";
import { AUTOMATION_LABEL, EXCLUSION_LABEL, type Automation, type Exclusion } from "@/lib/email/types";
import AutomationSwitch from "./AutomationSwitch";
import { senderCheck } from "@/lib/email/senders";

export const dynamic = "force-dynamic";

// The automatic emails: each step on or off (admins), its template, and
// what it sent in the last 30 days. They all go through the same caps,
// preferences and never-mail list as everything else.

export default async function AutomationsPage() {
  const staff = await requireManager();
  // Switching one on is for whoever sends email; off is a stop, so admins too.
  const sends = (await senderCheck(staff).catch(() => null))?.ok ?? false;
  const rows = await ensureAutomations().catch(() => []);
  const stats = await automationStats(rows.map((r) => r.id));

  return (
    <div className="space-y-5">
      <EmailHeader tab="automations" isAdmin={hasAdminAccess(staff.role)} />
      <p className="max-w-3xl text-sm text-[var(--muted)]">
        Emails that send themselves: welcome, birthday, the Insiders+ nudge, win-backs and “Still want these?”. Each starts off; switch them on during warm-up.
      </p>
      {rows.length === 0 && <p className="notice notice-warn text-sm">Couldn&apos;t load the automations. The email migration may not be applied yet.</p>}
      <ul className="space-y-3">
        {rows.map((r, i) => {
          const a = r.automation as Automation;
          const s = stats[i];
          const excluded = Object.entries(r.excluded ?? {}).filter(([, n]) => (n ?? 0) > 0) as [Exclusion, number][];
          return (
            <li key={r.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-display text-lg">{AUTOMATION_LABEL[a].label}</div>
                  <div className="text-sm text-[var(--muted)]">{AUTOMATION_LABEL[a].about}</div>
                  <div className="mt-1 text-sm">
                    &ldquo;{r.subject}&rdquo;{" "}
                    <Link href={`/admin/email/${r.id}`} className="inline-flex min-h-11 items-center font-semibold text-[var(--accent-hover)] hover:underline sm:min-h-0">
                      Edit the email
                    </Link>
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    Last 30 days: {s.sent} sent, {s.delivered} delivered, {s.clicked} clicked.
                    {excluded.length ? ` Last run left out: ${excluded.map(([k, n]) => `${EXCLUSION_LABEL[k]} ${n}`).join(", ")}.` : ""}
                  </div>
                  {r.error && <div className="mt-1 text-xs text-[var(--danger-text)]">{r.error}</div>}
                </div>
                <AutomationSwitch automation={a} on={r.status === "active"} canChange={sends || (r.status === "active" && hasAdminAccess(staff.role))} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

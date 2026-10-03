import Link from "next/link";
import { hasAdminAccess, requireManager } from "@/lib/auth";
import { automationStats } from "@/lib/email/reports";
import PageHeader from "@/components/admin/PageHeader";
import { ensureAutomations } from "@/lib/email/automations";
import { AUTOMATION_LABEL, EXCLUSION_LABEL, type Automation, type Exclusion } from "@/lib/email/types";
import AutomationSwitch from "./AutomationSwitch";

export const dynamic = "force-dynamic";

// The automatic emails: each step on or off (admins), its template, and
// what it sent in the last 30 days. They all go through the same caps,
// preferences and never-mail list as everything else.

export default async function AutomationsPage() {
  const staff = await requireManager();
  const rows = await ensureAutomations().catch(() => []);
  const stats = await automationStats(rows.map((r) => r.id));

  return (
    <div className="space-y-4">
      <PageHeader
        area="guests"
        back={{ href: "/admin/email", label: "Email" }}
        title="Automations"
        purpose="Emails that send themselves: welcome, birthday, the Insiders+ nudge, win-backs and “Still want these?”. Each starts off; switch them on during warm-up."
      />
      {rows.length === 0 && <p className="notice notice-warn text-sm">Couldn&apos;t load the automations. The email migration may not be applied yet.</p>}
      <ul className="space-y-3">
        {rows.map((r, i) => {
          const a = r.automation as Automation;
          const s = stats[i];
          const excluded = Object.entries(r.excluded ?? {}).filter(([, n]) => (n ?? 0) > 0) as [Exclusion, number][];
          return (
            <li key={r.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{AUTOMATION_LABEL[a].label}</div>
                  <div className="text-sm text-[var(--muted)]">{AUTOMATION_LABEL[a].about}</div>
                  <div className="mt-1 text-sm">
                    &ldquo;{r.subject}&rdquo;{" "}
                    <Link href={`/admin/email/${r.id}`} className="font-semibold text-[var(--accent)] hover:underline">
                      Edit the email
                    </Link>
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    Last 30 days: {s.sent} sent, {s.delivered} delivered, {s.clicked} clicked.
                    {excluded.length ? ` Last run left out: ${excluded.map(([k, n]) => `${EXCLUSION_LABEL[k]} ${n}`).join(", ")}.` : ""}
                  </div>
                  {r.error && <div className="mt-1 text-xs text-[var(--danger-text)]">{r.error}</div>}
                </div>
                <AutomationSwitch automation={a} on={r.status === "active"} canChange={hasAdminAccess(staff.role)} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

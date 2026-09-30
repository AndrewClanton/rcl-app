import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import PageHeader from "@/components/admin/PageHeader";
import SuppressionTools from "./SuppressionTools";

export const dynamic = "force-dynamic";

// The never-mail list (admins). It holds only scrambled (hashed) copies of
// addresses: type one in to check it or block it; nothing typed here is
// stored or logged.

const REASONS: Record<string, string> = {
  hard_bounce: "Hard bounce (address doesn't exist)",
  complaint: "Marked us as spam",
  soft_bounce_repeat: "Kept bouncing",
  resend_suppressed: "Refused by Resend",
  unsubscribed: "Unsubscribed, then account removed",
  manual: "Blocked by hand",
};

export default async function SuppressionsPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const counts = await Promise.all(
    Object.keys(REASONS).map(async (reason) => {
      const { count } = await admin.from("email_suppressions").select("email_hash", { count: "exact", head: true }).eq("reason", reason);
      return [reason, count ?? 0] as const;
    }),
  );
  return (
    <div className="space-y-4">
      <PageHeader
        area="guests"
        back={{ href: "/admin/email", label: "Email" }}
        title="Never-mail list"
        purpose="Addresses we never send marketing to. A hard bounce stops receipts too. Kept even after someone's account is removed, so they're never emailed again."
      />
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-2 font-semibold">On the list</h2>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {counts.map(([reason, n]) => (
            <li key={reason} className="flex justify-between gap-3">
              <span>{REASONS[reason]}</span>
              <span className="tabular-nums">{n}</span>
            </li>
          ))}
        </ul>
      </section>
      <SuppressionTools />
    </div>
  );
}

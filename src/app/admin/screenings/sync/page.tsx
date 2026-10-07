import { requireManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { schemaMissing } from "@/lib/schema-missing";
import PageHeader from "@/components/admin/PageHeader";
import InfoTip from "@/components/help/InfoTip";
import CalendarSync from "./CalendarSync";

export const dynamic = "force-dynamic";

// "Last synced by Caleb · 2:14 PM" (or "· Oct 5, 2:14 PM" on another day).
function lastSyncedLine(row: { synced_by_name: string | null; created_at: string } | null) {
  if (!row) return null;
  const tz = "America/Chicago";
  const at = new Date(row.created_at);
  const sameDay = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(at) === new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  const time = at.toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", ...(sameDay ? {} : { month: "short", day: "numeric" }) });
  const who = (row.synced_by_name ?? "").trim().split(/\s+/)[0] || "someone";
  return `Last synced by ${who} · ${time}`;
}

export default async function CalendarSyncPage() {
  await requireManager();
  const { data, error } = await createAdminClient().from("calendar_syncs").select("synced_by_name, created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error && !schemaMissing(error)) throw error;
  const last = lastSyncedLine(data as { synced_by_name: string | null; created_at: string } | null);
  return (
    <>
      <PageHeader
        area="shows"
        title="Sync from calendar"
        titleAside={<InfoTip topic="calendar-sync" />}
        back={{ href: "/admin/screenings", label: "Showtimes" }}
        purpose="Upload the staff calendar (.xlsx) and the showtimes follow it from today on. You see every change before anything is saved."
      />
      <p className="mb-4 text-sm text-[var(--muted)]">{last ?? "Not synced from the calendar here yet."}</p>
      <CalendarSync />
    </>
  );
}

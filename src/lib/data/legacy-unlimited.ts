import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { plusPaidFor, subscriptionLive } from "@/lib/plus-status";
import type { LegacyOnboardedVia } from "@/lib/legacy-plus";
import type { Member, MemberPriceTier } from "@/lib/types";

// Back office -> Members -> Former unlimited members: everyone who paid for
// unlimited on the old website (members.legacy_plus, lib/legacy-plus.ts)
// and how their move to Insiders+ is going. Read-only; nothing here sends
// email or changes anyone.
//
//   set_up    Insiders+ is paying now (or was set up after the move and
//             has ended since: still counted, with its status)
//   came_in   checked in or bought something since the new system opened,
//             and nothing is paying
//   not_seen  neither yet

export type FormerUnlimitedStatus = "set_up" | "came_in" | "not_seen";

export interface FormerUnlimitedRow {
  id: string;
  name: string;
  status: FormerUnlimitedStatus;
  // Set up: when (null before the onboarding migration, or when it was set
  // up some other way), how, by whom, the rate and how often, and the
  // subscription's state now.
  setUpAt: string | null;
  setUpVia: LegacyOnboardedVia | null;
  setUpBy: string | null;
  rate: MemberPriceTier | null;
  interval: "month" | "year" | null;
  subscriptionStatus: string | null;
  comped: boolean;
  // The old site's plan: "monthly" / "annual", or null when it isn't known.
  oldPlan: "monthly" | "annual" | null;
  lastIn: string | null;
}

export interface FormerUnlimitedReport {
  rows: FormerUnlimitedRow[];
  counts: Record<FormerUnlimitedStatus, number> & { total: number };
  // The onboarding migration (20261002010000) is applied: set-up dates show.
  tracked: boolean;
}

type Row = Pick<Member, "id" | "name" | "tier" | "comped" | "price_tier" | "billing_interval" | "stripe_subscription_id" | "subscription_status" | "plus_gift_until"> & {
  legacy_user_id: number | null;
  legacy_onboarded_at?: string | null;
  legacy_onboarded_via?: LegacyOnboardedVia | null;
  legacy_onboarded_by?: string | null;
};

const chunks = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function getFormerUnlimited(): Promise<{ ok: true; report: FormerUnlimitedReport } | { ok: false; error: string }> {
  const db = createAdminClient();
  const members: Row[] = [];
  for (let from = 0; ; from += 1000) {
    // "*": the onboarding columns are there once the migration is applied.
    const { data, error } = await db.from("members").select("*").eq("legacy_plus", true).is("erased_at", null).order("name").range(from, from + 999);
    if (error) return { ok: false, error: "Couldn't read the members. Try again." };
    members.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 1000) break;
  }
  const ids = members.map((m) => m.id);
  const tracked = members.length === 0 || "legacy_onboarded_at" in members[0];

  // Since the new system opened: their latest check-in or completed sale.
  const lastIn = new Map<string, string>();
  const later = (id: string, at: string | null | undefined) => {
    if (at && (!lastIn.has(id) || at > (lastIn.get(id) as string))) lastIn.set(id, at);
  };
  // The old site's plan, and who set each one up.
  const oldPlan = new Map<number, "monthly" | "annual">();
  const byIds = [...new Set(members.map((m) => m.legacy_onboarded_by).filter((x): x is string => !!x))];
  const staff = new Map<string, string>();
  const legacyIds = members.map((m) => m.legacy_user_id).filter((x): x is number => typeof x === "number");

  for (const c of chunks(ids, 150)) {
    const [visits, orders] = await Promise.all([
      db.from("member_visits").select("member_id, checked_in_at").in("member_id", c).order("checked_in_at", { ascending: false }).limit(5000),
      db.from("orders").select("member_id, completed_at").in("member_id", c).eq("status", "completed").order("completed_at", { ascending: false }).limit(5000),
    ]);
    for (const v of visits.data ?? []) later(v.member_id as string, v.checked_in_at as string);
    for (const o of orders.data ?? []) later(o.member_id as string, o.completed_at as string | null);
  }
  for (const c of chunks(legacyIds, 200)) {
    // Gone once the old-site import is finished: the plan is then unknown.
    const { data } = await db.from("legacy_accounts").select("legacy_user_id, membership_duration, subscription_type").in("legacy_user_id", c);
    for (const a of data ?? []) {
      const kind = `${a.subscription_type ?? ""} ${a.membership_duration ?? ""}`.toLowerCase();
      if (kind.includes("annual")) oldPlan.set(a.legacy_user_id as number, "annual");
      else if (kind.includes("monthly")) oldPlan.set(a.legacy_user_id as number, "monthly");
    }
  }
  if (byIds.length) {
    const { data } = await db.from("employees").select("id, name").in("id", byIds);
    for (const e of data ?? []) staff.set(e.id as string, e.name as string);
  }

  const rows: FormerUnlimitedRow[] = members.map((m) => {
    const paid = plusPaidFor({ ...m, comped: !!m.comped });
    const setUp = !!m.legacy_onboarded_at || paid;
    return {
      id: m.id,
      name: m.name,
      status: setUp ? "set_up" : lastIn.has(m.id) ? "came_in" : "not_seen",
      setUpAt: m.legacy_onboarded_at ?? null,
      setUpVia: m.legacy_onboarded_via ?? null,
      setUpBy: m.legacy_onboarded_by ? (staff.get(m.legacy_onboarded_by) ?? null) : null,
      rate: setUp ? (m.price_tier ?? "adult") : null,
      interval: setUp ? (m.billing_interval ?? null) : null,
      subscriptionStatus: subscriptionLive(m) ? m.subscription_status : m.stripe_subscription_id ? (m.subscription_status ?? "ended") : null,
      comped: !!m.comped,
      oldPlan: m.legacy_user_id != null ? (oldPlan.get(m.legacy_user_id) ?? null) : null,
      lastIn: lastIn.get(m.id) ?? null,
    };
  });

  const counts = { set_up: 0, came_in: 0, not_seen: 0, total: rows.length };
  for (const r of rows) counts[r.status]++;
  return { ok: true, report: { rows, counts, tracked } };
}

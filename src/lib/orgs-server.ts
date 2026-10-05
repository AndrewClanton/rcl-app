import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { coffeeDay } from "@/lib/daily-perk-server";
import { sealApproval, openApproval } from "@/lib/approval-token";
import {
  GROUP_NOTE_MAX,
  groupCompPlan,
  groupTaxIncluded,
  isDayPassName,
  joinPlans,
  MAX_GROUP_PEOPLE,
  orgCompPlan,
  type CompPlan,
  type OrgGroupInput,
  type OrgGroupOnOrder,
  type OrgOnOrder,
  type OrgRole,
  type OrgStatus,
} from "@/lib/orgs";

// Organization accounts on the server (lib/orgs.ts has the rules): who's in
// one, today's comps, the comps a sale gets, and logging them. Guests with
// no account come as a group by count (20261005050000_org_anonymous_comps).

export interface OrgRow {
  id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  monthly_fee: number;
  daily_comp_limit: number;
  status: OrgStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  invite_code: string;
  notes: string | null;
  created_at: string;
}

export const ORG_COLUMNS = "id, name, contact_name, contact_email, monthly_fee, daily_comp_limit, status, stripe_customer_id, stripe_subscription_id, invite_code, notes, created_at";

// Today's business date: the same day the Insiders+ daily coffee counts.
export const orgDay = (now = new Date()) => coffeeDay(now);

// member_id is null for a guest with no account (anonymous, by group).
type CompRow = {
  id: string;
  member_id: string | null;
  kind: "day_pass" | "movie";
  screening_id: string | null;
  anonymous: boolean;
  role: OrgRole | null;
  group_id: string | null;
  note: string | null;
  order: { status: string } | null;
};

// A comp counts unless its order was voided or refunded.
const counts = (c: CompRow) => !c.order || c.order.status === "completed";

// The organization's comps on a business day that still count.
export async function compsOn(orgId: string, date: string): Promise<CompRow[]> {
  const { data, error } = await createAdminClient()
    .from("org_comps")
    .select("id, member_id, kind, screening_id, anonymous, role, group_id, note, order:orders(status)")
    .eq("organization_id", orgId)
    .eq("business_date", date);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as CompRow[]).filter(counts);
}

// People comped (each counts once a day): each named member once, and each
// anonymous day pass is one person.
export const peopleComped = (rows: CompRow[]) =>
  new Set(rows.flatMap((r) => (r.member_id ? [r.member_id] : r.kind === "day_pass" ? [`anon:${r.id}`] : []))).size;

// The member's organization as the register needs it, or null for none.
export async function orgOnOrderFor(memberId: string, date = orgDay()): Promise<OrgOnOrder | null> {
  const supabase = createAdminClient();
  const { data: m, error } = await supabase.from("members").select("organization_id, org_role").eq("id", memberId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!m?.organization_id || !m.org_role) return null;
  const { data: org, error: orgErr } = await supabase.from("organizations").select("id, name, status, daily_comp_limit").eq("id", m.organization_id).maybeSingle();
  if (orgErr) throw new Error(orgErr.message);
  if (!org) return null;
  const rows = await compsOn(org.id, date);
  const mine = rows.filter((r) => r.member_id === memberId);
  return {
    orgId: org.id,
    orgName: org.name,
    role: m.org_role as OrgRole,
    active: org.status === "active",
    limit: Number(org.daily_comp_limit),
    used: peopleComped(rows),
    personCompedToday: mine.length > 0,
    dayPassToday: mine.some((r) => r.kind === "day_pass"),
    screeningsToday: mine.filter((r) => r.kind === "movie" && r.screening_id).map((r) => r.screening_id as string),
  };
}

const UUID = /^[0-9a-f-]{36}$/i;
const headcount = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_GROUP_PEOPLE ? n : null);

// A group of organization guests as the register sent it, checked: a new
// group (its counts and note), or one of today's (its counts come from the
// comps it already has). Null for anything that doesn't add up.
export async function orgGroupFor(input: OrgGroupInput | null | undefined, date = orgDay()): Promise<OrgGroupOnOrder | null> {
  if (!input || typeof input !== "object" || typeof input.orgId !== "string" || !UUID.test(input.orgId)) return null;
  const { data: org, error } = await createAdminClient().from("organizations").select("id, name, status, daily_comp_limit").eq("id", input.orgId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!org || org.status === "closed") return null;
  const rows = await compsOn(org.id as string, date);
  const base = {
    orgId: org.id as string,
    orgName: org.name as string,
    active: org.status === "active",
    limit: Number(org.daily_comp_limit),
    used: peopleComped(rows),
    taxIncluded: input.taxIncluded !== false,
  };
  if (input.groupId) {
    if (typeof input.groupId !== "string" || !UUID.test(input.groupId)) return null;
    const mine = rows.filter((r) => r.group_id === input.groupId);
    const passes = mine.filter((r) => r.kind === "day_pass");
    if (!passes.length) return null;
    const moviesToday: Record<string, number> = {};
    for (const r of mine) if (r.kind === "movie" && r.screening_id) moviesToday[r.screening_id] = (moviesToday[r.screening_id] ?? 0) + 1;
    return {
      ...base,
      groupId: input.groupId,
      supported: passes.filter((r) => r.role === "supported").length,
      helpers: passes.filter((r) => r.role !== "supported").length,
      note: passes.find((r) => r.note)?.note ?? null,
      moviesToday,
    };
  }
  const supported = headcount(input.supported);
  const helpers = headcount(input.helpers);
  if (supported === null || helpers === null || supported + helpers < 1 || supported + helpers > MAX_GROUP_PEOPLE) return null;
  const note = typeof input.note === "string" ? input.note.trim().slice(0, GROUP_NOTE_MAX) || null : null;
  return { ...base, groupId: null, supported, helpers, note, moviesToday: {} };
}

// Today's groups with no account, newest first, for "same group, later
// today" on the register.
export async function todaysGroups(date = orgDay()): Promise<OrgGroupOnOrder[]> {
  const { data, error } = await createAdminClient()
    .from("org_comps")
    .select("organization_id, group_id, created_at, order:orders(status)")
    .eq("business_date", date)
    .eq("anonymous", true)
    .eq("kind", "day_pass")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  const seen = new Map<string, string>();
  for (const r of (data ?? []) as unknown as { organization_id: string; group_id: string | null; order: { status: string } | null }[]) {
    if (r.group_id && (!r.order || r.order.status === "completed") && !seen.has(r.group_id)) seen.set(r.group_id, r.organization_id);
  }
  const groups = await Promise.all(
    [...seen.entries()].slice(0, 30).map(([groupId, orgId]) => orgGroupFor({ orgId, groupId, supported: 0, helpers: 0, note: null, taxIncluded: true }, date)),
  );
  return groups.filter((g): g is OrgGroupOnOrder => !!g);
}

// The Day pass menu items (by name, lib/orgs.ts).
export async function dayPassItemIds(): Promise<Set<string>> {
  const { data, error } = await createAdminClient().from("menu_items").select("id, name").ilike("name", "day pass");
  if (error) throw new Error(error.message);
  return new Set((data ?? []).filter((i) => isDayPassName(i.name)).map((i) => i.id as string));
}

type SaleLine = { menu_item_id: string | null; screening_id?: string | null; unit_price: number; quantity: number };

export interface OrgSaleTerms {
  org: OrgOnOrder | null;
  // Both comps together (what the totals take off), and each one's own.
  plan: CompPlan;
  memberPlan: CompPlan;
  // Organization guests with no account on the order, and their comps.
  group: OrgGroupOnOrder | null;
  groupPlan: CompPlan;
  // A supported guest of an active organization (the member, or a group
  // with supported guests the cashier left it on for): tax-included totals.
  taxIncluded: boolean;
}

// The organization the terms are for: the member's, else the group's.
export const termsOrg = (t: OrgSaleTerms | undefined | null): { orgId: string; orgName: string; used: number; limit: number } | null => t?.org ?? t?.group ?? null;

// What a sale gets from organizations: the member's comps, a group's
// (groupInput, checked by orgGroupFor), the lines at the prices given, and
// whether the tax is included. override: a manager approved going past
// today's limit.
export async function orgSaleTerms(memberId: string | null, lines: SaleLine[], override: boolean, prices?: number[], groupInput?: OrgGroupInput | null): Promise<OrgSaleTerms> {
  const [org, group] = await Promise.all([memberId ? orgOnOrderFor(memberId) : null, groupInput ? orgGroupFor(groupInput) : null]);
  const dayPass = org || group ? await dayPassItemIds() : new Set<string>();
  const compLines = lines.map((l, i) => ({
    dayPass: !!l.menu_item_id && !l.screening_id && dayPass.has(l.menu_item_id),
    screeningId: l.screening_id ?? null,
    qty: l.quantity,
    unit: prices ? prices[i] : Number(l.unit_price),
  }));
  const memberPlan = orgCompPlan(compLines, org, override);
  const groupPlan = groupCompPlan(compLines, group, override, memberPlan.comps);
  return {
    org,
    plan: joinPlans(memberPlan, groupPlan),
    memberPlan,
    group,
    groupPlan,
    taxIncluded: (!!org?.active && org.role === "supported") || groupTaxIncluded(group),
  };
}

// A manager's OK to go past an organization's daily limit: good for this
// staff login, that organization and today, for 30 minutes.
const OVER_LIMIT_MS = 30 * 60_000;
const overScope = (orgId: string, date: string) => `org-over-limit:${orgId}:${date}`;

export function sealOverLimit(orgId: string, staffId: string, approverId: string | null): string | null {
  return sealApproval(overScope(orgId, orgDay()), staffId, approverId, OVER_LIMIT_MS);
}

export function openOverLimit(token: unknown, orgId: string, staffId: string): { approverId: string | null } | null {
  return token ? openApproval(token, overScope(orgId, orgDay()), staffId) : null;
}

// Logs a saved sale's comps. Best effort: the sale is already saved.
export async function logOrderComps(f: {
  orderId: string;
  memberId: string | null;
  terms: OrgSaleTerms;
  lines: SaleLine[];
  overLimitBy: string | null;
  date?: string;
}): Promise<void> {
  const { org, memberPlan: plan, group, groupPlan } = f.terms;
  const date = f.date ?? orgDay();
  const rows: Record<string, unknown>[] = [];
  if (org && f.memberId && plan.amount > 0) {
    f.lines.forEach((l, i) => {
      if (plan.comps[i] > 0)
        rows.push({
          organization_id: org.orgId,
          member_id: f.memberId,
          business_date: date,
          kind: l.screening_id ? "movie" : "day_pass",
          screening_id: l.screening_id ?? null,
          amount: Number(l.unit_price),
          order_id: f.orderId,
          over_limit: plan.overLimit,
          over_limit_by: plan.overLimit ? f.overLimitBy : null,
        });
    });
  }
  // A group with no account: one row per person comped (a day pass each,
  // supported guests first, then helpers) and one per ticket, all under the
  // group's id. A new group gets its id here.
  if (group && groupPlan.amount > 0) {
    const groupId = group.groupId ?? randomUUID();
    let supportedLeft = group.supported;
    f.lines.forEach((l, i) => {
      for (let n = 0; n < groupPlan.comps[i]; n++) {
        const pass = !l.screening_id;
        rows.push({
          organization_id: group.orgId,
          member_id: null,
          anonymous: true,
          role: pass ? (supportedLeft-- > 0 ? "supported" : "helper") : null,
          group_id: groupId,
          note: group.note,
          business_date: date,
          kind: pass ? "day_pass" : "movie",
          screening_id: l.screening_id ?? null,
          amount: Number(l.unit_price),
          order_id: f.orderId,
          over_limit: groupPlan.overLimit,
          over_limit_by: groupPlan.overLimit ? f.overLimitBy : null,
        });
      }
    });
  }
  if (!rows.length) return;
  const { error } = await createAdminClient().from("org_comps").insert(rows);
  if (error) console.error("org comps not logged", f.orderId, error.message);
}

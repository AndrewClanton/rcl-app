import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ORG_COLUMNS, orgDay, type OrgRow } from "@/lib/orgs-server";
import type { OrgRole } from "@/lib/orgs";
import { memberLabel } from "@/lib/member-name";
import { businessDayWindow } from "@/lib/ops/time";

// Back office → Organizations (lib/orgs.ts): the list, one organization's
// people and comps, the labels waiting to become organizations, and the
// monthly statement.

export interface OrgSummary extends OrgRow {
  people: number;
  compsToday: number;
}

// member_id is null for an organization guest with no account
// (20261005050000_org_anonymous_comps.sql): each of their day passes is one
// person, the same as a named comp, and they show as "no account".
type CompRow = {
  id: string;
  member_id: string | null;
  anonymous: boolean;
  role: OrgRole | null;
  note: string | null;
  business_date: string;
  kind: "day_pass" | "movie";
  amount: number;
  over_limit: boolean;
  order: { status: string; order_number: number } | null;
};
const counts = (c: CompRow) => !c.order || c.order.status === "completed";

// Who a comp is for, once a day: the member, or one anonymous person per
// day pass (an anonymous movie belongs to a person already counted).
const personKey = (r: CompRow) => r.member_id ?? (r.kind === "day_pass" ? `anon:${r.id}` : null);

// People comped per day (each person once a day).
function peoplePerDay(rows: CompRow[]): Map<string, Set<string>> {
  const days = new Map<string, Set<string>>();
  for (const r of rows) {
    const s = days.get(r.business_date) ?? new Set<string>();
    const key = personKey(r);
    if (key) s.add(key);
    days.set(r.business_date, s);
  }
  return days;
}

// Anonymous people comped (no account).
const noAccount = (rows: CompRow[]) => rows.filter((r) => !r.member_id && r.kind === "day_pass").length;

async function compsBetween(orgIds: string[] | null, from: string, to: string): Promise<(CompRow & { organization_id: string })[]> {
  let q = createAdminClient()
    .from("org_comps")
    .select("id, organization_id, member_id, anonymous, role, note, business_date, kind, amount, over_limit, order:orders(status, order_number)")
    .gte("business_date", from)
    .lte("business_date", to)
    .order("business_date")
    .limit(10000);
  if (orgIds) q = q.in("organization_id", orgIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as (CompRow & { organization_id: string })[]).filter(counts);
}

export async function listOrganizations(): Promise<OrgSummary[]> {
  const supabase = createAdminClient();
  const today = orgDay();
  const [orgs, people, comps] = await Promise.all([
    supabase.from("organizations").select(ORG_COLUMNS).order("name"),
    supabase.from("members").select("organization_id").not("organization_id", "is", null).limit(10000),
    compsBetween(null, today, today),
  ]);
  if (orgs.error) throw new Error(orgs.error.message);
  const peopleBy = new Map<string, number>();
  for (const p of people.data ?? []) peopleBy.set(p.organization_id as string, (peopleBy.get(p.organization_id as string) ?? 0) + 1);
  return ((orgs.data ?? []) as OrgRow[]).map((o) => ({
    ...o,
    monthly_fee: Number(o.monthly_fee),
    people: peopleBy.get(o.id) ?? 0,
    compsToday: peoplePerDay(comps.filter((c) => c.organization_id === o.id)).get(today)?.size ?? 0,
  }));
}

// "Group / organization" labels (members.organization) on people not in an
// organization account yet, how many have each, and whether an
// organization of that name exists (then it's "attach", not "make").
export async function labelsWithoutOrg(): Promise<{ label: string; people: number; exists: boolean }[]> {
  const supabase = createAdminClient();
  const [labels, orgs] = await Promise.all([
    supabase.from("members").select("organization").not("organization", "is", null).is("organization_id", null).is("erased_at", null).limit(5000),
    supabase.from("organizations").select("name"),
  ]);
  const taken = new Set((orgs.data ?? []).map((o) => (o.name as string).toLowerCase()));
  const byLabel = new Map<string, number>();
  for (const r of labels.data ?? []) {
    const l = r.organization as string;
    byLabel.set(l, (byLabel.get(l) ?? 0) + 1);
  }
  return [...byLabel.entries()].map(([label, people]) => ({ label, people, exists: taken.has(label.toLowerCase()) })).sort((a, b) => b.people - a.people);
}

export interface OrgPerson {
  id: string;
  name: string;
  contact: string | null;
  role: OrgRole;
  hasLogin: boolean;
}

export interface OrgDetail {
  org: OrgRow;
  people: OrgPerson[];
  // Same label, not attached yet.
  labelled: { id: string; name: string }[];
  today: { used: number; date: string };
  month: { comps: number; value: number; days: { date: string; people: number; value: number }[] };
}

export async function getOrganization(id: string): Promise<OrgDetail | null> {
  const supabase = createAdminClient();
  const { data: org, error } = await supabase.from("organizations").select(ORG_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!org) return null;
  const today = orgDay();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [people, labelled, comps] = await Promise.all([
    supabase.from("members").select("id, name, email, phone, org_role, auth_user_id").eq("organization_id", id).order("name").limit(1000),
    supabase.from("members").select("id, name, phone").is("organization_id", null).is("erased_at", null).ilike("organization", (org.name as string).replace(/[\\%_]/g, (c) => `\\${c}`)).limit(200),
    compsBetween([id], monthStart, today),
  ]);
  const days = peoplePerDay(comps);
  const value = (date: string) => comps.filter((c) => c.business_date === date).reduce((s, c) => s + Number(c.amount), 0);
  return {
    org: { ...(org as OrgRow), monthly_fee: Number(org.monthly_fee) },
    people: (people.data ?? []).map((p) => ({
      id: p.id as string,
      name: memberLabel(p.name as string, p.phone as string | null),
      contact: (p.email as string | null) ?? (p.phone as string | null) ?? null,
      role: p.org_role as OrgRole,
      hasLogin: !!p.auth_user_id,
    })),
    labelled: (labelled.data ?? []).map((p) => ({ id: p.id as string, name: memberLabel(p.name as string, p.phone as string | null) })),
    today: { used: days.get(today)?.size ?? 0, date: today },
    month: {
      comps: [...days.values()].reduce((s, d) => s + d.size, 0),
      value: comps.reduce((s, c) => s + Number(c.amount), 0),
      days: [...days.entries()].map(([date, s]) => ({ date, people: s.size, value: value(date) })).reverse(),
    },
  };
}

export interface OrgStatement {
  org: OrgRow;
  month: string; // "2026-10"
  rows: { date: string; name: string; noAccount: boolean; kind: "day_pass" | "movie"; amount: number; orderNumber: number | null; overLimit: boolean }[];
  days: { date: string; people: number }[];
  comps: number; // people-days
  noAccount: number; // of those, guests with no account
  value: number;
  overLimit: number;
}

// One month's comps, for the organization's statement.
export async function getOrgStatement(id: string, month: string): Promise<OrgStatement | null> {
  const supabase = createAdminClient();
  const { data: org } = await supabase.from("organizations").select(ORG_COLUMNS).eq("id", id).maybeSingle();
  if (!org) return null;
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const comps = await compsBetween([id], `${month}-01`, `${month}-${String(last).padStart(2, "0")}`);
  const ids = [...new Set(comps.flatMap((c) => (c.member_id ? [c.member_id] : [])))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data } = await supabase.from("members").select("id, name, phone").in("id", ids);
    for (const p of data ?? []) names.set(p.id as string, memberLabel(p.name as string, p.phone as string | null));
  }
  const days = peoplePerDay(comps);
  return {
    org: { ...(org as OrgRow), monthly_fee: Number(org.monthly_fee) },
    month,
    rows: comps.map((c) => ({
      date: c.business_date,
      name: c.member_id
        ? (names.get(c.member_id) ?? "Removed account")
        : `${c.role === "supported" ? "Supported guest" : c.role === "helper" ? "Helper" : "Group"} (no account)${c.note ? ` · ${c.note}` : ""}`,
      noAccount: !c.member_id,
      kind: c.kind,
      amount: Number(c.amount),
      orderNumber: c.order?.order_number ?? null,
      overLimit: c.over_limit,
    })),
    days: [...days.entries()].map(([date, s]) => ({ date, people: s.size })),
    comps: [...days.values()].reduce((s, d) => s + d.size, 0),
    noAccount: noAccount(comps),
    value: comps.reduce((s, c) => s + Number(c.amount), 0),
    overLimit: new Set(comps.filter((c) => c.over_limit && personKey(c)).map((c) => `${c.business_date}:${personKey(c)}`)).size,
  };
}

// Supported guests' tax-included (even-dollar) sales over business dates:
// what they paid before tips, the tax inside it, and how many orders.
export async function taxIncludedSales(from: string, to: string): Promise<{ sales: number; tax: number; orders: number }> {
  const { data, error } = await createAdminClient()
    .from("orders")
    .select("total, tax, tip")
    .eq("tax_included", true)
    .eq("status", "completed")
    .gte("completed_at", businessDayWindow(from).start)
    .lt("completed_at", businessDayWindow(to).end)
    .limit(10000);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return {
    sales: rows.reduce((s, o) => s + Number(o.total) - Number(o.tip), 0),
    tax: rows.reduce((s, o) => s + Number(o.tax), 0),
    orders: rows.length,
  };
}

// Comps by organization for a range of business dates (Reports).
export async function compsByOrg(
  from: string,
  to: string,
): Promise<{ orgId: string; name: string; days: { date: string; people: number; noAccount: number; value: number }[]; people: number; noAccount: number; value: number }[]> {
  const supabase = createAdminClient();
  const [comps, orgs] = await Promise.all([compsBetween(null, from, to), supabase.from("organizations").select("id, name")]);
  const nameOf = new Map((orgs.data ?? []).map((o) => [o.id as string, o.name as string]));
  const byOrg = new Map<string, typeof comps>();
  for (const c of comps) byOrg.set(c.organization_id, [...(byOrg.get(c.organization_id) ?? []), c]);
  return [...byOrg.entries()]
    .map(([orgId, rows]) => {
      const days = peoplePerDay(rows);
      const dayList = [...days.entries()].map(([date, s]) => {
        const on = rows.filter((r) => r.business_date === date);
        return { date, people: s.size, noAccount: noAccount(on), value: on.reduce((v, r) => v + Number(r.amount), 0) };
      });
      return {
        orgId,
        name: nameOf.get(orgId) ?? "Organization",
        days: dayList,
        people: dayList.reduce((s, d) => s + d.people, 0),
        noAccount: dayList.reduce((s, d) => s + d.noAccount, 0),
        value: dayList.reduce((s, d) => s + d.value, 0),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

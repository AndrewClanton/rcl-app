import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { CATEGORY_LABEL, type ImpactCategory } from "@/lib/org-invoices";

// Back office → Community impact: the service the Royale Cinema Project
// gives underserved communities, for grants and board reports. By
// organization and by month, with year-to-date totals:
//   - people served: supported guests and helpers (named accounts once each,
//     guests with no account once per visit), people at discounted events,
//     and people at one-off community activities;
//   - visits (a person's day), movies watched, comps and their value
//     (org_comps, not counting voided or refunded orders);
//   - discounted events (org_invoice_lines) and what the nonprofit covered;
//   - one-off community activities (community_activities).
// Pure counting is in impactCells, so the check script tests it directly.

export interface CompRec {
  id: string;
  orgId: string;
  date: string;
  memberId: string | null;
  kind: "day_pass" | "movie";
  role: "supported" | "helper" | null;
  amount: number;
}

export interface LineRec {
  orgId: string;
  date: string;
  fullValue: number;
  charged: number;
  people: number;
}

export interface ActivityRec {
  id: string;
  orgId: string | null;
  orgName: string | null;
  date: string;
  description: string;
  category: ImpactCategory;
  people: number;
  value: number;
  addedBy: string | null;
}

export interface ImpactCells {
  peopleServed: number;
  supported: number;
  helpers: number;
  noAccountVisits: number;
  visits: number;
  movies: number;
  comps: number;
  compValue: number;
  events: number;
  eventPeople: number;
  eventValue: number;
  eventCharged: number;
  eventCovered: number;
  activities: number;
  activityPeople: number;
  activityValue: number;
  covered: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function impactCells(comps: CompRec[], lines: LineRec[], acts: ActivityRec[]): ImpactCells {
  // Named people once each (by their role), and each anonymous day pass is
  // one person (one visit).
  const named = new Map<string, CompRec["role"]>();
  let anonSupported = 0;
  let anonHelpers = 0;
  const days = new Set<string>();
  for (const c of comps) {
    if (c.memberId) {
      if (!named.has(c.memberId) || (c.role && !named.get(c.memberId))) named.set(c.memberId, c.role);
      days.add(`${c.date}:${c.memberId}`);
    } else if (c.kind === "day_pass") {
      if (c.role === "supported") anonSupported++;
      else anonHelpers++;
      days.add(`${c.date}:anon:${c.id}`);
    }
  }
  const namedRoles = [...named.values()];
  // A named person no longer in an organization has no role: counted with
  // the supported guests, who are most of the people served.
  const supported = namedRoles.filter((r) => r !== "helper").length + anonSupported;
  const helpers = namedRoles.filter((r) => r === "helper").length + anonHelpers;
  const eventValue = r2(lines.reduce((s, l) => s + l.fullValue, 0));
  const eventCharged = r2(lines.reduce((s, l) => s + l.charged, 0));
  const eventCovered = r2(lines.reduce((s, l) => s + Math.max(0, l.fullValue - l.charged), 0));
  const eventPeople = lines.reduce((s, l) => s + l.people, 0);
  const compValue = r2(comps.reduce((s, c) => s + c.amount, 0));
  const activityPeople = acts.reduce((s, a) => s + a.people, 0);
  const activityValue = r2(acts.reduce((s, a) => s + a.value, 0));
  return {
    peopleServed: supported + helpers + eventPeople + activityPeople,
    supported,
    helpers,
    noAccountVisits: anonSupported + anonHelpers,
    visits: days.size,
    movies: comps.filter((c) => c.kind === "movie").length,
    comps: comps.length,
    compValue,
    events: lines.length,
    eventPeople,
    eventValue,
    eventCharged,
    eventCovered,
    activities: acts.length,
    activityPeople,
    activityValue,
    covered: r2(compValue + eventCovered + activityValue),
  };
}

export interface ImpactOrg {
  id: string;
  name: string;
  category: ImpactCategory;
}

export interface ImpactReport {
  year: number;
  from: string;
  to: string;
  months: string[];
  ytd: ImpactCells;
  byMonth: { month: string; cells: ImpactCells }[];
  byOrg: { key: string; name: string; category: ImpactCategory; cells: ImpactCells }[];
  byCategory: { category: ImpactCategory; label: string; cells: ImpactCells }[];
  // For the CSV: each organization (and the activities with none, by
  // category) by month.
  rows: { month: string; name: string; category: ImpactCategory; cells: ImpactCells }[];
  activities: ActivityRec[];
  orgs: ImpactOrg[];
}

// Everything a select returns, a page of 1000 at a time.
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < 100; i++) {
    const { data, error } = await page(i * 1000, i * 1000 + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const monthOf = (date: string) => date.slice(0, 7);

export async function getImpact(year: number, today: string): Promise<ImpactReport> {
  const db = createAdminClient();
  const from = `${year}-01-01`;
  const end = `${year}-12-31`;
  const to = today < end ? today : end;
  type RawComp = { id: string; organization_id: string; business_date: string; member_id: string | null; kind: "day_pass" | "movie"; role: CompRec["role"]; amount: number; order: { status: string } | null };
  const [rawComps, rawLines, rawActs, orgs] = await Promise.all([
    all<RawComp>((a, b) =>
      db
        .from("org_comps")
        .select("id, organization_id, business_date, member_id, kind, role, amount, order:orders(status)")
        .gte("business_date", from)
        .lte("business_date", to)
        .order("id")
        .range(a, b) as unknown as PromiseLike<{ data: RawComp[] | null; error: { message: string } | null }>,
    ),
    all<{ organization_id: string; service_date: string; full_value: number; amount_charged: number; people: number | null }>((a, b) =>
      db.from("org_invoice_lines").select("organization_id, service_date, full_value, amount_charged, people").gte("service_date", from).lte("service_date", to).order("id").range(a, b),
    ),
    all<{ id: string; organization_id: string | null; activity_date: string; description: string; category: ImpactCategory; people: number; value: number; created_by_name: string | null }>((a, b) =>
      db
        .from("community_activities")
        .select("id, organization_id, activity_date, description, category, people, value, created_by_name")
        .gte("activity_date", from)
        .lte("activity_date", to)
        .order("activity_date", { ascending: false })
        .order("id")
        .range(a, b),
    ),
    db.from("organizations").select("id, name, impact_category").order("name"),
  ]);
  if (orgs.error) throw new Error(orgs.error.message);
  const orgList: ImpactOrg[] = (orgs.data ?? []).map((o) => ({ id: o.id as string, name: o.name as string, category: o.impact_category as ImpactCategory }));
  const orgById = new Map(orgList.map((o) => [o.id, o]));

  const counted = rawComps.filter((c) => !c.order || c.order.status === "completed");
  // Named people's roles (their organization role now).
  const ids = [...new Set(counted.flatMap((c) => (c.member_id ? [c.member_id] : [])))];
  const roleOf = new Map<string, CompRec["role"]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("members").select("id, org_role").in("id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const m of data ?? []) roleOf.set(m.id as string, (m.org_role as CompRec["role"]) ?? null);
  }
  const comps: CompRec[] = counted.map((c) => ({
    id: c.id,
    orgId: c.organization_id,
    date: c.business_date,
    memberId: c.member_id,
    kind: c.kind,
    role: c.member_id ? (roleOf.get(c.member_id) ?? null) : c.role,
    amount: Number(c.amount),
  }));
  const lines: LineRec[] = rawLines.map((l) => ({
    orgId: l.organization_id,
    date: l.service_date,
    fullValue: Number(l.full_value),
    charged: Number(l.amount_charged),
    people: Number(l.people ?? 0),
  }));
  const activities: ActivityRec[] = rawActs.map((a) => ({
    id: a.id,
    orgId: a.organization_id,
    orgName: a.organization_id ? (orgById.get(a.organization_id)?.name ?? null) : null,
    date: a.activity_date,
    description: a.description,
    category: a.category,
    people: Number(a.people),
    value: Number(a.value),
    addedBy: a.created_by_name,
  }));

  const lastMonth = Number(to.slice(5, 7));
  const months = Array.from({ length: lastMonth }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const inMonth = <T extends { date: string }>(xs: T[], m: string) => xs.filter((x) => monthOf(x.date) === m);
  const catOfOrg = (orgId: string) => orgById.get(orgId)?.category ?? "other";

  // Organizations with anything this year, then activities with no
  // organization (one row per category).
  const orgKeys = [...new Set([...comps.map((c) => c.orgId), ...lines.map((l) => l.orgId), ...activities.flatMap((a) => (a.orgId ? [a.orgId] : []))])];
  const groups: { key: string; name: string; category: ImpactCategory; comps: CompRec[]; lines: LineRec[]; acts: ActivityRec[] }[] = orgKeys
    .map((id) => ({
      key: id,
      name: orgById.get(id)?.name ?? "Removed organization",
      category: catOfOrg(id),
      comps: comps.filter((c) => c.orgId === id),
      lines: lines.filter((l) => l.orgId === id),
      acts: activities.filter((a) => a.orgId === id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const cat of [...new Set(activities.filter((a) => !a.orgId).map((a) => a.category))]) {
    groups.push({ key: `activities:${cat}`, name: `Community activities: ${CATEGORY_LABEL[cat]}`, category: cat, comps: [], lines: [], acts: activities.filter((a) => !a.orgId && a.category === cat) });
  }

  const categories = Object.keys(CATEGORY_LABEL) as ImpactCategory[];
  return {
    year,
    from,
    to,
    months,
    ytd: impactCells(comps, lines, activities),
    byMonth: months.map((m) => ({ month: m, cells: impactCells(inMonth(comps, m), inMonth(lines, m), inMonth(activities, m)) })),
    byOrg: groups.map((g) => ({ key: g.key, name: g.name, category: g.category, cells: impactCells(g.comps, g.lines, g.acts) })),
    byCategory: categories
      .map((cat) => ({
        category: cat,
        label: CATEGORY_LABEL[cat],
        cells: impactCells(
          comps.filter((c) => catOfOrg(c.orgId) === cat),
          lines.filter((l) => catOfOrg(l.orgId) === cat),
          activities.filter((a) => a.category === cat),
        ),
      }))
      .filter((c) => c.cells.peopleServed > 0 || c.cells.covered > 0 || c.cells.comps > 0 || c.cells.events > 0 || c.cells.activities > 0),
    rows: months.flatMap((m) =>
      groups
        .map((g) => ({ month: m, name: g.name, category: g.category, cells: impactCells(inMonth(g.comps, m), inMonth(g.lines, m), inMonth(g.acts, m)) }))
        .filter((r) => r.cells.comps > 0 || r.cells.events > 0 || r.cells.activities > 0),
    ),
    activities,
    orgs: orgList,
  };
}

// The CSV for grants and board reports: one row per organization and
// month, then the year-to-date total for each and for everything.
export const IMPACT_CSV_HEADER = [
  "Month",
  "Organization",
  "Serves",
  "People served",
  "Supported guests",
  "Helpers",
  "Visits with no account",
  "Visits",
  "Movies watched",
  "Comps given",
  "Comp value",
  "Discounted events",
  "Event people",
  "Event full value",
  "Event charged",
  "Event value covered",
  "Community activities",
  "Activity people",
  "Activity value",
  "Total covered by the Royale Cinema Project",
];

export function impactCsvRow(month: string, name: string, category: ImpactCategory | "", c: ImpactCells): string[] {
  const m = (n: number) => n.toFixed(2);
  return [
    month,
    name,
    category ? CATEGORY_LABEL[category] : "",
    String(c.peopleServed),
    String(c.supported),
    String(c.helpers),
    String(c.noAccountVisits),
    String(c.visits),
    String(c.movies),
    String(c.comps),
    m(c.compValue),
    String(c.events),
    String(c.eventPeople),
    m(c.eventValue),
    m(c.eventCharged),
    m(c.eventCovered),
    String(c.activities),
    String(c.activityPeople),
    m(c.activityValue),
    m(c.covered),
  ];
}

export function impactCsv(r: ImpactReport): string[][] {
  const ytd = `${r.year} to date`;
  return [
    IMPACT_CSV_HEADER,
    ...r.rows.map((x) => impactCsvRow(x.month, x.name, x.category, x.cells)),
    ...r.byOrg.map((x) => impactCsvRow(ytd, x.name, x.category, x.cells)),
    impactCsvRow(ytd, "All", "", r.ytd),
  ];
}

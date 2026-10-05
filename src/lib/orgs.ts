import { SALES_TAX_RATE } from "@/lib/sales-tax";

// Organization (corporate) accounts (Andrew, 10/5;
// supabase/migrations/20261005040000_organizations.sql). Groups like Easter
// Seals pay a monthly fee and get comps each business day. No server
// imports: the register uses this too.
//
// - A comp is one person's day pass: the Day pass menu item at $0, and
//   their movies that business day at $0. A person counts once a day,
//   however many movies they see.
// - The daily limit counts people (comps), 20 by default: 10 pairs of a
//   supported guest and a helper.
// - Supported guests pay tax-included, even-dollar prices on everything
//   else: a $4 pizza is $4.00 at the register, $3.68 plus $0.32 tax.
//   Helpers pay normal prices plus tax.

export type OrgRole = "helper" | "supported";
export type OrgStatus = "active" | "paused" | "closed";

export const ORG_ROLES: { value: OrgRole; label: string; hint: string }[] = [
  { value: "supported", label: "Supported guest", hint: "the person the organization brings; prices include tax" },
  { value: "helper", label: "Helper / staff", hint: "signs up with a work email; pays normal prices" },
];

export const STATUS_LABEL: Record<OrgStatus, string> = { active: "Active", paused: "Paused", closed: "Closed" };

export const DEFAULT_DAILY_COMP_LIMIT = 20;
export const DEFAULT_MONTHLY_FEE = 100;

export function roleLabel(role: OrgRole | null | undefined): string {
  return role === "helper" ? "Helper" : role === "supported" ? "Supported guest" : "";
}

// "6/20 · 3 pairs": a pair is a supported guest and a helper.
export function compCountText(used: number, limit: number): string {
  const pairs = Math.floor(used / 2);
  return `${used}/${limit} · ${pairs} ${pairs === 1 ? "pair" : "pairs"}`;
}

// The Day pass menu item ("Tickets and events"), found by its name so a
// re-made item still counts.
export function isDayPassName(name: string | null | undefined): boolean {
  return (name ?? "").trim().toLowerCase() === "day pass";
}

// The member's organization, as the register needs it.
export interface OrgOnOrder {
  orgId: string;
  orgName: string;
  role: OrgRole;
  active: boolean;
  limit: number;
  // People comped today for this organization (distinct), counting this
  // person if they already have one.
  used: number;
  // This person already has today's comp (so another costs nothing).
  personCompedToday: boolean;
  // This person's day pass is already comped today.
  dayPassToday: boolean;
  // Showings this person has had comped today (one ticket each).
  screeningsToday: string[];
}

export type CompLine = { dayPass: boolean; screeningId: string | null; qty: number; unit: number };

export interface CompPlan {
  // How many of each line come off as a comp (0 or 1).
  comps: number[];
  amount: number;
  // This order uses one of today's comps (the person wasn't comped yet).
  newComp: boolean;
  // There's something to comp, but the daily limit is used up and no
  // manager has gone past it: nothing comes off.
  blocked: boolean;
  // Something was comped past the limit (a manager approved it).
  overLimit: boolean;
}

const cents = (n: number) => Math.round(n * 100) / 100;

// What comes off for the organization member on the order: one Day pass
// (if they haven't had today's), and one ticket for each showing they
// haven't had comped today. More of either (a friend's) is charged.
export function orgCompPlan(lines: CompLine[], org: OrgOnOrder | null, override = false): CompPlan {
  const none: CompPlan = { comps: lines.map(() => 0), amount: 0, newComp: false, blocked: false, overLimit: false };
  if (!org || !org.active) return none;
  const comps = lines.map(() => 0);
  let dayPass = org.dayPassToday;
  const shows = new Set(org.screeningsToday);
  lines.forEach((l, i) => {
    if (!(l.qty >= 1)) return;
    if (l.dayPass && !dayPass) {
      comps[i] = 1;
      dayPass = true;
    } else if (l.screeningId && !shows.has(l.screeningId)) {
      comps[i] = 1;
      shows.add(l.screeningId);
    }
  });
  const any = comps.some((c) => c > 0);
  if (!any) return none;
  const newComp = !org.personCompedToday;
  const full = newComp && org.used >= org.limit;
  if (full && !override) return { ...none, blocked: true };
  const amount = cents(lines.reduce((s, l, i) => s + Math.max(0, Number(l.unit)) * comps[i], 0));
  return { comps, amount, newComp, blocked: false, overLimit: full };
}

// A tax-included total: the price is the total, with the tax inside it.
// $4.00 is $3.68 plus $0.32 tax (8.725%).
export function taxInside(total: number, rate = SALES_TAX_RATE): { beforeTax: number; tax: number } {
  const t = cents(Math.max(0, total));
  const beforeTax = cents(t / (1 + rate));
  return { beforeTax, tax: cents(t - beforeTax) };
}

export const TAX_INCLUDED_NOTE = (orgName: string) => `Tax included for ${orgName} guests`;

// Organization guests with no account (Andrew, 10/5;
// 20261005050000_org_anonymous_comps.sql): a helper says "we're with Easter
// Seals" and the cashier logs the group by count from "Organization
// guests". Each person is a comp (a day pass, their movies that day), the
// same as a named one, and the order gets tax-included pricing while it
// carries supported guests (the cashier can switch that off per order).
// A group that comes back later the same day is picked again from
// "today's groups": no new comps, the org's pricing, and movie tickets up
// to the group's size per showing.
export const MAX_GROUP_PEOPLE = 40;
export const GROUP_NOTE_MAX = 80;

export interface OrgGroupOnOrder {
  orgId: string;
  orgName: string;
  active: boolean;
  limit: number;
  // People comped today for the organization, not counting this group
  // when it's new.
  used: number;
  // null: a new group (uses comps on this order); otherwise today's group.
  groupId: string | null;
  supported: number;
  helpers: number;
  note: string | null;
  // Tickets already comped for this group today, by showing.
  moviesToday: Record<string, number>;
  // The order's tax-included pricing, switched by the cashier.
  taxIncluded: boolean;
}

// What the register sends with a sale: the group, as the server checks it.
export interface OrgGroupInput {
  orgId: string;
  groupId: string | null;
  supported: number;
  helpers: number;
  note: string | null;
  taxIncluded: boolean;
}

export const groupPeople = (g: { supported: number; helpers: number }) => g.supported + g.helpers;

export function groupInput(g: OrgGroupOnOrder): OrgGroupInput {
  return { orgId: g.orgId, groupId: g.groupId, supported: g.supported, helpers: g.helpers, note: g.note, taxIncluded: g.taxIncluded };
}

// "Easter Seals · 2 supported guests + 2 helpers · uses 4 comps (6/20 today)"
export function groupSummary(g: OrgGroupOnOrder): string {
  const s = `${g.supported} supported ${g.supported === 1 ? "guest" : "guests"} + ${g.helpers} ${g.helpers === 1 ? "helper" : "helpers"}`;
  const n = groupPeople(g);
  const uses = g.groupId ? "today's group, no new comps" : `uses ${n} ${n === 1 ? "comp" : "comps"} (${g.used + n}/${g.limit} today)`;
  return `${g.orgName} · ${s} · ${uses}`;
}

// Tax-included pricing for the group: on when it has supported guests and
// the cashier left it on.
export const groupTaxIncluded = (g: OrgGroupOnOrder | null) => !!g && g.active && g.supported > 0 && g.taxIncluded;

// The group's comps on the order: a new group gets a day pass for each
// person, and each person one ticket per showing (less any already comped
// for the group today). taken: what's already comped on each line (a
// member's own comp), so a line isn't comped twice.
export function groupCompPlan(lines: CompLine[], g: OrgGroupOnOrder | null, override = false, taken: number[] = []): CompPlan {
  const none: CompPlan = { comps: lines.map(() => 0), amount: 0, newComp: false, blocked: false, overLimit: false };
  const people = g ? groupPeople(g) : 0;
  if (!g || !g.active || people < 1) return none;
  const comps = lines.map(() => 0);
  let passes = g.groupId ? 0 : people;
  const left = new Map<string, number>();
  lines.forEach((l, i) => {
    const avail = Math.max(0, Math.floor(l.qty) - (taken[i] ?? 0));
    if (avail < 1) return;
    if (l.dayPass) {
      comps[i] = Math.min(avail, passes);
      passes -= comps[i];
    } else if (l.screeningId) {
      const has = left.get(l.screeningId) ?? Math.max(0, people - (g.moviesToday[l.screeningId] ?? 0));
      comps[i] = Math.min(avail, has);
      left.set(l.screeningId, has - comps[i]);
    }
  });
  if (!comps.some((c) => c > 0)) return none;
  const newComp = !g.groupId;
  const full = newComp && g.used + people > g.limit;
  if (full && !override) return { ...none, blocked: true };
  const amount = cents(lines.reduce((s, l, i) => s + Math.max(0, Number(l.unit)) * comps[i], 0));
  return { comps, amount, newComp, blocked: false, overLimit: full };
}

// A member's comps and a group's together on one order.
export function joinPlans(a: CompPlan, b: CompPlan): CompPlan {
  return {
    comps: a.comps.map((c, i) => c + (b.comps[i] ?? 0)),
    amount: cents(a.amount + b.amount),
    newComp: a.newComp || b.newComp,
    blocked: a.blocked || b.blocked,
    overLimit: a.overLimit || b.overLimit,
  };
}

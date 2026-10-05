import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { coffeeDay } from "@/lib/daily-perk-server";
import { sealApproval, openApproval } from "@/lib/approval-token";
import { isDayPassName, orgCompPlan, type CompPlan, type OrgOnOrder, type OrgRole, type OrgStatus } from "@/lib/orgs";

// Organization accounts on the server (lib/orgs.ts has the rules): who's in
// one, today's comps, the comps a sale gets, and logging them.

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

type CompRow = { member_id: string; kind: "day_pass" | "movie"; screening_id: string | null; order: { status: string } | null };

// A comp counts unless its order was voided or refunded.
const counts = (c: CompRow) => !c.order || c.order.status === "completed";

// The organization's comps on a business day that still count.
export async function compsOn(orgId: string, date: string): Promise<CompRow[]> {
  const { data, error } = await createAdminClient()
    .from("org_comps")
    .select("member_id, kind, screening_id, order:orders(status)")
    .eq("organization_id", orgId)
    .eq("business_date", date);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as CompRow[]).filter(counts);
}

// People comped (each counts once a day).
export const peopleComped = (rows: CompRow[]) => new Set(rows.map((r) => r.member_id)).size;

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

// The Day pass menu items (by name, lib/orgs.ts).
export async function dayPassItemIds(): Promise<Set<string>> {
  const { data, error } = await createAdminClient().from("menu_items").select("id, name").ilike("name", "day pass");
  if (error) throw new Error(error.message);
  return new Set((data ?? []).filter((i) => isDayPassName(i.name)).map((i) => i.id as string));
}

type SaleLine = { menu_item_id: string | null; screening_id?: string | null; unit_price: number; quantity: number };

export interface OrgSaleTerms {
  org: OrgOnOrder | null;
  plan: CompPlan;
  // A supported guest of an active organization: tax-included totals.
  taxIncluded: boolean;
}

// What an organization member's sale gets: its comps (lines at the prices
// given) and whether the tax is included. override: a manager approved
// going past today's limit.
export async function orgSaleTerms(memberId: string | null, lines: SaleLine[], override: boolean, prices?: number[]): Promise<OrgSaleTerms> {
  const org = memberId ? await orgOnOrderFor(memberId) : null;
  const dayPass = org ? await dayPassItemIds() : new Set<string>();
  const plan = orgCompPlan(
    lines.map((l, i) => ({
      dayPass: !!l.menu_item_id && !l.screening_id && dayPass.has(l.menu_item_id),
      screeningId: l.screening_id ?? null,
      qty: l.quantity,
      unit: prices ? prices[i] : Number(l.unit_price),
    })),
    org,
    override,
  );
  return { org, plan, taxIncluded: !!org?.active && org.role === "supported" };
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
  memberId: string;
  terms: OrgSaleTerms;
  lines: SaleLine[];
  overLimitBy: string | null;
  date?: string;
}): Promise<void> {
  const { org, plan } = f.terms;
  if (!org || plan.amount <= 0) return;
  const date = f.date ?? orgDay();
  const rows = f.lines.flatMap((l, i) =>
    plan.comps[i] > 0
      ? [
          {
            organization_id: org.orgId,
            member_id: f.memberId,
            business_date: date,
            kind: l.screening_id ? "movie" : "day_pass",
            screening_id: l.screening_id ?? null,
            amount: Number(l.unit_price),
            order_id: f.orderId,
            over_limit: plan.overLimit,
            over_limit_by: plan.overLimit ? f.overLimitBy : null,
          },
        ]
      : [],
  );
  if (!rows.length) return;
  const { error } = await createAdminClient().from("org_comps").insert(rows);
  if (error) console.error("org comps not logged", f.orderId, error.message);
}

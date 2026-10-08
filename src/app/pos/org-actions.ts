"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { assertStaff } from "@/lib/auth";
import { checkManagerPin } from "@/lib/manager-pin";
import { allowAttempt } from "@/lib/rate-limit";
import { currentMemberId } from "@/lib/member-forward";
import { compsOn, orgDay, orgGroupFor, orgOnOrderFor, peopleComped, sealOverLimit, todaysGroups } from "@/lib/orgs-server";
import { sendOrgInvite } from "@/lib/org-invite-server";
import type { OrgGroupInput, OrgGroupOnOrder, OrgOnOrder, OrgRole } from "@/lib/orgs";
import type { VisitSlip } from "@/lib/print/receipt";

export interface OrgGroupChoices {
  // Active organizations, with today's comps.
  orgs: { id: string; name: string; used: number; limit: number }[];
  // Groups with no account already comped today ("same group, later").
  today: OrgGroupOnOrder[];
}

// "Organization guests" on the register: the organizations to pick from and
// today's groups.
export async function getOrgGroupChoices(): Promise<OrgGroupChoices> {
  await assertStaff();
  const { data, error } = await createAdminClient().from("organizations").select("id, name, daily_comp_limit").eq("status", "active").order("name");
  if (error) throw new Error(error.message);
  const date = orgDay();
  const [orgs, today] = await Promise.all([
    Promise.all(
      (data ?? []).map(async (o) => ({ id: o.id as string, name: o.name as string, limit: Number(o.daily_comp_limit), used: peopleComped(await compsOn(o.id as string, date)) })),
    ),
    todaysGroups(date),
  ]);
  return { orgs, today };
}

// A group as the server sees it now (today's comps counted again), or null
// if it doesn't add up.
export async function getOrgGroup(input: OrgGroupInput): Promise<OrgGroupOnOrder | null> {
  await assertStaff();
  return orgGroupFor(input);
}

// The register's side of organization accounts (lib/orgs.ts): the chip and
// comps for the member on the order, the manager override past the daily
// limit, and "Add to organization" in the press-and-hold panel.

const UUID = /^[0-9a-f-]{36}$/i;

// The member's organization and today's comps, or null for none.
export async function getOrgOnOrder(memberId: string): Promise<OrgOnOrder | null> {
  await assertStaff();
  if (typeof memberId !== "string" || !UUID.test(memberId)) return null;
  const id = (await currentMemberId(memberId)) ?? memberId;
  return orgOnOrderFor(id);
}

export type OverLimitResult = { ok: true; token: string; approvedBy: string | null; defaultPin: boolean } | { ok: false; error: string };

// A manager's PIN to comp past today's limit: good for 30 minutes, for this
// organization, on this register's login.
export async function approveOrgOverLimit(pin: string, orgId: string): Promise<OverLimitResult> {
  const staff = await assertStaff();
  if (typeof orgId !== "string" || !UUID.test(orgId)) return { ok: false, error: "Couldn't find that organization." };
  const approval = await checkManagerPin(pin, "org-over-limit", staff.employeeId, orgId.toLowerCase());
  if (!approval.ok) return approval;
  const token = sealOverLimit(orgId, staff.employeeId, approval.approverId);
  if (!token) return { ok: false, error: "The register can't approve that right now. Ring the day pass and tickets at their price." };
  return { ok: true, token, approvedBy: approval.approvedBy, defaultPin: approval.defaultPin };
}

export interface MemberOrgChoice {
  current: { orgId: string; orgName: string; role: OrgRole } | null;
  orgs: { id: string; name: string }[];
}

// The press-and-hold panel's "Add to organization": the member's
// organization now, and the open ones to pick from.
export async function getMemberOrgChoice(memberId: string): Promise<MemberOrgChoice | null> {
  await assertStaff();
  if (typeof memberId !== "string" || !UUID.test(memberId)) return null;
  const supabase = createAdminClient();
  const [m, orgs] = await Promise.all([
    supabase.from("members").select("organization_id, org_role").eq("id", memberId).maybeSingle(),
    supabase.from("organizations").select("id, name, status").neq("status", "closed").order("name"),
  ]);
  if (m.error || orgs.error) return null;
  const list = (orgs.data ?? []).map((o) => ({ id: o.id as string, name: o.name as string }));
  const orgId = (m.data?.organization_id as string | null) ?? null;
  let current: MemberOrgChoice["current"] = null;
  if (orgId && m.data?.org_role) {
    const name = list.find((o) => o.id === orgId)?.name ?? (await supabase.from("organizations").select("name").eq("id", orgId).maybeSingle()).data?.name;
    current = { orgId, orgName: (name as string | undefined) ?? "Organization", role: m.data.org_role as OrgRole };
  }
  return { current, orgs: list };
}

// Puts the member in an organization with a role, or takes them out (orgId
// null). Any cashier, no PIN, like the label beside it.
export async function setMemberOrg(memberId: string, orgId: string | null, role: OrgRole | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const staff = await assertStaff();
  if (typeof memberId !== "string" || !UUID.test(memberId)) return { ok: false, error: "Couldn't find that member." };
  if (orgId !== null && (typeof orgId !== "string" || !UUID.test(orgId))) return { ok: false, error: "Pick an organization." };
  if (orgId && role !== "helper" && role !== "supported") return { ok: false, error: "Pick helper or supported guest." };
  if (!(await allowAttempt(`member-org-account:${staff.employeeId}`, 30, 300))) return { ok: false, error: "Too many changes at once. Wait a minute, then try again." };
  const id = (await currentMemberId(memberId)) ?? memberId;
  const supabase = createAdminClient();
  let label: string | null = null;
  if (orgId) {
    const { data: org } = await supabase.from("organizations").select("name, status").eq("id", orgId).maybeSingle();
    if (!org || org.status === "closed") return { ok: false, error: "That organization isn't open." };
    label = org.name as string;
  }
  // The free-text label follows, so Members' filter and the chip agree.
  const patch = orgId ? { organization_id: orgId, org_role: role, organization: label } : { organization_id: null, org_role: null };
  const { error } = await supabase.from("members").update(patch).eq("id", id);
  return error ? { ok: false, error: "Couldn't save that. Try again." } : { ok: true };
}

// "Invite a helper" at the register: the helper types their work email and
// gets the organization's sign-up link. Only the organization's name comes
// back, so the screen never shows anyone else's data.
export async function inviteHelper(orgId: string, email: string): Promise<{ ok: true; orgName: string } | { ok: false; error: string }> {
  const staff = await assertStaff();
  return sendOrgInvite(orgId, email, "register", staff);
}

// Recent orders' "Visit slip": an organization group's visit on this order,
// as its slip, or null when the order has no group comps. The comps count
// is that business day's, as it stands now.
export async function getVisitSlip(orderId: string): Promise<VisitSlip | null> {
  await assertStaff();
  const db = createAdminClient();
  const [{ data: comps, error }, { data: order, error: orderError }] = await Promise.all([
    db.from("org_comps").select("organization_id, group_id, business_date").eq("order_id", orderId).eq("anonymous", true).limit(1),
    db.from("orders").select("order_number, completed_at, created_at, items:order_items(name, screening_id)").eq("id", orderId).maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  if (orderError) throw new Error(orderError.message);
  const c = comps?.[0];
  if (!c || !order || !c.group_id) return null;
  const { data: org, error: orgError } = await db.from("organizations").select("name, daily_comp_limit").eq("id", c.organization_id).maybeSingle();
  if (orgError) throw new Error(orgError.message);
  if (!org) return null;
  const rows = await compsOn(c.organization_id as string, c.business_date as string);
  const passes = rows.filter((r) => r.group_id === c.group_id && r.kind === "day_pass");
  const items = ((order.items ?? []) as { name: string; screening_id: string | null }[]).filter((i) => i.screening_id);
  return {
    orderNumber: Number(order.order_number),
    at: (order.completed_at ?? order.created_at) as string,
    orgName: org.name as string,
    supported: passes.filter((r) => r.role === "supported").length,
    helpers: passes.filter((r) => r.role !== "supported").length,
    used: peopleComped(rows),
    limit: Number(org.daily_comp_limit),
    movies: [...new Set(items.map((i) => i.name))],
    reprint: true,
  };
}

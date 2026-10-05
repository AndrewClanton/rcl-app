"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { assertStaff } from "@/lib/auth";
import { checkManagerPin } from "@/lib/manager-pin";
import { allowAttempt } from "@/lib/rate-limit";
import { currentMemberId } from "@/lib/member-forward";
import { orgOnOrderFor, sealOverLimit } from "@/lib/orgs-server";
import type { OrgOnOrder, OrgRole } from "@/lib/orgs";

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

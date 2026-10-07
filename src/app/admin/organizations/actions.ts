"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertAdmin } from "@/lib/auth";
import { ORG_COLUMNS, type OrgRow } from "@/lib/orgs-server";
import { DEFAULT_DAILY_COMP_LIMIT, DEFAULT_MONTHLY_FEE, type OrgRole, type OrgStatus } from "@/lib/orgs";
import { startOrgSubscription, stopOrgSubscription } from "@/lib/org-billing";
import { memberLabel } from "@/lib/member-name";
import { sendOrgInvite } from "@/lib/org-invite-server";
import { isCategory, type ImpactCategory } from "@/lib/org-invoices";

// Back office → Organizations (lib/orgs.ts). Owners and admins.

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;
const STATUSES: OrgStatus[] = ["active", "paused", "closed"];

export interface OrgFields {
  name: string;
  contactName: string;
  contactEmail: string;
  monthlyFee: string | number;
  dailyCompLimit: string | number;
  status: OrgStatus;
  notes: string;
  // Community impact category; left as it is when not given.
  impactCategory?: ImpactCategory;
}

function clean(f: OrgFields): { ok: true; row: Partial<OrgRow> } | { ok: false; error: string } {
  const name = String(f.name ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) return { ok: false, error: "Give the organization a name (up to 80 characters)." };
  const email = String(f.contactEmail ?? "").trim().toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "That contact email doesn't look right." };
  const fee = Number(f.monthlyFee);
  if (!Number.isFinite(fee) || fee < 0 || fee > 100000) return { ok: false, error: "The monthly fee should be a dollar amount, like 100." };
  const limit = Number(f.dailyCompLimit);
  if (!Number.isInteger(limit) || limit < 0 || limit > 500) return { ok: false, error: "The daily comp limit should be a whole number, like 20." };
  if (!STATUSES.includes(f.status)) return { ok: false, error: "Pick a status." };
  if (f.impactCategory !== undefined && !isCategory(f.impactCategory)) return { ok: false, error: "Pick who the organization serves." };
  return {
    ok: true,
    row: {
      name,
      contact_name: String(f.contactName ?? "").trim().slice(0, 120) || null,
      contact_email: email || null,
      monthly_fee: Math.round(fee * 100) / 100,
      daily_comp_limit: limit,
      status: f.status,
      notes: String(f.notes ?? "").trim().slice(0, 2000) || null,
      ...(f.impactCategory ? { impact_category: f.impactCategory } : {}),
    },
  };
}

function refresh(id?: string) {
  revalidatePath("/admin/organizations");
  if (id) revalidatePath(`/admin/organizations/${id}`);
}

const dupName = (e: { code?: string } | null) => e?.code === "23505";

export async function createOrganization(f: OrgFields): Promise<Result<{ id: string }>> {
  await assertAdmin();
  const c = clean(f);
  if (!c.ok) return c;
  const { data, error } = await createAdminClient().from("organizations").insert(c.row).select("id").single();
  if (error) return { ok: false, error: dupName(error) ? "There's already an organization with that name." : "Couldn't save it. Try again." };
  refresh();
  return { ok: true, id: data.id as string };
}

export async function updateOrganization(id: string, f: OrgFields): Promise<Result> {
  await assertAdmin();
  if (!UUID.test(id)) return { ok: false, error: "Couldn't find that organization." };
  const c = clean(f);
  if (!c.ok) return c;
  const supabase = createAdminClient();
  const { data: before } = await supabase.from("organizations").select("name").eq("id", id).maybeSingle();
  const { error } = await supabase.from("organizations").update(c.row).eq("id", id);
  if (error) return { ok: false, error: dupName(error) ? "There's already an organization with that name." : "Couldn't save it. Try again." };
  // Renamed: its people's label follows (Members' filter, the register chip).
  if (before && before.name !== c.row.name) await supabase.from("members").update({ organization: c.row.name }).eq("organization_id", id);
  refresh(id);
  return { ok: true };
}

// Makes an organization from a "Group / organization" label (or finds the
// one with that name) and attaches everyone tagged with it who isn't in an
// organization yet, as supported guests (change any to helper after).
export async function organizationFromLabel(label: string): Promise<Result<{ id: string; attached: number }>> {
  await assertAdmin();
  const name = String(label ?? "").trim();
  if (!name) return { ok: false, error: "Pick a label." };
  const supabase = createAdminClient();
  const like = name.replace(/[\\%_]/g, (c) => `\\${c}`);
  let { data: org } = await supabase.from("organizations").select("id, name").ilike("name", like).maybeSingle();
  if (!org) {
    const made = await supabase
      .from("organizations")
      .insert({ name, monthly_fee: DEFAULT_MONTHLY_FEE, daily_comp_limit: DEFAULT_DAILY_COMP_LIMIT })
      .select("id, name")
      .single();
    if (made.error) return { ok: false, error: "Couldn't make the organization. Try again." };
    org = made.data;
  }
  const { data, error } = await supabase
    .from("members")
    .update({ organization_id: org.id, org_role: "supported", organization: org.name })
    .ilike("organization", like)
    .is("organization_id", null)
    .is("erased_at", null)
    .select("id");
  if (error) return { ok: false, error: "Made the organization, but couldn't attach everyone. Try again." };
  refresh(org.id as string);
  return { ok: true, id: org.id as string, attached: data?.length ?? 0 };
}

export async function setPerson(orgId: string, memberId: string, role: OrgRole | null): Promise<Result> {
  await assertAdmin();
  if (!UUID.test(orgId) || !UUID.test(memberId)) return { ok: false, error: "Couldn't find that person." };
  if (role !== null && role !== "helper" && role !== "supported") return { ok: false, error: "Pick helper or supported guest." };
  const supabase = createAdminClient();
  if (role === null) {
    const { error } = await supabase.from("members").update({ organization_id: null, org_role: null }).eq("id", memberId).eq("organization_id", orgId);
    if (error) return { ok: false, error: "Couldn't take them out. Try again." };
  } else {
    const { data: org } = await supabase.from("organizations").select("name").eq("id", orgId).maybeSingle();
    if (!org) return { ok: false, error: "Couldn't find that organization." };
    const { data: m } = await supabase.from("members").select("organization_id").eq("id", memberId).maybeSingle();
    if (m?.organization_id && m.organization_id !== orgId) return { ok: false, error: "They're in another organization. Take them out of it first." };
    const { error } = await supabase.from("members").update({ organization_id: orgId, org_role: role, organization: org.name }).eq("id", memberId).is("erased_at", null);
    if (error) return { ok: false, error: "Couldn't save that. Try again." };
  }
  refresh(orgId);
  return { ok: true };
}

export async function findPeople(query: string): Promise<{ id: string; name: string; contact: string | null; orgId: string | null }[]> {
  await assertAdmin();
  const q = String(query ?? "").trim();
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  const like = `%${q.replace(/[\\%_,()]/g, " ")}%`;
  const ors = [`name.ilike.${like}`, `email.ilike.${like}`];
  if (digits.length >= 4) ors.push(`phone_digits.like.%${digits}%`);
  const { data } = await createAdminClient().from("members").select("id, name, email, phone, organization_id").is("erased_at", null).or(ors.join(",")).order("name").limit(10);
  return (data ?? []).map((m) => ({
    id: m.id as string,
    name: memberLabel(m.name as string, m.phone as string | null),
    contact: (m.email as string | null) ?? (m.phone as string | null) ?? null,
    orgId: (m.organization_id as string | null) ?? null,
  }));
}

// A new invite link: the old one stops working.
export async function newInviteLink(orgId: string): Promise<Result> {
  await assertAdmin();
  if (!UUID.test(orgId)) return { ok: false, error: "Couldn't find that organization." };
  const code = crypto.randomUUID().replace(/-/g, "");
  const { error } = await createAdminClient().from("organizations").update({ invite_code: code }).eq("id", orgId);
  if (error) return { ok: false, error: "Couldn't make a new link. Try again." };
  refresh(orgId);
  return { ok: true };
}

// "Email the helper link": sends the sign-up link to one address and logs it.
export async function emailInviteLink(orgId: string, email: string): Promise<Result> {
  const staff = await assertAdmin();
  const res = await sendOrgInvite(orgId, email, "back_office", staff);
  if (!res.ok) return res;
  refresh(orgId);
  return { ok: true };
}

async function orgRow(id: string): Promise<OrgRow | null> {
  if (!UUID.test(id)) return null;
  const { data } = await createAdminClient().from("organizations").select(ORG_COLUMNS).eq("id", id).maybeSingle();
  return (data as OrgRow | null) ?? null;
}

export async function startBilling(orgId: string): Promise<Result> {
  await assertAdmin();
  const org = await orgRow(orgId);
  if (!org) return { ok: false, error: "Couldn't find that organization." };
  if (org.stripe_subscription_id) return { ok: false, error: "This organization already has monthly billing. Stop it first to start a new one." };
  const r = await startOrgSubscription(org);
  if (!r.ok) return r;
  const { error } = await createAdminClient().from("organizations").update({ stripe_customer_id: r.customerId, stripe_subscription_id: r.subscriptionId }).eq("id", orgId);
  if (error) console.error("org billing ids not saved", orgId, r.subscriptionId, error.message);
  refresh(orgId);
  return { ok: true };
}

export async function stopBilling(orgId: string): Promise<Result> {
  await assertAdmin();
  const org = await orgRow(orgId);
  if (!org?.stripe_subscription_id) return { ok: false, error: "This organization isn't billed through Stripe." };
  const r = await stopOrgSubscription(org.stripe_subscription_id);
  if (!r.ok) return r;
  await createAdminClient().from("organizations").update({ stripe_subscription_id: null }).eq("id", orgId);
  refresh(orgId);
  return { ok: true };
}

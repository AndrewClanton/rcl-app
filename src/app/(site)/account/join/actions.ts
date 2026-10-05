"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeLogin } from "@/lib/member-claim";
import { allowAttempt } from "@/lib/rate-limit";
import { readInvite, personalAccountReason } from "./invite";

// A helper joining their organization from its invite link
// (/account/join?c=...): the signed-in login's Royale account becomes a
// helper of that organization (lib/orgs.ts).
export async function joinOrganization(code: string): Promise<{ ok: true; orgName: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in with your work email first." };
  if (!(await allowAttempt(`org-join:${user.id}`, 10, 600))) return { ok: false, error: "Too many tries. Wait a few minutes, then try again." };
  const invite = await readInvite(code);
  if (!invite) return { ok: false, error: "This link doesn't work anymore. Ask your organization for a new one." };
  const login = await describeLogin(user);
  if (login.screen || login.staff) return { ok: false, error: "This is one of the Royale's own logins. Sign in with your work email instead." };
  const db = createAdminClient();
  const { data: m } = await db.from("members").select("id, tier, stripe_subscription_id, organization_id").eq("auth_user_id", user.id).maybeSingle();
  if (!m) return { ok: false, error: "We couldn't find the Royale account for this login. Sign out and in again, then open the link again." };
  if (m.organization_id && m.organization_id !== invite.id) return { ok: false, error: "This login is already with another organization. Use a different work email, or ask us at the box office." };
  const personal = personalAccountReason(m);
  if (personal) return { ok: false, error: personal };
  const { error } = await db.from("members").update({ organization_id: invite.id, org_role: "helper", organization: invite.name }).eq("id", m.id);
  if (error) return { ok: false, error: "Couldn't join just now. Try again in a minute." };
  return { ok: true, orgName: invite.name };
}

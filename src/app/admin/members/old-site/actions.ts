"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { LegacyDecision } from "@/lib/data/legacy";

// Returned rather than thrown: production redacts thrown messages, and the
// import's outcome (how many added / linked / skipped) is the whole point.
export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

function revalidate() {
  revalidatePath("/admin/members/old-site");
  revalidatePath("/admin/members");
}

export async function setLegacyDecision(legacyUserId: number, decision: Exclude<LegacyDecision, "review">): Promise<Result<object>> {
  const staff = await assertAdmin();
  const supabase = createAdminClient();
  const { data: row, error: readErr } = await supabase.from("legacy_accounts").select("imported_member_id").eq("legacy_user_id", legacyUserId).single();
  if (readErr) return { ok: false, error: "Couldn't find that account." };
  if (row.imported_member_id) return { ok: false, error: "Already imported -- remove the member from the Members page instead." };
  const { error } = await supabase
    .from("legacy_accounts")
    .update({ decision, decided_by: staff.employeeId, decided_at: new Date().toISOString() })
    .eq("legacy_user_id", legacyUserId);
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  revalidate();
  return { ok: true };
}

interface ApprovedRow {
  legacy_user_id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  membership_duration: string | null;
  membership_is_plus: boolean;
  subscription_billing_status: string | null;
}

// Copies every approved, not-yet-imported old account into `members` as a
// free Insider. An existing member with the same email (e.g. staff, or
// someone who already signed up on the new site) is linked, not duplicated,
// and never downgraded. No logins are created and no email is sent -- that's
// the claim-your-account step. Safe to run again: already-imported rows are
// skipped.
export async function importApprovedLegacyAccounts(): Promise<Result<{ added: number; linked: number; skipped: string[] }>> {
  await assertAdmin();
  const supabase = createAdminClient();

  const approved: ApprovedRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("legacy_accounts")
      .select("legacy_user_id, email, first_name, last_name, phone, membership_duration, membership_is_plus, subscription_billing_status")
      .eq("decision", "import")
      .is("imported_member_id", null)
      .not("email", "is", null)
      .order("legacy_user_id")
      .range(from, from + 999);
    if (error) return { ok: false, error: "Couldn't read the approved accounts." };
    approved.push(...(data as ApprovedRow[]));
    if (data.length < 1000) break;
  }
  if (approved.length === 0) return { ok: true, added: 0, linked: 0, skipped: [] };

  const existing = new Map<string, { id: string; legacy_user_id: number | null; phone: string | null }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("members").select("id, email, legacy_user_id, phone").not("email", "is", null).range(from, from + 999);
    if (error) return { ok: false, error: "Couldn't read existing members." };
    for (const m of data) existing.set(m.email.toLowerCase(), m);
    if (data.length < 1000) break;
  }

  const now = new Date().toISOString();
  const wasPaying = (r: ApprovedRow) => !!r.subscription_billing_status || r.membership_is_plus || r.membership_duration === "monthly" || r.membership_duration === "annual";
  const skipped: string[] = [];
  const seen = new Set<string>();
  const toInsert: Record<string, unknown>[] = [];
  let linked = 0;

  for (const r of approved) {
    const key = r.email.trim().toLowerCase();
    if (seen.has(key)) {
      skipped.push(`${r.email} (another approved old account has the same email)`);
      continue;
    }
    seen.add(key);
    const match = existing.get(key);
    if (match) {
      if (match.legacy_user_id && match.legacy_user_id !== r.legacy_user_id) {
        skipped.push(`${r.email} (already linked to a different old account)`);
        continue;
      }
      const { error } = await supabase
        .from("members")
        .update({ legacy_user_id: r.legacy_user_id, legacy_plus: wasPaying(r), imported_at: now, ...(match.phone ? {} : { phone: r.phone }) })
        .eq("id", match.id);
      if (error) return { ok: false, error: `Stopped while linking ${r.email}. Nothing after it was changed; run the import again to continue.` };
      linked++;
      continue;
    }
    const name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || key.split("@")[0];
    toInsert.push({ name, email: r.email.trim(), phone: r.phone, tier: "Insiders", points: 0, legacy_user_id: r.legacy_user_id, legacy_plus: wasPaying(r), imported_at: now });
  }

  let added = 0;
  let stoppedEarly: string | null = null;
  for (let i = 0; i < toInsert.length; i += 500) {
    const { data, error } = await supabase.from("members").insert(toInsert.slice(i, i + 500)).select("id");
    if (error) {
      stoppedEarly = `Stopped after adding ${added} members. Run the import again to continue -- it picks up where it left off.`;
      break;
    }
    added += data.length;
  }

  // Point each legacy row at its member (runs even after a partial failure,
  // so a re-run doesn't try to add the same people twice).
  const { error: linkErr } = await supabase.rpc("link_imported_legacy_accounts");
  revalidate();
  if (stoppedEarly) return { ok: false, error: stoppedEarly };
  if (linkErr) return { ok: false, error: "Members were added, but marking them imported failed. Run the import again to finish." };
  return { ok: true, added, linked, skipped };
}

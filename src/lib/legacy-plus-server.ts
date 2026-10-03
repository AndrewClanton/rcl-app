import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { LegacyOnboardedVia } from "@/lib/legacy-plus";

// Former unlimited members (lib/legacy-plus.ts), the server side.

// Records that a former unlimited member's Insiders+ is set up now: at the
// register (their card on the reader), from the link staff gave them, or
// on the website by themselves (lib/plus-activate.ts). Only the first time,
// and only for someone who was unlimited on the old site. Never throws:
// the membership itself is already saved, and until the migration
// (20261002010000) is applied there's nowhere to write this, so it's
// skipped (Back office then counts a live subscription as set up).
export async function markLegacyOnboarded(memberId: string, via: LegacyOnboardedVia, by: string | null): Promise<void> {
  try {
    const { error } = await createAdminClient()
      .from("members")
      .update({ legacy_onboarded_at: new Date().toISOString(), legacy_onboarded_via: via, legacy_onboarded_by: by })
      .eq("id", memberId)
      .eq("legacy_plus", true)
      .is("legacy_onboarded_at", null);
    const missing = error?.code === "42703" || error?.code === "PGRST204";
    if (error && !missing) console.warn("legacy onboarding not recorded:", error.message);
  } catch (e) {
    console.warn("legacy onboarding not recorded:", e instanceof Error ? e.message : e);
  }
}

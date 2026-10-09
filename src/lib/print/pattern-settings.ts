import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_PATTERN_SETTINGS, parsePatternSettings, PATTERN_SETTING, type PatternSettings } from "./receipt-patterns";

// Patterned receipts on or off, and which designs (Back office → Printers),
// in the settings table under 'receipt_patterns'. Not there yet: all on.

export async function getPatternSettings(): Promise<PatternSettings> {
  const { data, error } = await createAdminClient().from("settings").select("value").eq("key", PATTERN_SETTING).maybeSingle();
  if (error) throw new Error(`Couldn't read the receipt pattern settings: ${error.message}`);
  return data ? parsePatternSettings(data.value) : DEFAULT_PATTERN_SETTINGS;
}

export async function savePatternSettings(s: PatternSettings, by: string | null): Promise<void> {
  const value = parsePatternSettings(s);
  const { error } = await createAdminClient()
    .from("settings")
    .upsert({ key: PATTERN_SETTING, value, updated_at: new Date().toISOString(), updated_by: by }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

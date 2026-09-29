import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// The shift tools' change log (ops_changes): who added, changed, removed or
// restored a task, par sheet line or reminder. The register's History tab
// reads it. Lives here, not in ops-actions.ts, so other screens that edit
// the par sheet (the recipe editor) log the same way without it becoming a
// server action anyone could call.
export async function logOpsChange(
  entity: "task" | "par_item" | "reminder",
  entityId: string | null,
  action: "added" | "changed" | "removed" | "restored",
  summary: string,
  by: string | null,
) {
  const { error } = await createAdminClient().from("ops_changes").insert({ entity, entity_id: entityId, action, summary, changed_by: by });
  if (error) console.error("ops: change not logged", error);
}

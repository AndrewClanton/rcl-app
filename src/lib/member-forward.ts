import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// A member id that may belong to an account merged away since it was
// picked up (Back office → Members → merge; migration 20261001150000).
// A register can hold a member on an open sale or tab for hours; if that
// account is merged in the meantime, saving the sale with the old id would
// fail on the deleted account after the customer has paid. This follows
// the merge log to the account it became. Anything else (no merge, the
// log not there yet, the database not answering) gives the id back as it
// was, so it never makes a sale worse than it would have been.
export async function currentMemberId(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  try {
    // merge_members points earlier merges on to the newest kept account,
    // so one step is enough.
    const { data, error } = await createAdminClient().from("member_merges").select("keep_id").eq("dropped_id", id).limit(1);
    if (error || !data?.length) return id;
    return (data[0].keep_id as string) || id;
  } catch {
    return id;
  }
}

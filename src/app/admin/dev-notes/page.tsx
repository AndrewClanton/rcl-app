import { requireAdmin } from "@/lib/auth";
import { getDevNotes } from "@/lib/data/devNotes";
import PageHeader from "@/components/admin/PageHeader";
import DevNotesPanel from "./DevNotesPanel";

export const dynamic = "force-dynamic";

export default async function AdminDevNotesPage() {
  await requireAdmin();
  const notes = await getDevNotes();
  return (
    <div>
      <PageHeader
        area="setup"
        title="Dev notes"
        purpose={
          <>
            Notes admins jotted down with the Dev note button, with the page they were on. Approve the ones worth doing: that&apos;s the backlog to hand to
            Claude.
          </>
        }
      />
      <DevNotesPanel notes={notes} />
    </div>
  );
}

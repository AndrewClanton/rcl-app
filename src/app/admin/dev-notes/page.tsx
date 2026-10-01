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
            Notes admins jotted down with Leave a dev note (in this menu, on the register&apos;s shift bar, or the staff bar on other pages), with the page
            they&apos;re about. Approve the ones worth doing: that&apos;s the backlog to hand to Claude.
          </>
        }
      />
      <DevNotesPanel notes={notes} />
    </div>
  );
}

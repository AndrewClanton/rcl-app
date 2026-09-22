import { requireAdmin } from "@/lib/auth";
import { getDevNotes } from "@/lib/data/devNotes";
import DevNotesPanel from "./DevNotesPanel";

export const dynamic = "force-dynamic";

export default async function AdminDevNotesPage() {
  await requireAdmin();
  const notes = await getDevNotes();
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Develop Mate</h1>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Notes admins jotted down from the Develop Mate widget, with the page they were on. Approve the ones worth
        doing -- that's the backlog to hand to Claude.
      </p>
      <DevNotesPanel notes={notes} />
    </div>
  );
}

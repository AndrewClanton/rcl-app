"use client";

import Link from "next/link";
import MemberNotesPanel from "@/components/MemberNotesPanel";
import type { MemberNote } from "@/lib/member-notes";
import { addMemberNoteAdmin, setMemberOrganizationAdmin } from "./notes-actions";

// Staff-only notes and the "Group / organization" label (lib/member-notes.ts),
// the same as the register's press-and-hold panel, with every note listed.
export default function NotesBox({
  memberId,
  notes,
  organization,
  suggestions,
}: {
  memberId: string;
  notes: MemberNote[];
  organization: string | null;
  suggestions: string[];
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3" aria-labelledby="member-notes">
      <h2 id="member-notes" className="mb-2 flex flex-wrap items-baseline justify-between gap-2 font-bold">
        Notes and organization
        {organization && (
          <Link href={`/admin/members?org=${encodeURIComponent(organization)}`} className="text-xs font-normal text-[var(--muted)] hover:underline">
            Everyone in {organization} →
          </Link>
        )}
      </h2>
      <MemberNotesPanel
        notes={notes}
        organization={organization}
        suggestions={suggestions}
        addNote={(text) => addMemberNoteAdmin(memberId, text)}
        setOrganization={(value) => setMemberOrganizationAdmin(memberId, value)}
      />
    </section>
  );
}

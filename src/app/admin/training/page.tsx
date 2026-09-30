import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { getTrainingOverview } from "@/lib/training/data";
import PageHeader from "@/components/admin/PageHeader";
import TrainingModuleCard from "./TrainingModuleCard";

export const dynamic = "force-dynamic";

// Back office → Training, for managers and up: every training, who it's
// assigned to, and who's signed off. Staff take them at /training (their
// phone) or from the register's shift bar.
export default async function AdminTrainingPage() {
  await requireManager();
  const { staff, modules } = await getTrainingOverview();

  const assigned = modules.flatMap((m) => m.people.filter((p) => p.assigned));
  const open = assigned.filter((p) => p.state !== "done");
  const overdue = open.filter((p) => p.overdue);

  return (
    <div className="space-y-6">
      <PageHeader
        area="team"
        title="Training"
        purpose={
          <>
            Assign trainings and see who&apos;s signed off. Staff open theirs on the register after starting a shift, or at <b>/training</b> on their phone.
          </>
        }
        actions={
          <Link href="/training" className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] px-3 text-sm hover:border-[var(--foreground)]">
            Your own training →
          </Link>
        }
      />

      <div className="flex flex-wrap gap-3 text-sm">
        <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1">
          <b>{open.length}</b> assigned, not done yet
        </span>
        <span
          className={`rounded-full border px-3 py-1 ${overdue.length ? "border-[var(--danger-text)] text-[var(--danger-text)]" : "border-[var(--border)] bg-[var(--surface)]"}`}
        >
          <b>{overdue.length}</b> overdue
        </span>
        <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1">
          <b>{assigned.length - open.length}</b> signed off
        </span>
      </div>

      {modules.map((m) => (
        <TrainingModuleCard
          key={m.slug}
          module={{ slug: m.slug, title: m.title, summary: m.summary, category: m.category, minutes: m.minutes, version: m.version, hasQuiz: !!m.quiz }}
          people={m.people}
          staff={staff}
        />
      ))}

      <p className="text-xs text-[var(--muted)]">
        Need a new training? Tell Claude what it should cover. They&apos;re built picture by picture, like the membership how-to. When a training changes, everyone who
        signed the old version is asked to sign again.
      </p>
    </div>
  );
}

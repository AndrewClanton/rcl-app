import Link from "next/link";
import { getStaffSession } from "@/lib/auth";
import { getTrainingFor, type TrainingStatus } from "@/lib/training/data";

export const dynamic = "force-dynamic";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
const dueDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

const STATE_LABEL = { new: "New", started: "Started", update: "Updated · sign again", done: "Done" } as const;

function Row({ t }: { t: TrainingStatus }) {
  const done = t.state === "done";
  return (
    <li>
      <Link href={`/training/${t.slug}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 transition-colors hover:bg-[var(--surface-hover)]">
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg leading-snug">{t.title}</div>
          <div className="mt-1 text-sm text-[var(--muted)]">
            {t.category} · {t.minutes} min{t.hasQuiz ? " · Quiz" : ""}
            {t.note ? ` · ${t.note}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {t.overdue ? (
            <span className="ctag ctag-red !text-[11px]">Overdue · {dueDay(t.dueDate!)}</span>
          ) : t.dueDate && !done ? (
            <span className="text-sm font-bold">Due {dueDay(t.dueDate)}</span>
          ) : null}
          {t.state && (
            <span className={`ctag !text-[11px] ${done ? "ctag-yellow" : t.state === "update" ? "ctag-red" : ""}`}>
              {done && t.completedAt ? `✓ Signed ${day(t.completedAt)}` : STATE_LABEL[t.state]}
            </span>
          )}
          <span aria-hidden="true" className="text-[var(--muted)]">
            →
          </span>
        </div>
      </Link>
    </li>
  );
}

function Section({ title, items, empty }: { title: string; items: TrainingStatus[]; empty?: string }) {
  if (items.length === 0 && !empty) return null;
  return (
    <section className="sheet">
      <h2 className="spec-head rounded-t-[4px]">
        <span>{title}</span>
        <span className="font-mono text-xs opacity-70">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="px-5 py-5 text-[15px] text-[var(--muted)]">{empty}</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {items.map((t) => (
            <Row key={t.slug} t={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function MyTrainingPage() {
  const session = (await getStaffSession())!;
  const all = await getTrainingFor(session.employeeId);
  const toDo = all.filter((t) => (t.assigned && t.state !== "done") || t.state === "update").sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const done = all.filter((t) => t.state === "done");
  const library = all.filter((t) => !toDo.includes(t) && !done.includes(t));

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="page-eyebrow">RCL staff training</span>
          <span className="flex flex-wrap gap-4">
            <Link href="/help" className="text-sm font-bold text-[var(--muted)] hover:text-[var(--accent)]">
              Help &amp; FAQ →
            </Link>
            <Link href="/admin" className="text-sm font-bold text-[var(--muted)] hover:text-[var(--accent)]">
              Back office →
            </Link>
          </span>
        </div>
        <h1 className="font-display text-4xl leading-none">Your training, {session.name.split(" ")[0]}</h1>
        <p className="max-w-xl text-[15px] text-[var(--muted)]">
          Short picture-by-picture how-tos for Royale Cinema. Work through the ones assigned to you and sign off at the end of each. Key ones end with a quick quiz.
        </p>
      </header>

      <Section title="To do" items={toDo} empty="Nothing assigned to you right now." />
      <Section title="Done" items={done} />
      <Section title="All trainings" items={library} />
    </div>
  );
}

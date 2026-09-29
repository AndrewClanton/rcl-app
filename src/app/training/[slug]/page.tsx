import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStaffSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTraining, publicQuiz } from "@/lib/training/catalog";
import { getTrainingFor } from "@/lib/training/data";
import { TRAINING_CONTENT } from "@/training";
import TrainingFinish, { RegisterClose } from "./TrainingFinish";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ register?: string; for?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: getTraining(slug)?.title ?? "Training" };
}

// One training: the pictures and steps, then the quiz and sign-off.
// ?register=1&for=<employee> is the register's training window (an iframe
// over the register), signing for whoever's on shift.
export default async function TrainingPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const t = getTraining(slug);
  const Content = TRAINING_CONTENT[slug];
  if (!t || !Content) notFound();

  const session = (await getStaffSession())!;
  const registerMode = sp.register === "1";
  let person = { id: session.employeeId, name: session.name };
  let forEmployeeId: string | null = null;
  if (registerMode && sp.for) {
    const { data } = await createAdminClient().from("employees").select("id, name").eq("id", sp.for).eq("active", true).neq("role", "display").maybeSingle();
    if (!data) notFound();
    person = { id: data.id as string, name: data.name as string };
    forEmployeeId = person.id;
  }
  const status = (await getTrainingFor(person.id)).find((s) => s.slug === slug);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {registerMode ? (
          <>
            <span className="page-eyebrow">Training for {person.name.split(" ")[0]}</span>
            <RegisterClose />
          </>
        ) : (
          <Link href="/training" className="text-sm font-bold text-[var(--muted)] hover:text-[var(--accent)]">
            ← Your training
          </Link>
        )}
      </div>

      <header className="space-y-3">
        <span className="page-eyebrow">
          {t.category} · {t.minutes} min{t.quiz ? " · Quiz at the end" : ""}
        </span>
        <h1 className="font-display text-4xl leading-[1.02] sm:text-5xl">{t.title}</h1>
        <p className="max-w-xl text-[16px] text-[var(--muted)]">{t.summary}</p>
        {status?.dueDate && status.state !== "done" && (
          <p className={`text-sm font-bold ${status.overdue ? "text-[var(--accent)]" : ""}`}>
            {status.overdue ? "Overdue: was due " : "Due "}
            {new Date(`${status.dueDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}
            {status.note ? ` · ${status.note}` : ""}
          </p>
        )}
      </header>

      <Content />

      <TrainingFinish
        slug={t.slug}
        questions={publicQuiz(t)}
        personName={person.name}
        forEmployeeId={forEmployeeId}
        registerMode={registerMode}
        signedAt={status?.state === "done" ? status.completedAt : null}
        needsResign={status?.state === "update"}
      />
    </div>
  );
}

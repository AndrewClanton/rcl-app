"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PublicQuestion } from "@/lib/training/catalog";
import { checkTrainingQuiz, markTrainingOpened, signOffTraining } from "../actions";

// Tells the register's training window (the page around this one's
// iframe) to close, after a sign-off or when they tap Close.
function tellRegister(type: "rcl-training-close" | "rcl-training-signed") {
  if (window.parent !== window) window.parent.postMessage({ type }, window.location.origin);
}

export function RegisterClose() {
  return (
    <button type="button" className="btn-secondary px-5 py-2.5" onClick={() => tellRegister("rcl-training-close")}>
      Close
    </button>
  );
}

const signedDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });

// The end of a training: the quiz (key trainings), then "I've read and
// understand this" and Sign off. Also records the first open.
export default function TrainingFinish({
  slug,
  questions,
  personName,
  forEmployeeId,
  registerMode,
  signedAt,
  needsResign,
}: {
  slug: string;
  questions: PublicQuestion[] | null;
  personName: string;
  forEmployeeId: string | null;
  registerMode: boolean;
  signedAt: string | null; // signed on the current version
  needsResign: boolean;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [wrong, setWrong] = useState<string[]>([]);
  const [why, setWhy] = useState<Record<string, string> | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(signedAt);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    markTrainingOpened(slug, forEmployeeId).catch(() => {});
  }, [slug, forEmployeeId]);

  const quizPassed = !questions || why !== null;
  const allAnswered = !questions || questions.every((q) => answers[q.id] !== undefined);

  function check() {
    setError(null);
    startTransition(async () => {
      const r = await checkTrainingQuiz(slug, answers).catch(() => null);
      if (!r) return setError("Couldn't check your answers. Try again.");
      if (r.passed) {
        setWrong([]);
        setWhy(r.why);
      } else {
        setWrong(r.wrong);
      }
    });
  }

  function signOff() {
    setError(null);
    startTransition(async () => {
      const r = await signOffTraining(slug, { forEmployeeId, answers: questions ? answers : null }).catch(() => null);
      if (!r) return setError("Couldn't save your sign-off. Try again.");
      if (!r.ok) {
        if (r.wrong) {
          setWhy(null);
          setWrong(r.wrong);
        }
        return setError(r.error);
      }
      setDone(r.completedAt);
      router.refresh();
      if (registerMode) setTimeout(() => tellRegister("rcl-training-signed"), 1800);
    });
  }

  if (done) {
    return (
      <section className="sheet halftone halftone-hero bg-[var(--gold)] p-6" aria-live="polite">
        <div className="relative z-[1]">
          <span className="ctag ctag-red">Signed off</span>
          <p className="font-display mt-3 text-2xl">
            ✓ {personName.split(" ")[0]} signed this on {signedDay(done)}.
          </p>
          <p className="mt-1 text-[15px]">If it changes, it&apos;ll show up again for you to review and sign.</p>
          {registerMode && (
            <div className="mt-4">
              <RegisterClose />
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-8">
      {questions && (
        <section className="sheet" aria-labelledby="quiz-h">
          <h2 id="quiz-h" className="spec-head rounded-t-[4px]">
            <span>Quick quiz</span>
            <span className="font-mono text-xs opacity-70">
              {questions.length} question{questions.length === 1 ? "" : "s"}
            </span>
          </h2>
          <ol className="divide-y divide-[var(--border)]">
            {questions.map((q, qi) => {
              const isWrong = wrong.includes(q.id);
              return (
                <li key={q.id} className="px-5 py-5">
                  <fieldset>
                    <legend className="font-display text-lg leading-snug">
                      {qi + 1}. {q.prompt}
                    </legend>
                    <div className="mt-3 grid gap-2">
                      {q.choices.map((c, ci) => {
                        const picked = answers[q.id] === ci;
                        return (
                          <label
                            key={ci}
                            className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-md border-2 px-3 py-2 text-[15px] ${
                              picked ? "border-[var(--foreground)] bg-[var(--surface-hover)] font-bold" : "border-[var(--border)]"
                            }`}
                          >
                            <input
                              type="radio"
                              name={q.id}
                              className="size-5 accent-[var(--accent)]"
                              checked={picked}
                              disabled={why !== null}
                              onChange={() => {
                                setAnswers((a) => ({ ...a, [q.id]: ci }));
                                setWrong((w) => w.filter((id) => id !== q.id));
                              }}
                            />
                            {c}
                          </label>
                        );
                      })}
                    </div>
                    {isWrong && <p className="mt-2 text-sm font-bold text-[var(--accent)]">Not quite. Look back at the training and try another answer.</p>}
                    {why?.[q.id] && <p className="mt-2 text-sm text-[var(--success-text)]">✓ {why[q.id]}</p>}
                  </fieldset>
                </li>
              );
            })}
          </ol>
          {why === null && (
            <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] px-5 py-4">
              <button type="button" className="btn-primary px-6 py-3" disabled={!allAnswered || pending} onClick={check}>
                {pending ? "Checking..." : "Check my answers"}
              </button>
              {!allAnswered && <span className="text-sm text-[var(--muted)]">Answer every question first.</span>}
              {wrong.length > 0 && (
                <span className="text-sm font-bold text-[var(--accent)]">
                  {wrong.length} to fix
                </span>
              )}
            </div>
          )}
        </section>
      )}

      <section className={`sheet p-6 ${quizPassed ? "" : "opacity-50"}`} aria-labelledby="sign-h">
        <h2 id="sign-h" className="font-display text-2xl">
          {needsResign ? "This training was updated. Sign off again" : "Sign off"}
        </h2>
        <p className="mt-1 text-[15px] text-[var(--muted)]">
          Signing as <b className="text-[var(--foreground)]">{personName}</b>
          {registerMode ? " on the register" : ""}.{questions && !quizPassed ? " Pass the quiz above first." : ""}
        </p>
        <label className="mt-4 flex min-h-12 cursor-pointer items-center gap-3 text-[16px] font-bold">
          <input type="checkbox" className="size-6 accent-[var(--accent)]" checked={understood} disabled={!quizPassed} onChange={(e) => setUnderstood(e.target.checked)} />
          I&apos;ve read and understand this training.
        </label>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary px-6 py-3" disabled={!quizPassed || !understood || pending} onClick={signOff}>
            {pending ? "Saving..." : "Sign off"}
          </button>
          {registerMode && <RegisterClose />}
        </div>
        {error && (
          <p className="mt-3 text-sm font-bold text-[var(--accent)]" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

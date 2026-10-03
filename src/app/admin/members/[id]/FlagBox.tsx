"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FLAG_REASONS, flagTime, type MemberFlag } from "@/lib/member-flags";
import { clearMemberFlag, takeBackFlagPoints } from "../flag-actions";

// Flags from the register's "Flag suspicious activity" (lib/member-flags.ts):
// a red box with each one not cleared yet (who, when, why, the note), and
// for an admin or owner, "Take back today's check-in points" (the flagged
// check-in's visit and its points) and "Clear flag". Cleared ones are
// listed quietly underneath. Nothing here was blocked at the register.
export default function FlagBox({ flags, canAct, today }: { flags: MemberFlag[]; canAct: boolean; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const open = flags.filter((f) => !f.clearedAt);
  const cleared = flags.filter((f) => f.clearedAt);
  if (!flags.length) return null;

  function run(action: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, done: string) {
    setResult(null);
    startTransition(async () => {
      const r = await action().catch(() => null);
      if (!r) return setResult({ ok: false, text: "Couldn't reach the server. Try again." });
      if (!r.ok) return setResult({ ok: false, text: r.error });
      setResult({ ok: true, text: r.message ?? done });
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {open.length > 0 && (
        <section className="rounded-xl border-2 px-4 py-3 text-sm" style={{ borderColor: "var(--danger-text)", background: "var(--surface)" }} aria-labelledby="member-flags">
          <h2 id="member-flags" className="mb-2 font-bold" style={{ color: "var(--danger-text)" }}>
            🚩 Flagged at the register{open.length > 1 ? ` · ${open.length}` : ""}
          </h2>
          <ul className="space-y-3">
            {open.map((f) => (
              <li key={f.id} className="space-y-1.5">
                <div>
                  <strong>{FLAG_REASONS[f.reason]}</strong>
                  <span className="text-[var(--muted)]">
                    {" "}
                    · {f.flaggedBy ?? "Staff"} · {flagTime(f.flaggedAt)}
                  </span>
                </div>
                {f.note && <div className="italic">“{f.note}”</div>}
                <div className="text-xs text-[var(--muted)]">
                  {f.takenBackAt
                    ? `Check-in taken back by ${f.takenBackBy ?? "an admin"}, ${flagTime(f.takenBackAt)}: ${f.takenBackPoints ?? 0} point${f.takenBackPoints === 1 ? "" : "s"}.`
                    : f.visitId
                      ? `About their check-in on ${dayLabel(f.visitDate)}.`
                      : f.visitDate
                        ? `Their check-in on ${dayLabel(f.visitDate)} is gone already.`
                        : "They hadn't checked in that day."}
                </div>
                {canAct && (
                  <div className="flex flex-wrap gap-2">
                    {f.visitId && !f.takenBackAt && (
                      <button className="btn-secondary min-h-11 !px-3 !py-1.5 text-sm" disabled={pending} onClick={() => run(() => takeBackFlagPoints(f.id), "Taken back.")}>
                        {f.visitDate === today ? "Take back today's check-in points" : `Take back the ${dayLabel(f.visitDate)} check-in's points`}
                      </button>
                    )}
                    <button className="btn-secondary min-h-11 !px-3 !py-1.5 text-sm" disabled={pending} onClick={() => run(() => clearMemberFlag(f.id), "Flag cleared.")}>
                      Clear flag
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {!canAct && <p className="mt-2 text-xs text-[var(--muted)]">An admin or owner can take back the check-in or clear the flag.</p>}
        </section>
      )}
      {result && (
        <p className="text-sm" style={{ color: result.ok ? "var(--success-text)" : "var(--danger-text)" }} role="status">
          {result.text}
        </p>
      )}
      {cleared.length > 0 && (
        <details className="text-xs text-[var(--muted)]">
          <summary className="cursor-pointer">
            {cleared.length} earlier flag{cleared.length === 1 ? "" : "s"}, cleared
          </summary>
          <ul className="mt-1 space-y-1">
            {cleared.map((f) => (
              <li key={f.id}>
                {FLAG_REASONS[f.reason]} · {f.flaggedBy ?? "Staff"}, {flagTime(f.flaggedAt)}
                {f.note ? ` · “${f.note}”` : ""}
                {f.takenBackAt ? ` · check-in taken back by ${f.takenBackBy ?? "an admin"}` : ""} · cleared by {f.clearedBy ?? "an admin"}, {flagTime(f.clearedAt!)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// "Oct 2" from a business date ("2026-10-02").
function dayLabel(date: string | null) {
  if (!date) return "that day";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

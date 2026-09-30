"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MemberEmailPanel } from "@/lib/email/member-panel";
import { CATEGORY_LABEL, CONSENT_LABEL, PREF_CATEGORIES } from "@/lib/email/types";
import { setMemberEmailOptIn } from "./email-actions";

// The Email panel on a member's page: their marketing email at a glance,
// and the staff switch for someone who asks in person.

const SUPPRESSION: Record<string, string> = {
  hard_bounce: "Their address bounced (it doesn't exist or won't take mail). Nothing, not even receipts, goes to it until the address changes.",
  complaint: "They marked one of our emails as spam. Only they can turn email back on, from their account or an email link.",
  soft_bounce_repeat: "Their mailbox kept refusing our email. Marketing email is off for this address.",
  resend_suppressed: "Our email service refused this address (it bounced or complained elsewhere).",
  manual: "Blocked by hand in Back office → Email.",
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });

export default function EmailPanel({ memberId, panel }: { memberId: string; panel: MemberEmailPanel }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(on: boolean) {
    setError(null);
    start(async () => {
      const r = await setMemberEmailOptIn(memberId, on).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-base font-semibold">Email</h2>
      {!panel.hasEmail ? (
        <p className="mt-1 text-sm text-[var(--muted)]">No email address on file.</p>
      ) : (
        <>
          <label className="mt-3 flex cursor-pointer items-start gap-3">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[var(--accent)]" checked={panel.optIn} disabled={pending} onChange={(e) => toggle(e.target.checked)} />
            <span className="text-sm">
              <strong>Marketing email {panel.optIn ? "on" : "off"}</strong>
              <span className="block text-[var(--muted)]">
                {CONSENT_LABEL[panel.consentSource]}
                {panel.consentAt ? `, ${day(panel.consentAt)}` : ""}.{panel.optInChangedAt ? ` Last changed ${day(panel.optInChangedAt)}.` : ""} Receipts and tickets always go.
              </span>
            </span>
          </label>
          {error && <p className="mt-2 text-sm text-[var(--danger-text)]">{error}</p>}
          {panel.suppression && <p className="notice notice-warn mt-3 text-sm">On the never-mail list since {day(panel.suppression.firstAt)}. {SUPPRESSION[panel.suppression.reason] ?? ""}</p>}
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            {PREF_CATEGORIES.map((c) => (
              <span key={c} className={`rounded-full border px-2 py-0.5 ${panel.prefs[c] ? "border-[var(--foreground)]" : "border-[var(--border)] text-[var(--muted)] line-through"}`}>
                {CATEGORY_LABEL[c].label}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">
            {panel.pausedUntil ? `Paused until ${day(panel.pausedUntil)}. ` : ""}
            {panel.engagement === "dormant" ? "Gone quiet: never clicked or came in after \"Still want these?\", so no marketing email. Coming in wakes them up. " : ""}
            {panel.engagement === "reconfirm_sent" ? "Was asked \"Still want these?\". " : ""}
            {panel.lastEngagedAt ? `Last clicked or came in ${day(panel.lastEngagedAt)}.` : "No clicks or visits recorded yet."}
          </p>
          {panel.recent.length > 0 && (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--muted)]">
                  <th className="py-1 font-normal">Last emails</th>
                  <th className="py-1 font-normal">Sent</th>
                  <th className="py-1 text-right font-normal">Delivered · opened · clicked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {panel.recent.map((r, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-2">{r.name}</td>
                    <td className="py-1.5 pr-2 whitespace-nowrap text-[var(--muted)]">{r.status === "held_out" ? "held back" : r.at ? day(r.at) : r.status}</td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      {r.status === "held_out" ? (
                        "—"
                      ) : (
                        <>
                          {r.delivered ? "✓" : r.status === "bounced" ? "bounced" : "·"} {r.opened ? "✓" : "·"} {r.clicked ? "✓" : "·"}
                          {r.unsubscribed ? " (unsubscribed)" : ""}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

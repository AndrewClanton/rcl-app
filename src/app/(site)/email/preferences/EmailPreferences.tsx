"use client";

import { useState, useTransition } from "react";
import { CATEGORY_LABEL, PREF_CATEGORIES, type PrefCategory } from "@/lib/email/types";
import { chooseLineupOnly, endPause, pauseForMonth, saveEmailCategory, turnEmailsBackOn, unsubscribeFromAll, type EmailState, type PrefsAnswer } from "./actions";

// The email preference center: the same screen from an email link (a
// signed token, no sign-in) and on /account/email (signed in).
//
// "Unsubscribe from all marketing emails" is the first thing on the page
// (the CAN-SPAM one-page opt-out), and with a token it's a plain form post
// that works even without JavaScript. Below it, the gentler choices: just
// the weekly lineup, a 30-day pause, or one kind at a time. Everything
// saves the moment it's tapped.

function day(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" });
}

export default function EmailPreferences({
  token,
  unsubscribeAction,
  initial,
  justUnsubscribed = false,
}: {
  token: string | null; // null: signed in on /account/email
  unsubscribeAction: string; // the one-click endpoint (form mode)
  initial: EmailState;
  justUnsubscribed?: boolean;
}) {
  const [state, setState] = useState<EmailState>(initial);
  const [error, setError] = useState<string | null>(null);
  // Back from the no-script unsubscribe form: say it's done.
  const [saved, setSaved] = useState<string | null>(justUnsubscribed ? "Unsubscribed from all marketing email." : null);
  const [pending, start] = useTransition();

  function apply(label: string, act: () => Promise<PrefsAnswer>) {
    setError(null);
    setSaved(null);
    start(async () => {
      const r = await act().catch((): PrefsAnswer => ({ ok: false, error: "Couldn't reach the server. Try again." }));
      if (!r.ok) setError(r.error);
      else {
        setState(r.state);
        setSaved(label);
      }
    });
  }

  const allOff = PREF_CATEGORIES.every((c) => !state.prefs[c]);
  const lineupOnly = state.prefs.lineup && !state.prefs.alerts && !state.prefs.events && !state.prefs.offers && !state.prefs.rewards;

  return (
    <div className="space-y-6">
      {/* The one-tap way out, first. */}
      <section id="all" className="sheet overflow-hidden scroll-mt-24">
        <div className="spec-head">
          <span>Unsubscribe</span>
          <span className="spec-code">One tap</span>
        </div>
        <div className="p-5">
          {state.optIn ? (
            <>
              <p className="text-[15px] text-[var(--muted)]">Stops every marketing email from Royale Cinema. Receipts, tickets and account emails still come.</p>
              {token ? (
                <form method="post" action={unsubscribeAction} className="mt-4">
                  <input type="hidden" name="t" value={token} />
                  <input type="hidden" name="from" value="page" />
                  <button type="submit" className="btn-primary w-full sm:w-auto" disabled={pending}>
                    Unsubscribe from all marketing emails
                  </button>
                </form>
              ) : (
                <button type="button" className="btn-primary mt-4 w-full sm:w-auto" disabled={pending} onClick={() => apply("Unsubscribed from all marketing email.", () => unsubscribeFromAll(token))}>
                  Unsubscribe from all marketing emails
                </button>
              )}
            </>
          ) : (
            <div role="status">
              <p className="font-display text-xl">Done. You won&apos;t get marketing email from us.</p>
              <p className="mt-1 text-[15px] text-[var(--muted)]">Receipts and tickets still come. Changed your mind?</p>
              <button type="button" className="btn-secondary mt-4" disabled={pending} onClick={() => apply("Emails are back on.", () => turnEmailsBackOn(token))}>
                Turn emails back on
              </button>
            </div>
          )}
        </div>
      </section>

      {state.optIn && (
        <>
          <section className="sheet overflow-hidden">
            <div className="spec-head">
              <span>Less email, not none</span>
            </div>
            <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2">
              <div className="bg-[var(--surface)] p-5">
                <div className="font-display text-lg">Just the weekly lineup</div>
                <p className="mt-1 text-sm text-[var(--muted)]">One email a week, Tuesday morning. Nothing else.</p>
                <button
                  type="button"
                  className="btn-secondary mt-3"
                  disabled={pending || lineupOnly}
                  onClick={() => apply("Just the weekly lineup from now on.", () => chooseLineupOnly(token))}
                >
                  {lineupOnly ? "That's what you get" : "Just the lineup"}
                </button>
              </div>
              <div className="bg-[var(--surface)] p-5">
                <div className="font-display text-lg">{state.pausedUntil ? "Paused" : "Pause for 30 days"}</div>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {state.pausedUntil ? `No marketing email until ${day(state.pausedUntil)}.` : "Take a break. Everything starts again by itself after a month."}
                </p>
                {state.pausedUntil ? (
                  <button type="button" className="btn-secondary mt-3" disabled={pending} onClick={() => apply("Emails are back on.", () => endPause(token))}>
                    Start again now
                  </button>
                ) : (
                  <button type="button" className="btn-secondary mt-3" disabled={pending} onClick={() => apply("Paused for 30 days.", () => pauseForMonth(token))}>
                    Pause for 30 days
                  </button>
                )}
              </div>
            </div>
          </section>

          <section className="sheet overflow-hidden">
            <div className="spec-head">
              <span>What you get</span>
              <span className="spec-code">Saves as you tap</span>
            </div>
            <ul className="divide-y divide-[var(--border)]">
              {PREF_CATEGORIES.map((c: PrefCategory) => (
                <li key={c} className="p-4">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
                      checked={state.prefs[c]}
                      disabled={pending}
                      onChange={(e) => {
                        const on = e.target.checked;
                        apply(on ? `${CATEGORY_LABEL[c].label}: on.` : `${CATEGORY_LABEL[c].label}: off.`, () => saveEmailCategory(token, c, on));
                      }}
                    />
                    <span>
                      <strong className="block">{CATEGORY_LABEL[c].label}</strong>
                      <span className="block text-sm text-[var(--muted)]">{CATEGORY_LABEL[c].about}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {allOff && <p className="notice notice-warn m-4 text-sm">Every kind is off, so you won&apos;t get marketing email. Receipts and tickets still come.</p>}
          </section>
        </>
      )}

      <div aria-live="polite" className="min-h-6 text-sm">
        {pending && <span className="text-[var(--muted)]">Saving…</span>}
        {!pending && saved && <span className="font-bold text-[var(--success-text)]">Saved. {saved}</span>}
        {!pending && error && <span className="font-bold text-[var(--danger-text)]">{error}</span>}
      </div>
    </div>
  );
}

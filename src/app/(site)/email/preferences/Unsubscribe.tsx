"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { resubscribeWithToken, unsubscribeWithToken, type UnsubAnswer } from "./actions";

// Where every marketing email's "Unsubscribe" link lands. It unsubscribes
// the moment the page opens in a browser (not on the server, so a mail
// scanner fetching the link doesn't), then says so, with a way back in.
// Without JavaScript, a plain button posts to the one-click endpoint.

type Stage = "working" | "out" | "in" | "error";

export default function Unsubscribe({ token, oneClickAction }: { token: string; oneClickAction: string }) {
  const [stage, setStage] = useState<Stage>("working");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ran = useRef(false);

  function run(act: () => Promise<UnsubAnswer>, done: Stage) {
    setError(null);
    start(async () => {
      const r = await act().catch((): UnsubAnswer => ({ ok: false, error: "Couldn't reach the server. Try again." }));
      if (r.ok) setStage(done);
      else {
        setError(r.error);
        setStage("error");
      }
    });
  }

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    run(() => unsubscribeWithToken(token), "out");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <section className="sheet overflow-hidden">
      <div className="p-5" aria-live="polite">
        <noscript>
          <form method="post" action={oneClickAction}>
            <input type="hidden" name="t" value={token} />
            <button type="submit" className="btn-primary w-full sm:w-auto">
              Unsubscribe
            </button>
          </form>
        </noscript>
        {stage === "working" && <p className="text-[15px] text-[var(--muted)]">Unsubscribing…</p>}
        {stage === "out" && (
          <div role="status">
            <p className="font-display text-xl">You&apos;re unsubscribed from marketing emails.</p>
            <p className="mt-1 text-[15px] text-[var(--muted)]">Receipts and tickets still come.</p>
            <p className="mt-5 text-[15px]">Changed your mind?</p>
            <button type="button" className="btn-secondary mt-2" disabled={pending} onClick={() => run(() => resubscribeWithToken(token), "in")}>
              Resubscribe
            </button>
          </div>
        )}
        {stage === "in" && (
          <div role="status">
            <p className="font-display text-xl">Welcome back. Emails are on again.</p>
          </div>
        )}
        {stage === "error" && (
          <div>
            <p className="font-bold text-[var(--danger-text)]">{error}</p>
            <button type="button" className="btn-primary mt-4" disabled={pending} onClick={() => run(() => unsubscribeWithToken(token), "out")}>
              Try again
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

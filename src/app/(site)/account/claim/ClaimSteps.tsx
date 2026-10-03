"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { finishClaim, signOutForClaim, type FinishAnswer } from "./actions";

const OFFLINE = "We couldn't reach the Royale just now. Check your connection and try again.";

// "Use a different login": sign out here, then the page offers the choices.
export function UseAnotherLogin({ className = "btn-secondary w-full" }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await signOutForClaim().catch(() => null);
        router.refresh();
      }}
    >
      {busy ? "Signing out…" : "Use a different login"}
    </button>
  );
}

// These mean the link itself changed state (used, ran out, the account got
// a login...): the page shows the full story on a refresh.
const RELOAD = new Set<string>(["invalid", "expired", "used", "has_login", "gone", "signed_out"]);

// The last step: attach the signed-in login to the account. `auto` runs it
// straight away (they've just signed in for this); otherwise it waits for
// a tap, so nobody's login gets attached without them seeing which one.
export function FinishClaim({ token, email, auto }: { token: string; email: string | null; auto: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(auto);
  const [error, setError] = useState<string | null>(null);
  const [otherLogin, setOtherLogin] = useState(false);
  const started = useRef(false);

  function settle(r: FinishAnswer | null) {
    if (r?.ok) {
      router.push("/account?welcome=1");
      router.refresh();
      return;
    }
    setBusy(false);
    setError(r ? r.error : OFFLINE);
    if (r && (r.reason === "user_linked" || r.reason === "no_email")) setOtherLogin(true);
    if (r && RELOAD.has(r.reason)) router.refresh();
  }

  const autoRun = useEffectEvent(() => {
    void finishClaim(token)
      .catch(() => null)
      .then(settle);
  });

  useEffect(() => {
    if (!auto || started.current) return;
    started.current = true;
    autoRun();
  }, [auto]);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    settle(await finishClaim(token).catch(() => null));
  }

  return (
    <div className="sheet crop p-5 sm:p-6">
      <p className="text-[15px]">
        Signed in as <strong className="break-all">{email ?? "your login"}</strong>.
      </p>
      {error && (
        <p className="mt-3 text-sm text-[var(--danger-text)]" role="alert">
          {error}
        </p>
      )}
      {!otherLogin && (
        <button className="btn-primary mt-4 w-full" disabled={busy} onClick={run}>
          {busy ? "Linking your account…" : "Finish: link this login"}
        </button>
      )}
      <div className="mt-3">
        <UseAnotherLogin className={otherLogin ? "btn-primary w-full" : "text-sm font-bold text-[var(--muted)] underline decoration-2 underline-offset-2 hover:text-[var(--accent)]"} />
      </div>
    </div>
  );
}

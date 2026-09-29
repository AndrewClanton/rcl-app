"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { finishClaim, signOutForClaim, submitClaimDigits, type FinishAnswer } from "./actions";

const OFFLINE = "We couldn't reach the Royale just now. Check your connection and try again.";

// Step one: the last four digits of the phone on the account.
export function DigitsForm({ token }: { token: string }) {
  const router = useRouter();
  const [digits, setDigits] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || digits.length !== 4) return;
    setBusy(true);
    setError(null);
    const r = await submitClaimDigits(token, digits).catch(() => null);
    if (!r) {
      setBusy(false);
      return setError(OFFLINE);
    }
    if (r.ok || r.reload) {
      // On to signing in, or the page's full explanation of what went wrong.
      router.refresh();
      if (!r.ok) setError(r.error);
      return;
    }
    setBusy(false);
    setDigits("");
    setError(r.error);
  }

  return (
    <form onSubmit={submit} className="sheet crop p-5 sm:p-6">
      <label className="block">
        <div className="label-xs">Last 4 digits of your phone number</div>
        <input
          className="input font-mono !text-3xl tracking-[0.4em]"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          autoFocus
          maxLength={4}
          placeholder="••••"
          aria-describedby="claim-digits-help"
          value={digits}
          onChange={(e) => {
            setError(null);
            setDigits(e.target.value.replace(/\D/g, "").slice(0, 4));
          }}
        />
      </label>
      <p id="claim-digits-help" className="mt-2 text-xs text-[var(--muted)]">
        The number you gave us at the Royale. This makes sure it&apos;s really you.
      </p>
      {error && (
        <p className="mt-3 text-sm text-[var(--danger-text)]" role="alert">
          {error}
        </p>
      )}
      <button className="btn-primary mt-4 w-full" disabled={busy || digits.length !== 4}>
        {busy ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

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
const RELOAD = new Set<string>(["invalid", "expired", "digits", "used", "has_login", "gone", "signed_out"]);

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

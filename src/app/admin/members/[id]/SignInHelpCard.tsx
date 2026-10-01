"use client";

import { useState, useTransition } from "react";
import type { SignInHelpCard as Info } from "@/lib/sign-in-help";
import { copyMemberSignInLink, emailMemberSignInHelp } from "./sign-in-help-actions";

const FAILED = "Couldn't do that just now. Try again in a minute.";

// Someone who can't get into the website. One button that does the right
// thing (lib/sign-in-help.ts): a password reset if they have a login, or a
// link to set one up if they don't. Both go to their own inbox; "Copy
// link" is for texting it instead.
export default function SignInHelpCard({ memberId, memberName, info }: { memberId: string; memberName: string; info: Info }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [link, setLink] = useState<{ url: string; note: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const first = memberName.split(" ")[0] || memberName;

  const canEmail = (info.state === "reset" || info.state === "setup") && !!info.email;
  const canCopy = (info.state === "reset" && info.canCopy) || info.state === "setup";
  const what = info.state === "reset" ? "a password reset" : "a setup link";

  // What the card says about where they stand, or why it can't help.
  const about =
    info.state === "managers-only"
      ? "A manager can send them sign-in help from here. They can also tap “Forgot password or first time here?” on the website's sign-in page."
      : info.state === "reset"
        ? null
        : info.state === "setup"
          ? info.email
            ? "No website login yet. A setup link lets them make one; it asks for the last 4 digits of their phone."
            : "No website login yet, and no email on file. Copy a setup link and text it to them; it asks for the last 4 digits of their phone."
          : info.state === "no-phone"
            ? "Add their phone number first: the setup page checks the last 4 digits."
            : info.reason;

  function send() {
    setResult(null);
    startTransition(async () => {
      const r = await emailMemberSignInHelp(memberId).catch(() => ({ ok: false as const, error: FAILED }));
      setConfirming(false);
      if (!r.ok) return setResult({ ok: false, text: r.error });
      setResult({
        ok: true,
        text:
          r.sent === "reset"
            ? "Sent. It comes from Royale Cinema Lounge and the link works once."
            : `Sent. It comes from Royale Cinema Lounge and the link works for ${r.days} days.`,
      });
    });
  }

  function copy() {
    if (info.state === "reset" && !confirm(`Make a password reset link for ${memberName}?\n\nAnyone who opens it can set a new password and sign in as ${first}. Give it only to ${first}.`)) return;
    setResult(null);
    setConfirming(false);
    setCopied(false);
    startTransition(async () => {
      const r = await copyMemberSignInLink(memberId).catch(() => ({ ok: false as const, error: FAILED }));
      if (!r.ok) return setResult({ ok: false, text: r.error });
      setLink({
        url: r.link,
        note:
          r.kind === "reset"
            ? `Give this only to ${first}: anyone who has it can get into ${first}'s login. It works once and runs out after about an hour. It isn't shown again after you close this.`
            : `Text it to ${first}. It's just for them, asks for the last 4 digits of their phone, and works for ${r.days} days. It isn't shown again after you close this.`,
      });
      navigator.clipboard?.writeText(r.link).then(
        () => setCopied(true),
        () => setCopied(false),
      );
    });
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="mb-3 text-lg font-semibold">Sign-in help</h2>
      {info.state === "reset" && (
        <p className="mb-3 text-sm text-[var(--muted)]">
          Website login: {info.email}
          {info.socialOnly && (
            <>
              <br />
              They sign in with {info.socialOnly}. A reset adds a password alongside it.
            </>
          )}
        </p>
      )}
      {about && <p className="mb-3 text-sm text-[var(--muted)]">{about}</p>}

      {confirming && canEmail ? (
        <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
          <p className="text-sm">
            Email {what} to {info.state === "reset" || info.state === "setup" ? info.email : ""}?
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" disabled={pending} onClick={send}>
              {pending ? "Sending…" : "Send it"}
            </button>
            <button className="text-sm text-[var(--muted)] hover:underline" disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {(canEmail || !canCopy) && (
            <button
              className="rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canEmail || pending}
              onClick={() => {
                setResult(null);
                setConfirming(true);
              }}
            >
              Send sign-in help
            </button>
          )}
          {canCopy && (
            <button className="rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50" disabled={pending} onClick={copy}>
              {pending && !confirming ? "Making…" : info.state === "reset" ? "Copy a reset link" : "Copy link"}
            </button>
          )}
        </div>
      )}

      {result && (
        <p className={`mt-2 text-sm ${result.ok ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"}`} role={result.ok ? "status" : "alert"}>
          {result.text}
        </p>
      )}
      {link && (
        <div className="notice notice-warn mt-3 !p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly className="input min-w-0 flex-1 !py-1 font-mono text-xs" value={link.url} onFocus={(e) => e.currentTarget.select()} />
            <button
              className="btn-primary !px-3 !py-1 text-xs"
              onClick={() =>
                navigator.clipboard?.writeText(link.url).then(
                  () => setCopied(true),
                  () => setCopied(false),
                )
              }
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              className="text-xs text-[var(--muted)] underline"
              onClick={() => {
                setLink(null);
                setCopied(false);
              }}
            >
              Done
            </button>
          </div>
          <p className="mt-2 text-xs">{link.note}</p>
        </div>
      )}
    </div>
  );
}

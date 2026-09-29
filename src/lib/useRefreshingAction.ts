"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Server Actions invoked programmatically (not via a <form action>) don't
// automatically refresh the current route's server-rendered data even after
// calling revalidatePath. This wraps a mutation with router.refresh() so
// admin screens reflect the write immediately instead of only on next nav.
//
// It also makes failures visible. Before, an action that returned
// { ok: false, error } was ignored (the screen just didn't change), and one
// that threw took the whole page down. Now either one becomes a message:
// returned here as `error` for a screen that wants to show it in place, and
// announced to the back office's error bar (AdminErrorBar, in the admin
// layout) so every screen using this hook shows a failed save without
// wiring anything up. Pass { quiet: true } when the screen shows the
// message itself and a second copy in the bar would be noise.

export const ACTION_ERROR_EVENT = "rcl:action-error";

// A thrown error's message is replaced in production ("Minified React error
// #441"), so there's nothing better to show than this.
const FALLBACK = "That didn't save. Check the connection and try again. If it keeps happening, tell a manager.";

// { ok: false, error: "..." } is the shape the back office's actions return
// for a failure the person can do something about.
function failureMessage(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("ok" in result) || result.ok !== false) return null;
  const error = "error" in result ? result.error : null;
  return typeof error === "string" && error ? error : FALLBACK;
}

// redirect() and notFound() inside an action arrive as thrown errors with a
// NEXT_ digest. They're navigation, not failures, so they pass through.
function isNavigation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "digest" in e && typeof e.digest === "string" && e.digest.startsWith("NEXT_");
}

export function announceActionError(message: string) {
  window.dispatchEvent(new CustomEvent<string>(ACTION_ERROR_EVENT, { detail: message }));
}

export function useRefreshingAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<unknown>, options?: { quiet?: boolean }) {
    setError(null);
    startTransition(async () => {
      let message: string | null = null;
      try {
        message = failureMessage(await action());
      } catch (e) {
        if (isNavigation(e)) throw e;
        console.error(e);
        message = FALLBACK;
      }
      if (message) {
        setError(message);
        if (!options?.quiet) announceActionError(message);
      }
      // Refresh either way: after a failure the screen should show what
      // actually got saved, not what was typed.
      router.refresh();
    });
  }

  return [pending, run, error, () => setError(null)] as const;
}

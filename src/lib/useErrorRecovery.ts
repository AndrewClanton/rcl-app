"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Getting a device going again from an error screen: the register
// (src/app/pos/error.tsx), the TVs and tablets (src/app/display/error.tsx)
// and the last-resort screen (src/app/global-error.tsx).
//
// The first try is retry(): Next re-fetches the page and re-renders it,
// which fixes a dropped connection or a failed database read without a
// reload. If the error screen is still up a few seconds later, or it comes
// back soon after, the whole page is reloaded instead.
//
// Neither happens until the site answers. With no connection, a retry
// falls back to a full browser navigation, and that (like a reload) lands
// on the browser's own "can't connect" page: no button, never tries again.
// On the register's home-screen app or a TV nobody touches, that's stuck
// until someone walks over. So offline, this waits and says so.

// When retry() was last used. Kept outside the component, so it outlives an
// error screen that's shown again after a retry that didn't work.
let lastRetryAt = 0;
const RETRIED_RECENTLY_MS = 45_000;
const RELOAD_IF_STILL_HERE_MS = 5_000;

function retriedRecently() {
  return Date.now() - lastRetryAt < RETRIED_RECENTLY_MS;
}

function noteRetry() {
  lastRetryAt = Date.now();
}

// /api/version is tiny, public and never cached.
async function siteAnswers() {
  try {
    const r = await fetch("/api/version", { cache: "no-store" });
    return r.ok;
  } catch {
    return false;
  }
}

export type RecoveryState = "idle" | "working" | "offline";

// recover() is for a button; { everyMs } also calls it on a timer, for a
// screen nobody is there to tap.
export function useErrorRecovery(retry: () => void, options?: { everyMs?: number }) {
  const everyMs = options?.everyMs;
  const [state, setState] = useState<RecoveryState>("idle");
  const mounted = useRef(false);
  const busy = useRef(false);
  const fallback = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    mounted.current = true;
    const timer = fallback;
    return () => {
      // Unmounted means the page came back: nothing left to reload.
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  const reloadIfOnline = useCallback(async () => {
    const online = await siteAnswers();
    if (!mounted.current) return;
    if (online) window.location.reload();
    else setState("offline");
  }, []);

  const recover = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setState("working");
    const online = await siteAnswers();
    busy.current = false;
    if (!mounted.current) return;
    if (!online) {
      setState("offline");
      return;
    }
    if (retriedRecently()) {
      window.location.reload();
      return;
    }
    noteRetry();
    retry();
    // Still on this screen a few seconds later: the retry didn't take.
    clearTimeout(fallback.current);
    fallback.current = setTimeout(() => void reloadIfOnline(), RELOAD_IF_STILL_HERE_MS);
  }, [retry, reloadIfOnline]);

  useEffect(() => {
    if (!everyMs) return;
    const id = setInterval(() => void recover(), everyMs);
    return () => clearInterval(id);
  }, [everyMs, recover]);

  return { state, recover };
}

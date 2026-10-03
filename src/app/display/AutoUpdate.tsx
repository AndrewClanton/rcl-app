"use client";

import { useEffect, useRef } from "react";

// Display screens (the check-in tablet) run all night and nobody thinks to
// refresh them, so a new version of the site never reached them: they kept
// the old page, missing whatever the register had just learned to send.
// Once a newer version is live, this reloads the screen itself, but only
// while it's quiet: nothing on it (busy) and nobody has touched it for a
// minute and a half, so a guest is never cut off mid-check-in.
const CHECK_MS = 60_000;
const QUIET_MS = 90_000;

export default function AutoUpdate({ current, busy }: { current: string; busy: boolean }) {
  const lastTouch = useRef(0);
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    lastTouch.current = Date.now();
    const touched = () => {
      lastTouch.current = Date.now();
    };
    let stale = false;
    const tryReload = () => {
      if (stale && !busyRef.current && Date.now() - lastTouch.current > QUIET_MS) window.location.reload();
    };
    const check = async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const { id } = (await r.json()) as { id: string };
        if (id && id !== current) stale = true;
      } catch {
        // Offline for a moment: try again next time.
      }
      tryReload();
    };
    const timer = setInterval(check, CHECK_MS);
    window.addEventListener("pointerdown", touched);
    window.addEventListener("keydown", touched);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", touched);
      window.removeEventListener("keydown", touched);
    };
  }, [current]);

  return null;
}

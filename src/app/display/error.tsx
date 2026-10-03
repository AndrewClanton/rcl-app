"use client"; // Error boundaries must be Client Components

import { useEffect, useSyncExternalStore } from "react";
import { useErrorRecovery } from "@/lib/useErrorRecovery";

// The error screen for the TVs and tablets under /display. Nobody is there
// to tap anything, so it's a quiet branded screen that gets itself back:
// every 30 seconds it retries, then reloads the page if that didn't take
// (useErrorRecovery, which also waits out a dropped connection instead of
// reloading into the browser's offline page). No error details: customers
// see these screens.
const TRY_EVERY_MS = 30_000;

const INK = "#14110c";
const CREAM = "#f8f5ec";
const MUTED = "#a9a293";
const GOLD = "#ffc72c";

export default function DisplayError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { state } = useErrorRecovery(retry, { everyMs: TRY_EVERY_MS });
  const turn = useSyncExternalStore(subscribeResize, rampTurn, () => 0);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="fixed inset-0 flex cursor-none items-center justify-center overflow-hidden" style={{ background: INK }}>
      <div
        className="flex flex-col items-center px-8 text-center"
        style={{ transform: turn ? `rotate(${turn}deg)` : undefined, maxWidth: turn ? "100vh" : "100vw" }}
      >
        <div className="font-display uppercase leading-none" style={{ color: CREAM, fontSize: "clamp(2rem, 6vmin, 5rem)", letterSpacing: "0.04em" }}>
          Royale Cinema Lounge
        </div>
        <div aria-hidden="true" className="my-[4vmin] h-[0.8vmin] w-[18vmin]" style={{ background: GOLD }} />
        <div className="font-display" style={{ color: CREAM, fontSize: "clamp(1.25rem, 3.5vmin, 3rem)" }}>
          Back in a moment
        </div>
        <p className="mt-[2vmin]" style={{ color: MUTED, fontSize: "clamp(0.875rem, 2vmin, 1.5rem)" }}>
          {state === "offline" ? "This screen lost its connection. It will keep trying on its own." : "This screen is reconnecting on its own."}
        </p>
      </div>
    </div>
  );
}

// The ramp TV is a landscape stick on a screen stood upright, and its page
// turns itself to match (ramp/RampCountdown.tsx, same ?rotate= options).
// This screen turns the same way, so it isn't on its side. The page may be
// at /display/ramp or, once it's renamed, /display/now-playing.
function rampTurn(): number {
  const path = window.location.pathname;
  if (!path.startsWith("/display/ramp") && !path.startsWith("/display/now-playing")) return 0;
  const rotate = new URLSearchParams(window.location.search).get("rotate");
  if (rotate === "off" || window.innerWidth <= window.innerHeight) return 0;
  return rotate === "ccw" ? -90 : 90;
}

function subscribeResize(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}

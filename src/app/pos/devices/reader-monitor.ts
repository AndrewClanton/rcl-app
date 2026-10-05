"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getReaderHealth } from "../terminal-actions";
import type { ReaderHealth } from "@/lib/terminal/reader-status";

// The register keeps an eye on its card reader: asks the server about once
// a minute while the register is on screen (the server shares one Stripe
// answer between registers, lib/terminal/reader-health.ts), again when the
// iPad wakes, and right away for "Check now". Feeds the Devices panel and
// the "Card reader offline" strip.
export interface ReaderMonitor {
  health: ReaderHealth | null;
  checking: boolean;
  check: (force?: boolean) => void;
}

const EVERY_MS = 60_000;

export function useReaderMonitor(readerId: string | null): ReaderMonitor {
  const [state, setState] = useState<{ readerId: string; health: ReaderHealth | null } | null>(null);
  const [checking, setChecking] = useState(false);
  const askRef = useRef(0);

  const check = useCallback(
    (force = false) => {
      if (!readerId) return;
      const ask = ++askRef.current;
      setChecking(true);
      void getReaderHealth(readerId, force)
        .catch(() => undefined)
        .then((health) => {
          if (ask !== askRef.current) return;
          setChecking(false);
          // No answer from our own server: keep what we had.
          if (health !== undefined) setState({ readerId, health });
        });
    },
    [readerId],
  );

  useEffect(() => {
    if (!readerId) return;
    const first = setTimeout(() => check(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") check();
    }, EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [readerId, check]);

  return { health: state && state.readerId === readerId ? state.health : null, checking, check };
}

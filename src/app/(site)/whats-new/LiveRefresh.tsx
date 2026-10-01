"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Keeps What's new current while it's open: every minute or so, and right
// away when someone comes back to the tab after a while, the page asks the
// server for the latest (statuses, counts, what just shipped). Nothing
// happens while the tab is hidden.
const EVERY_MS = 75_000;

export default function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      last = Date.now();
      router.refresh();
    };
    const timer = window.setInterval(refresh, EVERY_MS);
    const onVisible = () => {
      if (Date.now() - last > EVERY_MS) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);
  return null;
}

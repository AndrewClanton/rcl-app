"use client";

import { useEffect, useState } from "react";

// Shows a "reload" bar once a newer version of the site is live, so the
// register never keeps running an old page (whose buttons would fail with
// "Server Action not found"). Checks once a minute and when the tab regains
// focus.
export default function UpdateBanner({ current }: { current: string }) {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const { id } = (await r.json()) as { id: string };
        if (alive && id && id !== current) setStale(true);
      } catch {
        // Offline for a moment -- try again next time.
      }
    };
    const timer = setInterval(check, 60_000);
    window.addEventListener("focus", check);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [current]);

  if (!stale) return null;
  return (
    <div className="notice notice-warn mb-4 flex flex-wrap items-center justify-between gap-3">
      <span>
        <strong>The register was updated.</strong> Finish the sale you&apos;re on, then reload to get the new version.
      </span>
      <button className="btn-primary !px-4 !py-2" onClick={() => window.location.reload()}>
        Reload now
      </button>
    </div>
  );
}

"use client"; // Error boundaries must be Client Components

import { useEffect, useSyncExternalStore } from "react";
import { useErrorRecovery } from "@/lib/useErrorRecovery";

// The last-resort screen, for when the root layout itself fails. It replaces
// the whole document (so it brings its own <html> and <body>) and gets none
// of globals.css or the fonts, so everything here is inline and plain: the
// brand colors, system fonts, one Reload button. On a /display TV nobody
// taps it, so there it also tries by itself every 30 seconds, like
// display/error.tsx.
const INK = "#14110c";
const CREAM = "#f8f5ec";
const MUTED = "#6b6455";
const RED = "#ed1c24";

const noSubscribe = () => () => {};

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const onDisplay = useSyncExternalStore(noSubscribe, () => window.location.pathname.startsWith("/display"), () => false);
  const { state, recover } = useErrorRecovery(retry, { everyMs: onDisplay ? 30_000 : undefined });

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: CREAM, color: INK, fontFamily: "Arial, Helvetica, sans-serif" }}>
        <title>Royale Cinema Lounge</title>
        <main style={{ maxWidth: 480, padding: "40px 16px", textAlign: "center" }}>
          <div style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontSize: 13, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: RED }}>
            Royale Cinema Lounge
          </div>
          <h1 style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontSize: 30, lineHeight: 1.15, margin: "10px 0 0" }}>Something went wrong</h1>
          <p style={{ fontSize: 16, lineHeight: 1.5, margin: "12px 0 0" }}>This page didn&apos;t load. Reloading usually fixes it.</p>
          <button
            type="button"
            onClick={() => void recover()}
            disabled={state === "working"}
            style={{ marginTop: 24, padding: "14px 32px", border: 0, borderRadius: 8, background: RED, color: "#fff", fontSize: 18, fontWeight: 700, cursor: "pointer", opacity: state === "working" ? 0.6 : 1 }}
          >
            {state === "working" ? "Reloading..." : "Reload"}
          </button>
          {state === "offline" && <p style={{ fontSize: 14, fontWeight: 700, color: RED, margin: "12px 0 0" }}>Can&apos;t reach the internet. Check the Wi-Fi, then try again.</p>}
          {error.digest && <p style={{ fontSize: 12, color: MUTED, margin: "20px 0 0" }}>Reference {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}

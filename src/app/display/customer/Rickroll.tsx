"use client";

import { useEffect } from "react";

// Register → ✨ → Rickroll: the customer screen plays the chorus of Rick
// Astley's "Never Gonna Give You Up" from his official video on YouTube
// (the dance and all), then closes itself. Embedding the official upload
// means we never keep a copy of the song or the video ourselves.
//
// Browsers only autoplay with sound once someone has tapped the screen
// since it loaded. The check-in tablet is tapped all night, so it usually
// just plays; if not, YouTube shows its play button and one tap starts it.
const VIDEO = "dQw4w9WgXcQ";
const START = 43; // "Never gonna give you up…"
const END = 60;
const SHOW_MS = 26_000; // the clip, plus a moment if someone had to tap play

export default function Rickroll({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, SHOW_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  const src =
    `https://www.youtube-nocookie.com/embed/${VIDEO}?autoplay=1&start=${START}&end=${END}` +
    "&controls=0&rel=0&playsinline=1&modestbranding=1&disablekb=1&iv_load_policy=3&fs=0";

  return (
    <div
      role="dialog"
      aria-label="Never Gonna Give You Up"
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "#000", display: "grid", placeItems: "center" }}
    >
      <iframe
        src={src}
        title="Rick Astley, Never Gonna Give You Up (official video)"
        allow="autoplay; encrypted-media"
        style={{ width: "100%", height: "100%", border: 0 }}
      />
      <button
        type="button"
        onClick={onDone}
        aria-label="Close"
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          width: 56,
          height: 56,
          borderRadius: "50%",
          border: "2px solid rgba(255,255,255,.7)",
          background: "rgba(0,0,0,.55)",
          color: "#fff",
          fontSize: 26,
          lineHeight: 1,
          cursor: "pointer",
        }}
      >
        ✕
      </button>
    </div>
  );
}

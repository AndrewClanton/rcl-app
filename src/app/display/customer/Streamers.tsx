"use client";

import { useEffect } from "react";
import styles from "./streamers.module.css";

export interface StreamerPiece {
  left: number; // % across
  delay: number; // s
  duration: number; // s
  drift: number; // vw sideways
  spin: number; // deg
  color: string;
  kind: "streamer" | "confetti" | "sparkle";
}

const COLORS = ["#ffc72c", "#ed1c24", "#14110c", "#f8f5ec", "#ffc72c", "#ed1c24"];

// Made when the register's Celebrate arrives (an event, not a render), so
// every burst is different.
export function makeStreamers(count = 70): StreamerPiece[] {
  return Array.from({ length: count }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 1.2,
    duration: 2.6 + Math.random() * 1.8,
    drift: (Math.random() - 0.5) * 30,
    spin: (Math.random() - 0.5) * 900,
    color: COLORS[i % COLORS.length],
    kind: i % 7 === 0 ? "sparkle" : i % 3 === 0 ? "streamer" : "confetti",
  }));
}

// The register's "Celebrate" Easter egg on the customer screen: a burst of
// streamers, confetti and sparkles with a big "Woo!" for a few seconds.
export default function Streamers({ pieces, onDone }: { pieces: StreamerPiece[]; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 5200);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div className={styles.layer} aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className={`${styles.piece} ${styles[p.kind]}`}
          style={
            {
              left: `${p.left}%`,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              background: p.kind === "sparkle" ? "transparent" : p.color,
              color: p.kind === "sparkle" ? "#ffc72c" : undefined,
              "--drift": `${p.drift}vw`,
              "--spin": `${p.spin}deg`,
            } as React.CSSProperties
          }
        >
          {p.kind === "sparkle" ? "✦" : null}
        </span>
      ))}
      <div className={styles.banner}>Woo!</div>
    </div>
  );
}

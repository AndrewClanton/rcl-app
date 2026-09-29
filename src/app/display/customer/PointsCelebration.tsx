"use client";

import { useEffect, useEffectEvent, type CSSProperties } from "react";
import { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/loyalty";
import styles from "./checkin.module.css";

// How long the burst stays up (the CSS fades it out just before this).
const SHOW_MS = 6600;

const RED = "#ed1c24";
const INK = "#14110c";
const WHITE = "#ffffff";

// Confetti, scattered by hand (no randomness in render): left edge, delay,
// fall time, spin, color.
const CONFETTI: [number, number, number, number, string][] = [
  [3, 0.15, 2.8, 420, RED],
  [9, 0.6, 3.1, -380, INK],
  [15, 0.05, 2.5, 300, WHITE],
  [21, 0.9, 2.9, -460, RED],
  [27, 0.35, 3.3, 360, INK],
  [33, 1.1, 2.7, -300, WHITE],
  [39, 0.2, 3.0, 480, RED],
  [45, 0.75, 2.6, -420, INK],
  [51, 0.0, 3.2, 340, RED],
  [57, 0.5, 2.8, -360, WHITE],
  [63, 1.0, 3.1, 400, INK],
  [69, 0.25, 2.6, -480, RED],
  [75, 0.8, 3.0, 320, WHITE],
  [81, 0.1, 2.9, -340, INK],
  [87, 0.65, 3.3, 440, RED],
  [93, 0.4, 2.7, -400, WHITE],
  [12, 1.4, 3.0, 380, RED],
  [48, 1.5, 2.8, -320, INK],
  [72, 1.3, 3.1, 360, RED],
];

function pts(n: number) {
  return `${n.toLocaleString("en-US")} point${n === 1 ? "" : "s"}`;
}

// Plays on the customer screen when a sale with a member on it completes
// (the register broadcasts "points-earned"), then gets out of the way.
export default function PointsCelebration({ firstName, earned, balance, onDone }: { firstName: string; earned: number; balance: number; onDone: () => void }) {
  const done = useEffectEvent(onDone);
  useEffect(() => {
    const timer = setTimeout(() => done(), SHOW_MS);
    return () => clearTimeout(timer);
  }, []);

  // Progress toward their first (or next) reward.
  const toPct = Math.min(100, (balance / POINTS_PER_REWARD) * 100);
  const fromPct = Math.max(0, Math.min(toPct, ((balance - earned) / POINTS_PER_REWARD) * 100));
  const needed = Math.max(0, POINTS_PER_REWARD - balance);

  return (
    <div className={styles.overlay} role="status" aria-live="polite">
      <div className={styles.confetti} aria-hidden="true">
        {CONFETTI.map(([x, d, s, r, c], i) => (
          <i key={i} style={{ "--x": `${x}%`, "--d": `${d}s`, "--s": `${s}s`, "--r": `${r}deg`, "--c": c } as CSSProperties} />
        ))}
      </div>

      <div className={styles.burst}>
        <div className={styles.star} aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className={styles.plus}>+{earned.toLocaleString("en-US")}</div>
        <div className={styles.unit}>{earned === 1 ? "point" : "points"}</div>
      </div>

      <div className={styles.headline}>Nice one, {firstName}!</div>

      <div className={styles.balance}>
        <div className={styles.balanceLabel}>Your balance</div>
        <div className={styles.balanceNumber}>{pts(balance)}</div>
        <div className={styles.track} aria-hidden="true">
          <div className={styles.fill} style={{ "--from": `${fromPct}%`, "--to": `${toPct}%` } as CSSProperties} />
        </div>
        <div className={styles.reward}>
          {needed === 0 ? `That's $${REWARD_VALUE} off, ready when you are. Just ask!` : `${pts(needed)} to $${REWARD_VALUE} off`}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useEffectEvent, useState, type CSSProperties } from "react";
import { isGuestName } from "@/lib/member-name";
import type { TabletCheckin } from "@/lib/checkin";
import { flairColor } from "@/lib/flair";
import s from "./reward.module.css";
import { playSound, type SoundName } from "./sounds";

// The instant payoff for checking in at the screen (Andrew, 10/2): the
// moment they tap "Check in", before the server has answered, the screen
// dims for a beat and an icon pops in the middle; when the answer lands,
// a glowing gold "+5" (what this check-in actually paid, badges and all;
// "Welcome back!" if they'd already checked in today) and confetti, then
// it fades away into their card beside the order. Under about two and a
// half seconds when the server's quick. A number we don't know, or an
// error, never shows points: CheckinKiosk takes it down (`leaving`) and
// moves on to the next screen. Reduced motion: a plain fade, no confetti.

export type RewardResult =
  | { kind: "points"; earned: number; alreadyToday: boolean; firstName: string | null; isNew: boolean; accent: string | null; streak: number }
  // Sent on to the register with nothing checked in here.
  | { kind: "thanks" };

export interface RewardShown {
  key: number;
  result: RewardResult | null; // null: still waiting on the server
  leaving?: boolean; // taken down without a reward
}

// What the server's check-in says, for the reward.
export function rewardFor(c: TabletCheckin | null | undefined): RewardResult {
  if (!c) return { kind: "thanks" };
  const name = c.firstName.slice(0, 40);
  return {
    kind: "points",
    earned: Math.max(0, Math.round(Number(c.visit?.earned) || 0)),
    alreadyToday: !!c.visit?.alreadyToday,
    firstName: isGuestName(name) ? null : name,
    isNew: c.isNew === true,
    accent: flairColor(c.flair?.color)?.hex ?? null,
    streak: Math.max(0, Math.round(Number(c.visit?.weekStreak) || 0)),
  };
}

// The icon has the stage to itself this long before the points can show;
// the points hold this long; then the fade.
const ICON_MS = 420;
const HOLD_MS = 1_350;
const HOLD_NEW_MS = 1_900;
const FADE_MS = 320;

const GOLD = "#ffc72c";
const RED = "#ed1c24";
const CREAM = "#f3ecd9";

// Confetti, placed by hand (nothing random while rendering): left edge,
// delay, fall time, spin, color.
const CONFETTI: [number, number, number, number, string][] = [
  [4, 0.0, 1.5, 380, GOLD],
  [11, 0.12, 1.7, -340, RED],
  [18, 0.05, 1.4, 300, CREAM],
  [26, 0.2, 1.6, -420, GOLD],
  [33, 0.08, 1.8, 360, RED],
  [41, 0.16, 1.5, -300, CREAM],
  [49, 0.02, 1.7, 440, GOLD],
  [56, 0.22, 1.5, -380, RED],
  [63, 0.1, 1.6, 320, CREAM],
  [70, 0.18, 1.4, -440, GOLD],
  [77, 0.04, 1.8, 400, RED],
  [84, 0.14, 1.5, -320, CREAM],
  [91, 0.07, 1.7, 360, GOLD],
  [96, 0.2, 1.6, -360, RED],
];

export default function CheckinReward({ shown, onDone }: { shown: RewardShown; onDone: () => void }) {
  const [ready, setReady] = useState(false);
  const [out, setOut] = useState(false);
  const done = useEffectEvent(onDone);
  const r = shown.result;
  const revealed = ready && !!r && !shown.leaving;
  const hold = r?.kind === "points" && r.isNew ? HOLD_NEW_MS : HOLD_MS;

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), ICON_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(() => setOut(true), hold);
    return () => clearTimeout(timer);
  }, [revealed, hold]);

  useEffect(() => {
    if (!out) return;
    const timer = setTimeout(() => done(), FADE_MS);
    return () => clearTimeout(timer);
  }, [out]);

  const points = revealed && r?.kind === "points" ? r : null;
  // Already checked in today (or nothing to pay): "Welcome back!" big, no points.
  const welcomeOnly = !!points && (points.alreadyToday || points.earned <= 0);

  // A pop as the icon comes in, then the payoff's own sound: a coin for
  // "+5", a little fanfare for someone new, two notes for "Welcome back!"
  // (sounds.ts). One sent on to the register chimes on the screen after.
  useEffect(() => {
    playSound("pop");
  }, []);
  const payoff: SoundName | null = !revealed || r?.kind !== "points" ? null : welcomeOnly ? "welcomeBack" : r.isNew ? "fanfare" : "checkin";
  useEffect(() => {
    if (payoff) playSound(payoff);
  }, [payoff]);
  const who = points?.firstName;
  const hello = !points
    ? null
    : welcomeOnly
      ? who
        ? `${who}, you're already checked in today.`
        : "You're already checked in today."
      : points.isNew
        ? who
          ? `Welcome to Royale Cinema, ${who}!`
          : "Welcome to Royale Cinema!"
        : who
          ? `Welcome back, ${who}!`
          : "Welcome back!";

  return (
    <div className={`${s.reward} ${out || shown.leaving ? s.out : ""}`} role="status" aria-live="polite">
      {points && !welcomeOnly && (
        <div className={s.confetti} aria-hidden="true">
          {CONFETTI.map(([x, d, t, spin, c], i) => (
            <i key={i} style={{ "--x": `${x}%`, "--d": `${d}s`, "--t": `${t}s`, "--r": `${spin}deg`, "--c": points.accent && c === RED ? points.accent : c } as CSSProperties} />
          ))}
        </div>
      )}
      <div className={`${s.icon} ${revealed ? s.iconUp : r || shown.leaving ? "" : s.iconWait}`} aria-hidden="true">
        {welcomeOnly ? "👋" : "🎟️"}
      </div>
      {points ? (
        <>
          {welcomeOnly ? (
            <div className={s.big}>Welcome back!</div>
          ) : (
            <div className={s.big}>
              +{points.earned.toLocaleString("en-US")}
              <span className={s.unit}>{points.earned === 1 ? "point" : "points"}</span>
            </div>
          )}
          <div className={s.hello}>{hello}</div>
          {!welcomeOnly && points.streak > 1 && <div className={s.streak}>🔥 {points.streak} weeks in a row</div>}
        </>
      ) : revealed && r?.kind === "thanks" ? (
        <>
          <div className={s.big}>Thanks!</div>
          <div className={s.hello}>The box office will check you in.</div>
        </>
      ) : (
        <div className={s.hello} style={{ opacity: 0 }}>
          Checking you in
        </div>
      )}
    </div>
  );
}

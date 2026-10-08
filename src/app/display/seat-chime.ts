"use client";

// The boards' "new seat order" sound: three rising bell notes, made with
// the Web Audio API (no audio file). Browsers keep sound off until the page
// is tapped; the boards are tapped all night, so the first tap unlocks it.
// Until then the chime just doesn't play.

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new AudioContext();
    return ctx;
  } catch {
    return null;
  }
}

export function unlockChime() {
  const c = context();
  if (c && c.state === "suspended") void c.resume().catch(() => {});
}

export function playSeatChime() {
  const c = context();
  if (!c || c.state !== "running") return;
  const start = c.currentTime + 0.02;
  [784, 988, 1319].forEach((freq, i) => {
    const t = start + i * 0.16;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.95);
  });
}

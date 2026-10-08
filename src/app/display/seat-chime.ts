"use client";

// The "new seat order" sound (the boards, and Order up on the register):
// three rising bell notes, made with the Web Audio API (no audio file).
// Browsers keep sound off until the page is tapped, so every tap wakes it
// the way the customer screen does (display/customer/sounds.ts): listened
// for on pointerdown, pointerup, touchend, click and keydown (iPadOS only
// counts some of them as a real tap), a silent sound started inside the tap,
// and a resume from any state but running (an iPad that slept leaves it
// "interrupted"). Until then the chime just doesn't play; chimeReady() says
// so, for a "Tap for sound" note.

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    return ctx;
  } catch {
    return null;
  }
}

// From a tap: make (or wake) the audio. Safe to call on every tap.
export function unlockChime() {
  const c = context();
  if (!c) return;
  try {
    if (c.state !== "running") void c.resume().catch(() => {});
    // iPadOS wants a sound started inside the tap itself: a silent one.
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, 22050);
    src.connect(c.destination);
    src.start(0);
  } catch {
    // No audio on this device: everything works the same without it.
  }
}

export const CHIME_UNLOCK_EVENTS = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;

// Listens for taps anywhere on the page to wake the sound. Returns the undo.
export function listenForChimeUnlock(): () => void {
  const wake = () => unlockChime();
  CHIME_UNLOCK_EVENTS.forEach((e) => window.addEventListener(e, wake, { capture: true, passive: true }));
  return () => CHIME_UNLOCK_EVENTS.forEach((e) => window.removeEventListener(e, wake, { capture: true }));
}

// Whether the chime can play right now.
export function chimeReady(): boolean {
  return !!ctx && ctx.state === "running";
}

// The register's Order up (code review M13): louder and different from the
// boards' bells, to carry over a busy front door on an iPad speaker. Two
// pulses of a bright two-tone (triangle plus a square an octave up, which
// small speakers carry better than a sine).
export function playRegisterChime() {
  const c = context();
  if (!c) return;
  if (c.state !== "running") {
    void c.resume().catch(() => {});
    return;
  }
  const start = c.currentTime + 0.02;
  for (let pulse = 0; pulse < 2; pulse++) {
    [
      { freq: 1047, at: 0 },
      { freq: 1568, at: 0.14 },
    ].forEach(({ freq, at }) => {
      const t = start + pulse * 0.55 + at;
      for (const [type, mult, peak] of [
        ["triangle", 1, 0.6],
        ["square", 2, 0.08],
      ] as const) {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = type;
        osc.frequency.value = freq * mult;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(peak, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
        osc.connect(gain).connect(c.destination);
        osc.start(t);
        osc.stop(t + 0.4);
      }
    });
  }
}

export function playSeatChime() {
  const c = context();
  if (!c) return;
  if (c.state !== "running") {
    // Woken by a tap since? Try once; it plays on the next chime if so.
    void c.resume().catch(() => {});
    return;
  }
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

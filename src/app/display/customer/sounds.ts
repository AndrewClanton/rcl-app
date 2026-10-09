"use client";

import { TABLET_SOUND_DEFAULT, parseTabletSound, type TabletSound } from "@/lib/registerChannel";

// The customer screen's sound effects: short (under a second), playful,
// retro arcade and VHS in feel, never harsh. Every one is made here with the
// Web Audio API (oscillators and a little filtered noise), so there are no
// audio files and nothing licensed.
//
// Browsers keep sound off until someone taps the page. The tablet is tapped
// all night, so the first tap unlocks it (unlockSound, from CustomerDisplay)
// and any tap after wakes it again if the iPad put it to sleep. Until then a
// sound simply doesn't play; nothing waits or queues.
//
// On/off and the volume come from the register (Devices → Customer screen
// sounds, sent as "sound") and are remembered on this tablet. Reduced motion
// is for the visuals only: sound has its own switch.

export type SoundName =
  | "key" // a keypad or keyboard key
  | "pop" // the check-in reward pops in
  | "checkin" // "+5": points for checking in
  | "welcomeBack" // already checked in today
  | "card" // a card or screen appears (their card, tickets, a setup form, a question)
  | "add" // an item rung up
  | "remove" // an item taken off
  | "total" // the total changed (a discount, a member)
  | "ready" // the register's payment screen opened
  | "approved" // the sale went through
  | "confetti" // streamers, sparkles, Rewind
  | "fanfare" // a big entrance: a new member, Insiders+, a member's entrance
  | "badge" // a new badge
  | "chime" // a small bell: a gentle "done" (checked in by staff, all set), or "over to the card reader"
  | "tapeIn" // the Rickroll starts: a tape going into the VCR
  | "tapeOut" // the Rickroll stops: the tape winding down
  | "notFound" // a number we don't know
  | "error" // something went wrong
  | "unlock" // a reward bought with points
  | "boom" // the display-only tank on Spend points, tapped
  // A member's own sign-in sound, unlocked with points (lib/rewards.ts
  // PERK_SOUNDS): plays at their check-in instead of the coin.
  | "perk_coin"
  | "perk_projector"
  | "perk_organ"
  | "perk_warp"
  | "perk_drumroll"
  // Meme sounds (Andrew, 10/9), made here like the rest: no clips.
  | "perk_airhorn"
  | "perk_sadtrombone"
  | "perk_boom"
  | "perk_dramatic"
  | "perk_scratch"
  | "perk_rimshot";

// Their sign-in sound's key ("coin") as a sound to play, or null.
export function perkSound(key: string | null | undefined): SoundName | null {
  const name = `perk_${key}`;
  return key && name in RECIPES ? (name as SoundName) : null;
}

const KEY = "rcl.tablet-sound.v1";

let settings: TabletSound | null = null;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
const lastPlayed = new Map<SoundName, number>();

function current(): TabletSound {
  if (settings) return settings;
  try {
    settings = parseTabletSound(JSON.parse(localStorage.getItem(KEY) || "null")) ?? TABLET_SOUND_DEFAULT;
  } catch {
    settings = TABLET_SOUND_DEFAULT;
  }
  return settings;
}

// Loudness follows the ear: 40 sounds like "a bit under half".
const gainFor = (s: TabletSound) => (s.on ? Math.pow(s.volume / 100, 1.5) : 0);

export function soundSettings(): TabletSound {
  return current();
}

export function setSoundSettings(next: TabletSound) {
  settings = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: it holds for this visit, and the register sends it again on reload.
  }
  if (ctx && master) master.gain.setTargetAtTime(gainFor(next), ctx.currentTime, 0.02);
}

// From a tap on the tablet: make (or wake) the audio. Safe to call on every tap.
export function unlockSound() {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      // Everything goes through one volume knob, a soft top-end filter (no
      // shrill edges) and a limiter, so sounds that overlap never clip.
      master = ctx.createGain();
      master.gain.value = gainFor(current());
      const soften = ctx.createBiquadFilter();
      soften.type = "lowpass";
      soften.frequency.value = 5200;
      const limit = ctx.createDynamicsCompressor();
      limit.threshold.value = -14;
      limit.ratio.value = 6;
      master.connect(soften).connect(limit).connect(ctx.destination);
    }
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
    // iPadOS wants a sound started inside the tap itself: a silent one.
    const b = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    // No audio on this device: the screen works the same without it.
  }
}

// A sample from a tap (the sign-in sound picker): wakes the audio, then
// plays it once it's actually running.
export function previewSound(name: SoundName) {
  unlockSound();
  if (!ctx) return;
  if (ctx.state === "running") playSound(name);
  else void ctx.resume().then(() => playSound(name)).catch(() => {});
}

// Plays one, if sound is on and the tablet's been tapped since it loaded.
// n: for "add", how many items are on the order (each one a little higher).
export function playSound(name: SoundName, n = 1) {
  const s = current();
  if (!s.on || s.volume <= 0 || !ctx || !master || ctx.state !== "running") return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? 0) < 90) return; // the same thing twice at once
  lastPlayed.set(name, now);
  try {
    RECIPES[name]({ ac: ctx, out: master, t: ctx.currentTime + 0.01 }, n);
  } catch {
    // A sound that can't play never gets in the way of the screen.
  }
}

// What a new cart from the register sounds like next to the last one: the
// payment screen opening, an item on or off, the total changing, or someone
// put on the order. Nothing for the first cart after a reload (it's not
// news), for a cart that's the same again, or for an order cleared or paid
// ("paid" has its own sound).
type CartLike = { items: { quantity: number }[]; total: number; paying?: boolean; member?: { firstName: string } | null };
export function cartSound(prev: CartLike | null, next: CartLike): [SoundName, number] | null {
  if (!prev) return null;
  const count = (c: CartLike) => c.items.reduce((n, i) => n + i.quantity, 0);
  const before = count(prev);
  const after = count(next);
  if (next.paying && !prev.paying && after > 0) return ["ready", 1];
  if (after > before) return ["add", after];
  if (after < before) return after > 0 ? ["remove", 1] : null;
  if (after > 0 && Math.abs(next.total - prev.total) >= 0.005) return ["total", 1];
  if (next.member && next.member.firstName !== prev.member?.firstName) return ["card", 1];
  return null;
}

// ---------- the instruments ----------

type Kit = { ac: AudioContext; out: AudioNode; t: number };

const NOTE = { G4: 392, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, A6: 1760, C7: 2093 };

function tone(k: Kit, f: number, at: number, dur: number, peak: number, type: OscillatorType = "triangle", slideTo?: number) {
  const o = k.ac.createOscillator();
  const g = k.ac.createGain();
  const t0 = k.t + at;
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.012, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(k.out);
  o.start(t0);
  o.stop(t0 + dur + 0.03);
}

// One organ pipe: held at full voice while the key is down (a short
// swell in, a short release out), drawbar partials, and a tremulant.
function organ(k: Kit, f: number, at: number, dur: number, peak: number) {
  const t0 = k.t + at;
  const g = k.ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + 0.025);
  g.gain.setValueAtTime(peak, t0 + dur);
  g.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.12);
  const trem = k.ac.createOscillator();
  const depth = k.ac.createGain();
  trem.frequency.value = 6.5;
  depth.gain.value = f * 0.006;
  trem.connect(depth);
  // 16', 8', 4', 2 2/3': the theater-organ stack.
  for (const [mult, level] of [
    [0.5, 0.5],
    [1, 1],
    [2, 0.6],
    [3, 0.3],
  ]) {
    const o = k.ac.createOscillator();
    const lv = k.ac.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(f * mult, t0);
    depth.connect(o.frequency);
    lv.gain.value = level;
    o.connect(lv).connect(g);
    o.start(t0);
    o.stop(t0 + dur + 0.15);
  }
  g.connect(k.out);
  trem.start(t0);
  trem.stop(t0 + dur + 0.15);
}

function noise(k: Kit, at: number, dur: number, peak: number, freq: number, type: BiquadFilterType = "bandpass", sweepTo?: number) {
  if (!noiseBuffer || noiseBuffer.sampleRate !== k.ac.sampleRate) {
    noiseBuffer = k.ac.createBuffer(1, Math.floor(k.ac.sampleRate * 0.8), k.ac.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    // A fixed pattern, not Math.random: the same hiss every time is fine.
    let x = 0x2545f491;
    for (let i = 0; i < d.length; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      d[i] = ((x >>> 0) / 0xffffffff) * 2 - 1;
    }
  }
  const src = k.ac.createBufferSource();
  src.buffer = noiseBuffer;
  const f = k.ac.createBiquadFilter();
  const g = k.ac.createGain();
  const t0 = k.t + at;
  f.type = type;
  f.frequency.setValueAtTime(freq, t0);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(k.out);
  src.start(t0);
  src.stop(t0 + dur + 0.03);
}

const RECIPES: Record<SoundName, (k: Kit, n: number) => void> = {
  key: (k) => tone(k, NOTE.A6, 0, 0.035, 0.1),
  pop: (k) => tone(k, 420, 0, 0.1, 0.28, "sine", 900),
  // A coin: two quick notes, the second one ringing.
  checkin: (k) => {
    tone(k, NOTE.B5, 0, 0.08, 0.16, "square");
    tone(k, NOTE.E6, 0.075, 0.42, 0.16, "square");
  },
  welcomeBack: (k) => {
    tone(k, NOTE.G5, 0, 0.13, 0.28);
    tone(k, NOTE.C6, 0.12, 0.34, 0.28);
  },
  card: (k) => {
    tone(k, 330, 0, 0.13, 0.26, "sine", 660);
    tone(k, 990, 0.1, 0.14, 0.1);
  },
  // Each item a semitone higher than the last, up to an octave: a combo.
  add: (k, n) => {
    const f = 660 * Math.pow(2, Math.min(Math.max(n - 1, 0), 12) / 12);
    tone(k, f, 0, 0.06, 0.11, "square");
    tone(k, f * 1.5, 0.055, 0.1, 0.11, "square");
  },
  remove: (k) => tone(k, 700, 0, 0.13, 0.2, "triangle", 420),
  total: (k) => {
    tone(k, NOTE.E6, 0, 0.045, 0.12);
    tone(k, NOTE.A6, 0.05, 0.06, 0.1);
  },
  ready: (k) => {
    [NOTE.C5, NOTE.E5, NOTE.G5].forEach((f, i) => tone(k, f, i * 0.07, 0.13, 0.22));
    tone(k, NOTE.C6, 0.21, 0.34, 0.22);
  },
  // The "extra life": a quick run up, the top note ringing.
  approved: (k) => {
    [NOTE.G5, NOTE.C6, NOTE.E6, NOTE.G6].forEach((f, i) => tone(k, f, i * 0.06, 0.1, 0.12, "square"));
    tone(k, NOTE.C7, 0.24, 0.4, 0.12, "square");
    tone(k, NOTE.C6, 0.24, 0.4, 0.14);
  },
  confetti: (k) => {
    noise(k, 0, 0.09, 0.22, 1800);
    const run = [NOTE.C6, NOTE.E6, NOTE.D6, NOTE.G6, NOTE.E6, NOTE.A6, NOTE.G6, NOTE.C7];
    run.forEach((f, i) => tone(k, f, 0.05 + i * 0.065, 0.09, 0.1, "sine"));
  },
  fanfare: (k) => {
    [NOTE.G4, NOTE.C5, NOTE.E5].forEach((f, i) => {
      tone(k, f, i * 0.1, 0.12, 0.2);
      tone(k, f * 2, i * 0.1, 0.12, 0.05, "square");
    });
    tone(k, NOTE.G5, 0.3, 0.5, 0.22);
    tone(k, NOTE.G5 * 2, 0.3, 0.5, 0.05, "square");
  },
  badge: (k) => {
    [NOTE.E6, NOTE.G6, NOTE.C7].forEach((f, i) => tone(k, f, i * 0.06, 0.1, 0.1, "sine"));
    tone(k, NOTE.C6, 0.18, 0.5, 0.16, "sine");
    tone(k, NOTE.G6, 0.18, 0.42, 0.06, "sine");
  },
  // A small bell.
  chime: (k) => {
    tone(k, NOTE.C6, 0, 0.55, 0.2, "sine");
    tone(k, NOTE.G6, 0, 0.4, 0.07, "sine");
  },
  // The cassette clunks in and the VCR's motor spins up.
  tapeIn: (k) => {
    noise(k, 0, 0.07, 0.4, 320);
    tone(k, 75, 0, 0.12, 0.45, "sine", 55);
    tone(k, 110, 0.1, 0.35, 0.07, "sawtooth", 230);
    noise(k, 0.12, 0.38, 0.05, 4000, "highpass");
  },
  // The tape winds down, then the clunk.
  tapeOut: (k) => {
    tone(k, 240, 0, 0.55, 0.08, "sawtooth", 60);
    noise(k, 0, 0.5, 0.04, 3000, "lowpass", 400);
    noise(k, 0.55, 0.07, 0.35, 320);
    tone(k, 70, 0.55, 0.1, 0.35, "sine", 50);
  },
  // "Hmm": down a third, soft.
  notFound: (k) => {
    tone(k, NOTE.E5, 0, 0.15, 0.2);
    tone(k, NOTE.C5, 0.15, 0.28, 0.2);
  },
  // "Uh-oh": lower and rounder, never a buzzer.
  error: (k) => {
    tone(k, 233, 0, 0.14, 0.24, "sine");
    tone(k, 185, 0.14, 0.26, 0.24, "sine");
  },
  // Points spent: a register "ka-" and a sparkle run up.
  unlock: (k) => {
    noise(k, 0, 0.05, 0.25, 2400);
    [NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6, NOTE.G6].forEach((f, i) => tone(k, f, 0.04 + i * 0.05, 0.12, 0.14, "triangle"));
    tone(k, NOTE.C7, 0.3, 0.45, 0.08, "sine");
  },
  // The tank on Spend points blows up (never a purchase): a crack, a low
  // rumble falling away, a thump underneath.
  boom: (k) => {
    noise(k, 0, 0.08, 0.5, 2200);
    noise(k, 0.01, 0.75, 0.6, 900, "lowpass", 60);
    tone(k, 90, 0, 0.6, 0.5, "sine", 32);
  },
  // ---------- sign-in sounds bought with points ----------
  // Three coins, the last one ringing.
  perk_coin: (k) => {
    [0, 0.12, 0.24].forEach((at, i) => {
      tone(k, NOTE.B5, at, 0.07, 0.14, "square");
      tone(k, NOTE.E6 * (i === 2 ? 2 : 1), at + 0.065, i === 2 ? 0.5 : 0.1, 0.13, "square");
    });
  },
  // A projector's shutter clatters up to speed, then the lamp hums.
  perk_projector: (k) => {
    for (let i = 0; i < 9; i++) noise(k, i * (0.11 - i * 0.008), 0.03, 0.22, 1400 + i * 60);
    tone(k, 110, 0.55, 0.45, 0.12, "sawtooth", 120);
    tone(k, 220, 0.55, 0.45, 0.04, "sine");
  },
  // A theater-organ flourish: a quick run up into a big held chord, with
  // the organ's own voice (drawbars: a sub, the note, its octave and the
  // twelfth, held steady, not plucked) and the tremulant's wobble.
  perk_organ: (k) => {
    [NOTE.G4, NOTE.C5, NOTE.E5, NOTE.G5].forEach((f, i) => organ(k, f, i * 0.075, 0.09, 0.05));
    [261.63, NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f) => organ(k, f, 0.31, 1.1, 0.04));
  },
  // A sci-fi warp: a sweep down, then up and out.
  perk_warp: (k) => {
    tone(k, 1600, 0, 0.3, 0.12, "sine", 180);
    tone(k, 180, 0.28, 0.4, 0.12, "triangle", 2200);
    noise(k, 0.28, 0.35, 0.05, 600, "bandpass", 5000);
  },
  // A snare roll and a cymbal.
  perk_drumroll: (k) => {
    for (let i = 0; i < 12; i++) noise(k, i * 0.045, 0.04, 0.12 + i * 0.01, 1800);
    tone(k, 90, 0.55, 0.18, 0.3, "sine", 50);
    noise(k, 0.56, 0.6, 0.12, 7000, "highpass");
  },
  // ---------- meme sign-in sounds ----------
  // The air horn: three short blasts and a long one.
  perk_airhorn: (k) => {
    [0, 0.16, 0.32].forEach((at) => [415, 418, 622].forEach((f) => tone(k, f, at, 0.12, 0.07, "sawtooth")));
    [415, 418, 622, 830].forEach((f) => tone(k, f, 0.5, 0.75, 0.06, "sawtooth", f * 0.97));
  },
  // Wah, wah, wah, waaah (each one bending down, the last one wobbling).
  perk_sadtrombone: (k) => {
    [311, 294, 277].forEach((f, i) => tone(k, f, i * 0.38, 0.34, 0.12, "sawtooth", f * 0.94));
    const t0 = k.t + 1.14;
    const o = k.ac.createOscillator();
    const g = k.ac.createGain();
    const lfo = k.ac.createOscillator();
    const d = k.ac.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(262, t0);
    o.frequency.linearRampToValueAtTime(240, t0 + 1);
    lfo.frequency.value = 6;
    d.gain.value = 9;
    lfo.connect(d).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.03);
    g.gain.setValueAtTime(0.12, t0 + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
    o.connect(g).connect(k.out);
    o.start(t0);
    lfo.start(t0);
    o.stop(t0 + 1.15);
    lfo.stop(t0 + 1.15);
  },
  // The big bass "boom" that lands after a punchline.
  perk_boom: (k) => {
    tone(k, 120, 0, 0.9, 0.5, "sine", 38);
    tone(k, 60, 0, 1.1, 0.35, "sine", 30);
    noise(k, 0, 0.12, 0.2, 300, "lowpass");
  },
  // Dun, dun, DUNNN.
  perk_dramatic: (k) => {
    const hit = (at: number, root: number, dur: number) => {
      [root, root * 1.189, root * 1.498, root * 2].forEach((f) => tone(k, f, at, dur, 0.07, "sawtooth"));
      tone(k, root / 2, at, dur, 0.12, "triangle");
    };
    hit(0, 196, 0.28);
    hit(0.36, 185, 0.28);
    hit(0.72, 165, 1.2);
    noise(k, 0.72, 0.9, 0.06, 6000, "highpass");
  },
  // A record scratch: back and forth.
  perk_scratch: (k) => {
    noise(k, 0, 0.12, 0.3, 900, "bandpass", 2600);
    noise(k, 0.12, 0.1, 0.3, 2600, "bandpass", 700);
    noise(k, 0.24, 0.16, 0.3, 800, "bandpass", 3200);
  },
  // Ba-dum, tss.
  perk_rimshot: (k) => {
    noise(k, 0, 0.09, 0.35, 1800);
    tone(k, 200, 0, 0.12, 0.25, "sine", 150);
    tone(k, 110, 0.18, 0.25, 0.35, "sine", 60);
    noise(k, 0.42, 0.7, 0.16, 8000, "highpass");
  },
};

"use client";

import { useEffect, useEffectEvent, useMemo, useRef, type CSSProperties } from "react";
import { ENTRANCE_MS, STILL_MS, effectPalette, partyPalette, rgbTriplet, shade, tint, type EntranceKey, type StickerKey } from "@/lib/flair";
import { confettiScene, fireworksScene, playScene, seeded, type Rand } from "./canvas";
import Sticker, { DRAWN_STICKERS } from "./Sticker";
import Unicorn from "./Unicorn";
import s from "./flair.module.css";

// A member's check-in flair, played once (lib/flair.ts has the catalog):
//   screen  - the customer screen when staff confirm their check-in: the
//             whole screen, over everything, never taking a tap;
//   preview - the little stage on their account's Profile tab;
//   gentle  - the header of their shared profile page, a softer version.
// Each plays for at most ENTRANCE_MS (a still, shorter version under
// reduced motion), then calls onDone. Mount it with a new `key` to play it
// again. Nothing is random at render: `seed` picks the scatter, so a
// replay can differ and the server and browser agree.

export type FlairMode = "screen" | "preview" | "gentle";

const TUNING: Record<
  FlairMode,
  { uw: number; run: number; ground: string; sparks: number; spark: [number, number]; confetti: number; rockets: number; floats: number; float: [number, number]; balloons: number; balloon: [number, number]; soft: boolean }
> = {
  screen: { uw: 24, run: 2.9, ground: "5cqh", sparks: 26, spark: [2.6, 5], confetti: 180, rockets: 5, floats: 26, float: [8, 12.5], balloons: 11, balloon: [12, 17], soft: false },
  preview: { uw: 36, run: 2.6, ground: "7cqh", sparks: 16, spark: [5, 8.5], confetti: 90, rockets: 3, floats: 15, float: [14, 20], balloons: 7, balloon: [18, 25], soft: false },
  gentle: { uw: 28, run: 3.2, ground: "5cqh", sparks: 14, spark: [3.5, 6.5], confetti: 70, rockets: 2, floats: 12, float: [10, 15], balloons: 6, balloon: [13, 19], soft: true },
};

const between = (rand: Rand, lo: number, hi: number) => lo + (hi - lo) * rand();

export default function FlairEffect({
  entrance,
  color,
  sticker = "heart",
  mode = "screen",
  seed = 1,
  onDone,
}: {
  entrance: EntranceKey;
  color: string;
  sticker?: StickerKey;
  mode?: FlairMode;
  seed?: number;
  onDone?: () => void;
}) {
  const done = useEffectEvent(() => onDone?.());
  useEffect(() => {
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => done(), entrance === "classic" ? 0 : reduced ? STILL_MS : ENTRANCE_MS);
    return () => clearTimeout(timer);
  }, [entrance]);

  if (entrance === "classic") return null;
  const t = TUNING[mode];
  const style = { "--c": color, "--rgb": rgbTriplet(color) } as CSSProperties;
  return (
    <div className={`${s.layer} ${mode === "screen" ? s.screen : ""}`} style={style} aria-hidden="true">
      {entrance === "unicorn" && <UnicornRun color={color} mode={mode} seed={seed} />}
      {entrance === "confetti" && <CanvasFx kind="confetti" color={color} mode={mode} seed={seed} />}
      {entrance === "fireworks" && <CanvasFx kind="fireworks" color={color} mode={mode} seed={seed} />}
      {entrance === "reactions" && <Reactions color={color} sticker={sticker} mode={mode} seed={seed} />}
      {entrance === "party" && (
        <>
          <CanvasFx kind="party" color={color} mode={mode} seed={seed} />
          <Balloons color={color} mode={mode} seed={seed} />
          <div className={s.banner}>{t.soft ? "Birthday week!" : "Happy birthday week!"}</div>
        </>
      )}
    </div>
  );
}

// Confetti cannons, falling party confetti, or fireworks, on a canvas the
// size of the layer.
function CanvasFx({ kind, color, mode, seed }: { kind: "confetti" | "party" | "fireworks"; color: string; mode: FlairMode; seed: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const t = TUNING[mode];
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rand = seeded(seed * 7919 + kind.length);
    return playScene(
      canvas,
      (w, h) => {
        if (kind === "fireworks") {
          return fireworksScene(w, h, { colors: [color, "#ffc72c", tint(color, 0.55), "#ffffff"], rockets: t.rockets, rand, soft: t.soft });
        }
        const colors = kind === "party" ? partyPalette(color) : effectPalette(color);
        return confettiScene(w, h, {
          colors,
          backs: colors.map((c) => shade(c, 0.3)),
          count: kind === "party" ? Math.round(t.confetti * 0.7) : t.confetti,
          from: kind === "party" ? "top" : "cannons",
          rand,
          soft: t.soft,
        });
      },
      { ms: ENTRANCE_MS - 150, reduced },
    );
  }, [kind, color, mode, seed]);
  return <canvas ref={ref} className={s.canvas} />;
}

// A four-point sparkle, for the unicorn's trail.
function Spark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 0 C13 8 16 11 24 12 C16 13 13 16 12 24 C11 16 8 13 0 12 C8 11 11 8 12 0 Z" fill="currentColor" />
    </svg>
  );
}

function UnicornRun({ color, mode, seed }: { color: string; mode: FlairMode; seed: number }) {
  const t = TUNING[mode];
  const sparks = useMemo(() => {
    const rand = seeded(seed * 31 + 3);
    const tones = [color, "#ffffff", "#ffc72c", tint(color, 0.5), color];
    const start = 0.1;
    const out = [];
    for (let i = 0; i < t.sparks; i++) {
      const x = ((i + 0.5) / t.sparks) * 100 + (rand() - 0.5) * (100 / t.sparks);
      // When the unicorn's rear passes x (it runs from -uw to 100 cqw).
      const d = start + (t.run * (x + 0.85 * t.uw)) / (100 + t.uw) + rand() * 0.08;
      const life = Math.min(between(rand, 0.8, 1.2), ENTRANCE_MS / 1000 - 0.1 - d);
      if (life < 0.35) continue;
      out.push({
        x,
        y: t.uw * 0.75 * between(rand, 0.18, 0.72),
        d,
        life,
        sz: between(rand, t.spark[0], t.spark[1]),
        fall: between(rand, 3, 11),
        tone: tones[i % tones.length],
        near: Math.abs(x - 50) < 20 && i % 2 === 0,
      });
    }
    return out;
  }, [color, seed, t]);

  return (
    <>
      {sparks.map((p, i) => (
        <span
          key={i}
          className={`${s.spark} ${p.near ? s.near : ""}`}
          style={
            {
              "--x": p.x,
              "--y": p.y,
              "--d": `${p.d}s`,
              "--life": `${p.life}s`,
              "--sz": p.sz,
              "--fall": p.fall,
              "--tone": p.tone,
              "--ground": t.ground,
            } as CSSProperties
          }
        >
          <Spark />
        </span>
      ))}
      <div className={s.run} style={{ "--uw": t.uw, "--run": `${t.run}s`, "--run-delay": "0.1s", "--ground": t.ground, "--gait": mode === "gentle" ? "0.5s" : "0.42s" } as CSSProperties}>
        <div className={s.bounce}>
          <Unicorn color={color} className={s.unicorn} />
        </div>
      </div>
    </>
  );
}

// Live-video reactions: stickers rising from the bottom, swaying, and
// fading away as they go.
function Reactions({ color, sticker, mode, seed }: { color: string; sticker: StickerKey; mode: FlairMode; seed: number }) {
  const t = TUNING[mode];
  const pieces = useMemo(() => {
    const rand = seeded(seed * 97 + 11);
    const spread = 1.9; // s over which they set off
    return Array.from({ length: t.floats }, (_, i) => {
      const d = (i / t.floats) * spread + rand() * 0.12;
      const dur = Math.min(between(rand, 1.45, 1.95), ENTRANCE_MS / 1000 - 0.1 - d);
      return {
        kind: sticker === "mix" ? DRAWN_STICKERS[(i + Math.floor(rand() * 3)) % DRAWN_STICKERS.length] : sticker,
        x: between(rand, 8, 92),
        d,
        dur,
        rise: between(rand, 55, 88),
        sw: between(rand, 0.6, 1.1),
        amp: between(rand, 1.2, 3.2),
        sz: between(rand, t.float[0], t.float[1]),
        hold: between(rand, 12, 55),
        // A few stickers in a lighter or deeper version of the color.
        tone: i % 4 === 1 ? tint(color, 0.35) : i % 4 === 3 ? shade(color, 0.12) : color,
      };
    });
  }, [color, sticker, seed, t]);

  return (
    <>
      {pieces.map((p, i) => (
        <span
          key={i}
          className={`${s.float} ${i >= 7 ? s.extra : ""}`}
          style={{ "--x": p.x, "--d": `${p.d}s`, "--dur": `${p.dur}s`, "--rise": p.rise, "--sz": p.sz, "--hold": p.hold } as CSSProperties}
        >
          <span className={s.sway} style={{ "--sw": `${p.sw}s`, "--amp": p.amp } as CSSProperties}>
            <Sticker kind={p.kind} color={p.tone} />
          </span>
        </span>
      ))}
    </>
  );
}

function Balloon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 60 118" aria-hidden="true">
      <path d="M30 66 C24 78 36 90 30 102 C26 110 32 114 30 118" fill="none" stroke="#f3ecd9" strokeWidth={2} strokeLinecap="round" />
      <ellipse cx={30} cy={31} rx={26} ry={30} fill={color} stroke="#14110c" strokeWidth={3} />
      <ellipse cx={20} cy={19} rx={5.5} ry={9} fill="#fff" opacity={0.55} transform="rotate(-22 20 19)" />
      <path d="M25.5 60 L34.5 60 L30 67 Z" fill={color} stroke="#14110c" strokeWidth={2.5} strokeLinejoin="round" />
    </svg>
  );
}

// The birthday party's balloons, theirs and the house colors.
function Balloons({ color, mode, seed }: { color: string; mode: FlairMode; seed: number }) {
  const t = TUNING[mode];
  const pieces = useMemo(() => {
    const rand = seeded(seed * 53 + 5);
    const colors = partyPalette(color);
    return Array.from({ length: t.balloons }, (_, i) => {
      const d = between(rand, 0, 0.8);
      return {
        x: ((i + 0.5) / t.balloons) * 100 + between(rand, -4, 4),
        d,
        dur: Math.min(between(rand, 2.4, 2.9), ENTRANCE_MS / 1000 - 0.1 - d),
        rise: between(rand, 120, 140),
        sw: between(rand, 1, 1.6),
        amp: between(rand, 0.8, 1.8),
        sz: between(rand, t.balloon[0], t.balloon[1]),
        hold: between(rand, 25, 60),
        color: colors[i % colors.length],
      };
    });
  }, [color, seed, t]);

  return (
    <>
      {pieces.map((p, i) => (
        <span
          key={i}
          className={`${s.float} ${s.balloon} ${i >= 5 ? s.extra : ""}`}
          style={{ "--x": p.x, "--d": `${p.d}s`, "--dur": `${p.dur}s`, "--rise": p.rise, "--sz": p.sz, "--hold": p.hold } as CSSProperties}
        >
          <span className={s.sway} style={{ "--sw": `${p.sw}s`, "--amp": p.amp } as CSSProperties}>
            <Balloon color={p.color} />
          </span>
        </span>
      ))}
    </>
  );
}

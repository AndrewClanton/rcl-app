"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { ENTRANCE_MS, tint, type PaidEffectKey } from "@/lib/flair";
import { seeded } from "./canvas";
import Sticker from "./Sticker";
import p from "./paid.module.css";

// The entrances bought with points (lib/rewards.ts PAID_ENTRANCES), played
// inside FlairEffect's layer like the free ones: the whole customer screen
// at a check-in, or the preview stage on the account page. Each is drawn
// here (CSS, an SVG or a small canvas), in the member's color, and runs a
// little under ENTRANCE_MS. Nothing takes a tap.
//   neon     - "WELCOME IN" buzzes on in neon tubes, flickers, holds;
//   vhs      - static and tracking lines roll, then a VCR "▶ PLAY";
//   reel     - a film leader counts down 3, 2, 1 with its sweeping hand;
//   arcade   - scanlines, falling pixels, "PLAYER 1 READY" blinking;
//   popcorn  - popcorn rains down and piles up.
export default function PaidEntrance({ kind, color, seed, soft }: { kind: PaidEffectKey; color: string; seed: number; soft: boolean }) {
  const style = { "--c": color, "--c2": tint(color, 0.55), "--ms": `${ENTRANCE_MS - 200}ms` } as CSSProperties;
  return (
    <div className={`${p.stage} ${soft ? p.soft : ""}`} style={style}>
      {kind === "neon" && <Neon />}
      {kind === "vhs" && <Vhs seed={seed} />}
      {kind === "reel" && <Reel />}
      {kind === "arcade" && <Arcade seed={seed} />}
      {kind === "popcorn" && <Popcorn seed={seed} color={color} />}
    </div>
  );
}

function Neon() {
  return (
    <div className={p.neonWrap}>
      <div className={p.neonSign}>
        <span className={p.neonSmall}>Royale Cinema</span>
        <span className={p.neonBig}>WELCOME IN</span>
      </div>
    </div>
  );
}

// TV static on a small canvas, scaled up (chunky, cheap to draw).
function Vhs({ seed }: { seed: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const w = (canvas.width = 160);
    const h = (canvas.height = 100);
    const img = g.createImageData(w, h);
    const rand = seeded(seed * 131 + 7);
    let raf = 0;
    const start = performance.now();
    const draw = (now: number) => {
      const t = now - start;
      // Static for the first second and a half, then it clears for PLAY.
      const amount = t < 1500 ? 1 : Math.max(0, 1 - (t - 1500) / 400);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = rand() * 255 * amount;
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 230 * amount;
      }
      g.putImageData(img, 0, 0);
      if (!reduced && t < ENTRANCE_MS && amount > 0) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [seed]);
  return (
    <>
      <canvas ref={ref} className={p.static} />
      <div className={p.tracking} />
      <div className={p.tracking} style={{ animationDelay: "0.45s" }} />
      <div className={p.vcr}>
        <span>▶ PLAY</span>
        <span className={p.vcrTime}>SP 0:00:01</span>
      </div>
    </>
  );
}

function Reel() {
  return (
    <div className={p.leader}>
      <svg viewBox="0 0 200 200" className={p.leaderDial} aria-hidden="true">
        <circle cx="100" cy="100" r="92" fill="none" stroke="#f3ecd9" strokeWidth="5" />
        <circle cx="100" cy="100" r="70" fill="none" stroke="#f3ecd9" strokeWidth="3" />
        <line x1="0" y1="100" x2="200" y2="100" stroke="#f3ecd9" strokeWidth="2" />
        <line x1="100" y1="0" x2="100" y2="200" stroke="#f3ecd9" strokeWidth="2" />
        <path className={p.sweep} d="M100 100 L100 8 A92 92 0 0 1 192 100 Z" fill="var(--c)" opacity="0.55" />
      </svg>
      <span className={`${p.count} ${p.c3}`}>3</span>
      <span className={`${p.count} ${p.c2}`}>2</span>
      <span className={`${p.count} ${p.c1}`}>1</span>
      <div className={p.scratch} />
    </div>
  );
}

function Arcade({ seed }: { seed: number }) {
  const pixels = useMemo(() => {
    const rand = seeded(seed * 17 + 3);
    return Array.from({ length: 34 }, (_, i) => ({ x: rand() * 100, d: rand() * 1.8, dur: 1.1 + rand() * 0.9, sz: 1.2 + rand() * 1.8, alt: i % 3 === 0 }));
  }, [seed]);
  return (
    <>
      <div className={p.scanlines} />
      {pixels.map((px, i) => (
        <span
          key={i}
          className={`${p.pixel} ${px.alt ? p.pixelAlt : ""}`}
          style={{ "--x": px.x, "--d": `${px.d}s`, "--dur": `${px.dur}s`, "--sz": px.sz } as CSSProperties}
        />
      ))}
      <div className={p.arcadeText}>
        <span className={p.arcadeSmall}>INSERT COIN</span>
        <span className={p.arcadeBig}>PLAYER 1 READY</span>
      </div>
    </>
  );
}

function Popcorn({ seed, color }: { seed: number; color: string }) {
  const pieces = useMemo(() => {
    const rand = seeded(seed * 59 + 13);
    return Array.from({ length: 44 }, () => ({ x: rand() * 100, d: rand() * 1.6, dur: 1 + rand() * 0.8, sz: 4 + rand() * 4, spin: (rand() - 0.5) * 540, land: 88 + rand() * 10 }));
  }, [seed]);
  return (
    <>
      {pieces.map((k, i) => (
        <span
          key={i}
          className={`${p.kernel} ${i >= 22 ? p.extra : ""}`}
          style={{ "--x": k.x, "--d": `${k.d}s`, "--dur": `${k.dur}s`, "--sz": k.sz, "--spin": `${k.spin}deg`, "--land": k.land } as CSSProperties}
        >
          <Sticker kind="popcorn" color={i % 5 === 0 ? color : "#ffc72c"} />
        </span>
      ))}
    </>
  );
}

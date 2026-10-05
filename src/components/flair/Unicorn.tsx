import type { CSSProperties } from "react";
import { shade, tint } from "@/lib/flair";
import s from "./flair.module.css";

// The Unicorn run's unicorn: side on, facing right, drawn in Royale Cinema's
// print style (a warm white body inside a thick ink outline), with the mane
// and tail in the member's color. Every part that moves is its own group,
// turned about its own joint by flair.module.css: the legs at the hip and
// knee (a four-beat gallop), the tail and mane waving, a glint running up
// the horn. The run across the screen, the bounce and the sparkle trail
// are FlairEffect's.
//
// Drawn in absolute viewBox units (about 240 x 180, the horn above) so each joint can be named
// as a transform-origin in the same units.

const INK = "#14110c";
const COAT = "#fffaf3";
const COAT_FAR = "#ece3f1"; // the far legs, in shadow
const HOOF = "#ffc72c";

// A leg hanging from (x, y): a rounded haunch or shoulder (its outline over
// the body reads as the joint), a thigh tapering to a round knee, then the
// cannon and a hoof. `thick` for the hind legs' heavier haunches.
function legParts(x: number, y: number, thick: boolean) {
  const t = thick ? 12 : 8.5;
  const top = thick ? 14 : 10;
  const upper =
    `M${x - t} ${y + 2} C${x - t - 1} ${y - top} ${x + t} ${y - top - 2} ${x + t} ${y + 2} ` +
    `C${x + t - 1} ${y + 12} ${x + 7} ${y + 19} ${x + 5.5} ${y + 27} Q${x} ${y + 31} ${x - 5.5} ${y + 27} ` +
    `C${x - 7} ${y + 18} ${x - t + 1} ${y + 10} ${x - t} ${y + 2} Z`;
  const k = y + 26; // the knee
  const lower = `M${x - 5} ${k - 4} L${x - 4.5} ${k + 17} L${x + 4.5} ${k + 17} L${x + 5} ${k - 4} Z`;
  const hoof = `M${x - 6} ${k + 15} L${x + 6} ${k + 15} Q${x + 8.5} ${k + 23} ${x + 7} ${k + 25} L${x - 7} ${k + 25} Q${x - 8.5} ${k + 23} ${x - 6} ${k + 15} Z`;
  return { upper, lower, hoof, hip: `${x}px ${y}px`, knee: `${x}px ${k}px` };
}

function Leg({ x, y, thick, far, legClass, kneeClass }: { x: number; y: number; thick: boolean; far: boolean; legClass: string; kneeClass: string }) {
  const p = legParts(x, y, thick);
  const coat = far ? COAT_FAR : COAT;
  return (
    <g className={legClass} style={{ transformOrigin: p.hip } as CSSProperties}>
      {/* The shin first, so the thigh's round knee sits over its top. */}
      <g className={kneeClass} style={{ transformOrigin: p.knee } as CSSProperties}>
        <path d={p.lower} fill={coat} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
        <path d={p.hoof} fill={HOOF} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
      </g>
      <path d={p.upper} fill={coat} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
    </g>
  );
}

// The silhouette that shares one outline: body, neck, head and ear.
const BODY = "M64 96 C62 78 80 70 104 70 L134 70 C154 70 168 80 168 96 C168 112 156 122 136 122 L98 122 C76 122 66 112 64 96 Z";
const NECK = "M138 78 C146 58 160 42 176 30 L198 42 C192 56 184 70 178 84 C174 94 170 102 162 108 L150 104 Z";
const HEAD =
  "M174 30 C178 18 194 12 206 20 C216 28 226 42 231 52 C234 60 229 68 220 68 C212 68 205 63 198 61 C190 59 182 56 177 49 C172 43 171 36 174 30 Z";
const EAR = "M181 25 L184 4 L195 19 Z";
const SILHOUETTE = [BODY, NECK, HEAD, EAR];

const HORN = "M193.6 12.5 L221 -9 L204.4 21.5 Z";
const MANE = "M186 18 C176 8 160 12 158 24 C148 20 138 28 142 40 C132 38 124 50 130 58 C120 60 118 74 130 79 L142 77 C150 60 162 44 178 32 Z";
const FORELOCK = "M187 21 C190 12 200 10 204 17 C199 16 195 19 193 25 Z";
const TAIL =
  "M68 84 C54 72 34 74 28 88 C18 88 10 100 16 110 C8 118 14 132 28 130 C34 140 50 138 52 126 C60 120 62 106 58 98 C62 94 66 90 68 84 Z";

export default function Unicorn({ color, className }: { color: string; className?: string }) {
  const light = tint(color, 0.5);
  const deep = shade(color, 0.22);
  return (
    <svg viewBox="-4 -18 248 200" className={className} aria-hidden="true" focusable="false" overflow="visible">
      {/* Far side first: behind the body. */}
      <Leg x={84} y={108} thick far legClass={s.legBackFar} kneeClass={s.kneeBackFar} />
      <Leg x={142} y={108} thick={false} far legClass={s.legFrontFar} kneeClass={s.kneeFrontFar} />

      <g className={s.tail} style={{ transformOrigin: "68px 86px" }}>
        <path d={TAIL} fill={color} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
        <path d="M58 98 C50 104 44 116 40 128" fill="none" stroke={deep} strokeWidth={3} strokeLinecap="round" />
        <path d="M50 82 C40 80 34 86 34 92 M30 104 C24 106 22 112 26 116 M40 124 C44 128 48 126 48 121" fill="none" stroke={light} strokeWidth={2.6} strokeLinecap="round" />
      </g>

      {/* One outline around body, neck, head and ear, then the coat over it. */}
      {SILHOUETTE.map((d, i) => (
        <path key={`o${i}`} d={d} fill={INK} stroke={INK} strokeWidth={7} strokeLinejoin="round" />
      ))}
      {SILHOUETTE.map((d, i) => (
        <path key={`f${i}`} d={d} fill={COAT} />
      ))}
      <path d="M184 20 L185.5 9.5 L191 18 Z" fill="#ffb3d4" />
      {/* A little star on the flank, in their color. */}
      <path d="M102 82 C103 88 105 90 111 91 C105 92 103 94 102 100 C101 94 99 92 93 91 C99 90 101 88 102 82 Z" fill={color} stroke={INK} strokeWidth={2} strokeLinejoin="round" />

      <g className={s.mane} style={{ transformOrigin: "170px 40px" }}>
        <path d={MANE} fill={color} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
        <path d="M170 22 C164 20 160 24 160 28 M150 30 C144 30 142 36 144 40 M136 46 C130 48 128 54 132 58" fill="none" stroke={light} strokeWidth={2.6} strokeLinecap="round" />
        <path d="M176 30 C164 40 152 56 142 74" fill="none" stroke={deep} strokeWidth={2.4} strokeLinecap="round" />
      </g>

      <g>
        <path d={HORN} fill={HOOF} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
        <path d="M200.8 7.5 L209.5 12 M207.5 2 L213.3 5 M213.7 -3 L216.9 -1.4" stroke={INK} strokeWidth={2} strokeLinecap="round" />
        <path className={s.glint} d="M197.8 11.1 L216.8 -3.8" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
      </g>
      <path d={FORELOCK} fill={color} stroke={INK} strokeWidth={3} strokeLinejoin="round" />

      {/* Face: a sparkly eye, lashes, a blush, a nostril and a smile. */}
      <ellipse cx={206} cy={35} rx={4.2} ry={5.2} fill={INK} />
      <circle cx={207.6} cy={33} r={1.6} fill="#fff" />
      <path d="M202 30.5 L198.8 27.6 M204.2 29.4 L202.6 25.8" stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
      <ellipse cx={214} cy={48} rx={5.5} ry={3.2} fill="#ff9ecb" opacity={0.8} />
      <ellipse cx={226} cy={55} rx={1.8} ry={1.3} fill={INK} />
      <path d="M215 62 Q220 64.5 225.5 61" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" />

      {/* Near side last: over the body. */}
      <Leg x={96} y={110} thick far={false} legClass={s.legBackNear} kneeClass={s.kneeBackNear} />
      <Leg x={152} y={110} thick={false} far={false} legClass={s.legFrontNear} kneeClass={s.kneeFrontNear} />
    </svg>
  );
}

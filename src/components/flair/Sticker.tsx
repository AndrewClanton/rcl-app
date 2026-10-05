import { shade, tint, type StickerKey } from "@/lib/flair";

// The Floating reactions stickers (lib/flair.ts FLAIR_STICKERS), drawn
// here as little ink-outlined pieces in the member's color, like the rest
// of Royale Cinema's print look. "mix" isn't a drawing: FlairEffect picks one
// of the others per sticker.

const INK = "#14110c";

export const DRAWN_STICKERS: Exclude<StickerKey, "mix">[] = ["heart", "popcorn", "star", "reel", "ticket", "sparkle"];

export default function Sticker({ kind, color, className, title }: { kind: StickerKey; color: string; className?: string; title?: string }) {
  const k = kind === "mix" ? "heart" : kind;
  return (
    <svg viewBox="0 0 64 64" className={className} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      {DRAWINGS[k](color)}
    </svg>
  );
}

const stroke = { stroke: INK, strokeWidth: 3.5, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

const DRAWINGS: Record<Exclude<StickerKey, "mix">, (c: string) => React.ReactNode> = {
  heart: (c) => (
    <>
      <path d="M32 56 C13 43 5 33 5 22 C5 12.5 12.5 6 21 6 C26 6 30 9 32 13 C34 9 38 6 43 6 C51.5 6 59 12.5 59 22 C59 33 51 43 32 56 Z" fill={c} {...stroke} />
      <path d="M13 21 C13 15.5 16.5 12 21 12" fill="none" stroke="#fff" strokeOpacity={0.85} strokeWidth={3.5} strokeLinecap="round" />
    </>
  ),
  star: (c) => (
    <>
      <path d="M32 4 L39.6 21.6 L58.6 23.4 L44.2 36 L48.5 54.7 L32 44.9 L15.5 54.7 L19.8 36 L5.4 23.4 L24.4 21.6 Z" fill={c} {...stroke} />
      <path d="M26 24 L30 15" fill="none" stroke="#fff" strokeOpacity={0.85} strokeWidth={3} strokeLinecap="round" />
    </>
  ),
  popcorn: (c) => (
    <>
      {[
        [17, 25, 8],
        [27, 18, 9],
        [38, 18, 9],
        [47, 25, 8],
        [32, 26, 8],
        [22, 29, 6],
        [42, 29, 6],
      ].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill={i % 2 ? "#fff4d1" : "#ffe7a3"} {...stroke} strokeWidth={3} />
      ))}
      <path d="M12 30 L52 30 L46 59 L18 59 Z" fill="#fffaf3" {...stroke} />
      <path d="M20.5 30 L27 30 L28 59 L23 59 Z M37 30 L43.5 30 L41 59 L36 59 Z" fill={c} />
      <path d="M12 30 L52 30 L46 59 L18 59 Z" fill="none" {...stroke} />
      <rect x={10} y={27} width={44} height={7} rx={2} fill={shade(c, 0.2)} {...stroke} strokeWidth={3} />
    </>
  ),
  reel: (c) => (
    <>
      <circle cx={32} cy={32} r={27} fill={c} {...stroke} />
      <circle cx={32} cy={32} r={20} fill="none" stroke={tint(c, 0.4)} strokeWidth={2} />
      {[0, 72, 144, 216, 288].map((a) => {
        const rad = ((a - 90) * Math.PI) / 180;
        return <circle key={a} cx={32 + Math.cos(rad) * 13.5} cy={32 + Math.sin(rad) * 13.5} r={5.2} fill={INK} />;
      })}
      <circle cx={32} cy={32} r={4.5} fill="#fffaf3" stroke={INK} strokeWidth={2.5} />
    </>
  ),
  ticket: (c) => (
    <g transform="rotate(-14 32 32)">
      <path
        d="M6 18 H58 V26 C54 26 52 29 52 32 C52 35 54 38 58 38 V46 H6 V38 C10 38 12 35 12 32 C12 29 10 26 6 26 Z"
        fill={c}
        {...stroke}
      />
      <path d="M20 21 V43" stroke={INK} strokeWidth={2} strokeDasharray="3 3" />
      <path d="M36 25.5 L37.9 30 L42.7 30.3 L39 33.4 L40.2 38.1 L36 35.5 L31.8 38.1 L33 33.4 L29.3 30.3 L34.1 30 Z" fill="#fffaf3" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
    </g>
  ),
  sparkle: (c) => (
    <>
      <path d="M30 4 C32 21 38 27 55 29 C38 31 32 37 30 56 C28 37 22 31 5 29 C22 27 28 21 30 4 Z" fill={c} {...stroke} />
      <path d="M51 42 C51.8 47 53 48.2 58 49 C53 49.8 51.8 51 51 56 C50.2 51 49 49.8 44 49 C49 48.2 50.2 47 51 42 Z" fill="#fff" stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
    </>
  ),
};

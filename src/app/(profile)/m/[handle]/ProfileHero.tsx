"use client";

import { useState, type CSSProperties } from "react";
import FlairEffect from "@/components/flair/FlairEffect";
import { FLAIR_EFFECTS, flairHex, parseFlair, rgbTriplet, type FlairKeys } from "@/lib/flair";

// The top of a shared profile: a little movie screen with their photo,
// display name and profile line, lit in their color. Their check-in
// entrance plays across it once, gently (and again from the button).
export default function ProfileHero({
  displayName,
  line,
  photo,
  initial,
  memberSince,
  flair: keys,
}: {
  displayName: string;
  line: string | null;
  photo: string | null;
  initial: string;
  memberSince: string;
  flair: FlairKeys;
}) {
  const flair = parseFlair(keys);
  const hex = flairHex(flair);
  const [run, setRun] = useState(1);
  const [playing, setPlaying] = useState(flair.effect !== "classic");
  const effect = FLAIR_EFFECTS.find((e) => e.key === flair.effect);
  const perfs = { backgroundImage: "repeating-linear-gradient(90deg, #f3ecd9 0 10px, transparent 10px 20px)" };

  return (
    <section
      className="relative overflow-hidden rounded-[6px] border-2 border-[var(--foreground)] bg-[#14110c] text-[#f3ecd9] shadow-[4px_4px_0_var(--foreground)]"
      style={{ "--c": hex, "--rgb": rgbTriplet(hex) } as CSSProperties}
      aria-label={`${displayName}'s profile`}
    >
      <div aria-hidden="true" className="mx-3 mt-2 h-2 rounded-[1px] opacity-60" style={perfs} />
      <div
        className="relative px-5 pt-7 pb-8 text-center sm:px-10 sm:pt-9 sm:pb-10"
        style={{ background: "radial-gradient(ellipse at 50% 38%, rgba(var(--rgb), 0.28), transparent 62%)" }}
      >
        <div className="relative z-[2] flex flex-col items-center">
          <div className="rounded-full p-1" style={{ background: hex, boxShadow: "0 0 0 3px #14110c, 0 0 32px rgba(var(--rgb), 0.55)" }}>
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- served by this page's own photo route, already sized
              <img src={photo} alt={`${displayName}'s photo`} width={132} height={132} className="block size-28 rounded-full border-[3px] border-[#14110c] object-cover sm:size-[132px]" />
            ) : (
              <div className="font-display grid size-28 place-items-center rounded-full border-[3px] border-[#14110c] bg-[#1f1a13] text-5xl sm:size-[132px]" style={{ color: hex }} aria-hidden="true">
                {initial}
              </div>
            )}
          </div>
          <span className="page-eyebrow mt-5" style={{ background: hex }}>
            Royale Insider
          </span>
          <h1 className="font-display mt-3 max-w-full text-4xl leading-[0.98] break-words text-balance sm:text-6xl">{displayName}</h1>
          {line && (
            <p className="mt-4 max-w-md text-lg leading-snug text-balance italic sm:text-xl">
              <span className="font-display not-italic" style={{ color: hex }} aria-hidden="true">
                “
              </span>
              {line}
              <span className="font-display not-italic" style={{ color: hex }} aria-hidden="true">
                ”
              </span>
            </p>
          )}
          {memberSince && <p className="mt-4 font-mono text-[11px] font-bold tracking-[0.1em] text-[#b9ae96] uppercase">Member since {memberSince}</p>}
          {flair.effect !== "classic" && (
            <button
              type="button"
              className="mt-4 rounded-[4px] border-2 border-[#f3ecd9]/40 px-2.5 py-1 font-mono text-[10.5px] font-bold tracking-[0.08em] text-[#f3ecd9] uppercase transition-colors hover:border-[var(--c)] hover:text-[var(--c)] disabled:opacity-40"
              onClick={() => {
                setRun((r) => r + 1);
                setPlaying(true);
              }}
              disabled={playing}
              title={effect ? `${effect.label}: their check-in entrance` : undefined}
            >
              ▶ {effect?.label ?? "Play"}
            </button>
          )}
        </div>
        {playing && <FlairEffect key={run} entrance={flair.effect} color={hex} sticker={flair.sticker} mode="gentle" seed={run} onDone={() => setPlaying(false)} />}
      </div>
      <div aria-hidden="true" className="mx-3 mb-2 h-2 rounded-[1px] opacity-60" style={perfs} />
    </section>
  );
}

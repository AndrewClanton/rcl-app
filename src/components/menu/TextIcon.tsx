import type { CSSProperties, ReactNode } from "react";
import { DOLLAR_RAISE, DOLLAR_SCALE, fitIconText, raisesDollar, TEXT_ICON_COLORS, TEXT_ICON_DARK, type TextIcon as Icon } from "@/lib/menu-pictures/text-icon";

// A text icon on a register button: a few big characters ("$5") in Neon,
// Block or Outline, drawn right here (no picture file), so it's crisp at any
// size and shows instantly. Fills whatever square box it's put in: the text
// is sized to the box (container units), so the same icon works on the
// register's buttons, the item settings and a 56px thumbnail.
//
// Neon: light letters with a glow of their color on a near-black tile; its
// optional slow pulse fades only the outer glow's opacity (no redrawing),
// and stays still for anyone who asked their device for less motion.
// Flat colors, no gradients, like the rest of the brand.

function shadows(glow: string, core: string) {
  return {
    inner: `0 0 0.02em ${core}, 0 0 0.07em ${glow}, 0 0 0.16em ${glow}`,
    outer: `0 0 0.36em ${glow}, 0 0 0.8em color-mix(in srgb, ${glow} 55%, transparent)`,
  };
}

function Lines({ lines }: { lines: string[] }) {
  return lines.map((line, i) => (
    <span key={i} className="block whitespace-nowrap">
      {raisesDollar(line) ? (
        <>
          {/* A price-sign "$": small, its top level with the number's. */}
          <span className="relative" style={{ fontSize: `${DOLLAR_SCALE}em`, top: `-${DOLLAR_RAISE}em` }}>
            $
          </span>
          {line.slice(1)}
        </>
      ) : (
        line
      )}
    </span>
  ));
}

export default function TextIcon({
  icon,
  still = false,
  className = "",
}: {
  icon: Icon;
  still?: boolean; // no pulse (the button is OUT, or it's a small preview)
  className?: string;
}) {
  const c = TEXT_ICON_COLORS[icon.color] ?? TEXT_ICON_COLORS.red;
  const { lines, size } = fitIconText(icon.text);
  const type: CSSProperties = { fontSize: `${(size * 100).toFixed(1)}cqw`, lineHeight: lines.length > 1 ? 0.95 : 1 };
  const text: ReactNode = <Lines lines={lines} />;
  const face = "font-display flex flex-col items-center text-center";

  if (icon.style === "block") {
    return (
      <span
        className={`@container flex h-full w-full items-center justify-center overflow-hidden ${className}`}
        // A hairline inside, so a white or gold tile still has an edge.
        style={{ background: c.bg, color: c.ink, boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.12)" }}
        aria-hidden
      >
        <span className={face} style={type}>
          {text}
        </span>
      </span>
    );
  }

  if (icon.style === "outline") {
    return (
      <span className={`@container flex h-full w-full items-center justify-center overflow-hidden ${className}`} style={{ background: TEXT_ICON_DARK }} aria-hidden>
        <span className={face} style={{ ...type, color: "transparent", WebkitTextStroke: `0.035em ${c.glow}` }}>
          {text}
        </span>
      </span>
    );
  }

  const glow = shadows(c.glow, c.core);
  const breathe = !!icon.pulse && !still;
  return (
    <span className={`@container relative flex h-full w-full items-center justify-center overflow-hidden ${className}`} style={{ background: TEXT_ICON_DARK }} aria-hidden>
      {breathe && (
        // The outer glow on its own, fading in and out; the letters and
        // their near glow stay put on top.
        <span className={`${face} absolute inset-0 justify-center motion-safe:animate-neon-breathe`} style={{ ...type, color: "transparent", textShadow: glow.outer }}>
          {text}
        </span>
      )}
      <span className={`${face} relative`} style={{ ...type, color: c.core, textShadow: breathe ? glow.inner : `${glow.inner}, ${glow.outer}` }}>
        {text}
      </span>
    </span>
  );
}

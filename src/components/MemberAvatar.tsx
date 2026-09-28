import Image from "next/image";

// A member's photo, or their initial on a color picked from their name (so
// faces without photos are still easy to tell apart at the register).
const SWATCHES = [
  { bg: "#14110c", fg: "#ffc72c" },
  { bg: "#ed1c24", fg: "#ffffff" },
  { bg: "#ffc72c", fg: "#14110c" },
  { bg: "#1f6b3a", fg: "#ffffff" },
  { bg: "#3d5a80", fg: "#ffffff" },
  { bg: "#8a5a0a", fg: "#ffffff" },
];

function swatch(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SWATCHES[h % SWATCHES.length];
}

// `plus`: an Insiders+ member gets a gold ring and the Insiders+ mark -- a
// ribbon under a big photo, a gold "+" seal on a small one.
export default function MemberAvatar({
  name,
  url,
  size = 48,
  className = "",
  plus = false,
}: {
  name: string;
  url: string | null;
  size?: number;
  className?: string;
  plus?: boolean;
}) {
  const s = swatch(name || "?");
  const ring = Math.max(2, Math.round(size / 22));
  const face = (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full ${plus ? "" : className}`}
      style={{
        width: size,
        height: size,
        background: url ? "var(--surface-hover)" : s.bg,
        boxShadow: plus ? `0 0 0 ${ring}px var(--gold), 0 0 0 ${ring + 1.5}px var(--foreground)` : undefined,
      }}
    >
      {url ? (
        <Image src={url} alt={name} fill sizes={`${size * 2}px`} className="object-cover" />
      ) : (
        <div className="font-display flex h-full w-full items-center justify-center" style={{ color: s.fg, fontSize: size * 0.42 }} aria-label={name}>
          {(name.trim()[0] ?? "?").toUpperCase()}
        </div>
      )}
    </div>
  );
  if (!plus) return face;

  const seal = Math.max(14, Math.round(size * 0.34));
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }} title="Insiders+ member">
      {face}
      {size >= 64 ? (
        <span
          className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border-2 border-[var(--foreground)] bg-[var(--gold)] px-2 font-black uppercase tracking-wider text-[var(--gold-foreground)]"
          style={{ bottom: -ring - 8, fontSize: Math.max(9, Math.round(size / 8.5)), lineHeight: 1.5 }}
        >
          Insiders+
        </span>
      ) : (
        <span
          className="absolute flex items-center justify-center rounded-full border-2 border-[var(--foreground)] bg-[var(--gold)] font-black text-[var(--gold-foreground)]"
          style={{ width: seal, height: seal, right: -ring - 2, bottom: -ring - 2, fontSize: seal * 0.7, lineHeight: 1 }}
          aria-label="Insiders+"
        >
          +
        </span>
      )}
    </div>
  );
}

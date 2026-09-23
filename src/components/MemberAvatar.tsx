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

export default function MemberAvatar({ name, url, size = 48, className = "" }: { name: string; url: string | null; size?: number; className?: string }) {
  const s = swatch(name || "?");
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full ${className}`}
      style={{ width: size, height: size, background: url ? "var(--surface-hover)" : s.bg }}
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
}

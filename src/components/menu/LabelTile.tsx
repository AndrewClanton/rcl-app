import { labelTone } from "@/lib/menu-pictures/shared";

// What a register button shows when it has no photo (or its photo won't
// load): the item's name set in bold on its category's color, like a
// printed product label. Fills whatever box it's put in (square on the
// register). Shared by the register, its item settings and Back office.
export default function LabelTile({
  name,
  category,
  parent,
  className = "",
  small = false,
}: {
  name: string;
  category?: string | null;
  parent?: string | null;
  className?: string;
  small?: boolean; // a thumbnail: less border, smaller type
}) {
  const tone = labelTone(category, parent);
  // Longer names get smaller type so they still fit in three lines or so.
  const len = name.length;
  const size = small ? (len > 18 ? "text-[9px]" : "text-[11px]") : len > 26 ? "text-base" : len > 16 ? "text-lg" : len > 9 ? "text-xl" : "text-2xl";
  return (
    <span
      className={`flex h-full w-full items-center justify-center overflow-hidden ${small ? "p-1" : "p-2.5"} ${className}`}
      style={{ background: tone.bg, color: tone.fg }}
      aria-hidden
    >
      <span
        className={`flex h-full w-full flex-col items-center justify-center rounded-[3px] text-center ${small ? "border px-0.5" : "border-2 px-1.5"}`}
        style={{ borderColor: `color-mix(in srgb, ${tone.fg} 55%, transparent)` }}
      >
        <span className={`font-display uppercase leading-[1.05] tracking-wide [overflow-wrap:anywhere] ${size}`}>{name}</span>
        {!small && (category || parent) && (
          <span className="mt-1.5 text-[9px] font-bold uppercase tracking-[0.18em] opacity-75">{category || parent}</span>
        )}
      </span>
    </span>
  );
}

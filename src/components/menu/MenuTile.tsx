"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import type { HoldHandlers } from "@/app/pos/item-settings/press-hold";
import type { RegisterOut } from "@/lib/ops/shared";

// A register menu button, greyed with an OUT tag and the reason while it's
// 86'd. With a picture, it fills the top of the button and the name and
// price sit under it; without one (or when it won't load) `art` (its text
// icon or label tile) takes the photo's place, else it's name and price
// only. `hold` is the press-and-hold for its settings (pos/item-settings/).
// Here, not with the register, so the text icon designer can show the real
// button.
export default function MenuTile({
  name,
  price,
  imageUrl,
  art,
  hold,
  out,
  onClick,
}: {
  name: string;
  price: string;
  imageUrl?: string | null;
  art?: ReactNode; // in the photo's place when there's none (text icon or label tile)
  hold?: HoldHandlers; // press and hold: the item's settings
  out: RegisterOut | null;
  onClick: () => void;
}) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const photo = imageUrl && imageUrl !== brokenUrl ? imageUrl : null;
  if (photo || art) {
    return (
      <button
        className="card-flat relative flex flex-col items-stretch gap-1.5 !p-1.5 !pb-2 text-center"
        style={out ? { background: "var(--surface-hover)", borderStyle: "dashed" } : undefined}
        onClick={onClick}
        {...hold}
        aria-label={out ? `${name}, ${out.reason}` : undefined}
      >
        <span className="relative block aspect-square w-full overflow-hidden rounded-md" style={{ background: "var(--surface-hover)" }}>
          {photo ? (
            <Image
              src={photo}
              alt=""
              fill
              sizes="(min-width: 1280px) 260px, (min-width: 768px) 180px, 50vw"
              quality={85}
              className="object-cover"
              // Greyed right down while it's out, so it doesn't read as for sale.
              style={out ? { filter: "grayscale(1)", opacity: 0.35 } : undefined}
              onError={() => setBrokenUrl(photo)}
            />
          ) : (
            <span className="absolute inset-0" style={out ? { filter: "grayscale(1)", opacity: 0.35 } : undefined}>
              {art}
            </span>
          )}
          {out && (
            <span className="absolute left-1.5 top-1.5 rounded px-2 py-1 text-xs font-black leading-none tracking-wider" style={{ background: "var(--foreground)", color: "var(--background)" }}>
              OUT
            </span>
          )}
        </span>
        <span className="flex flex-1 flex-col items-center justify-center gap-0.5 px-1">
          <span className="text-base font-medium leading-snug" style={{ color: out ? "var(--muted)" : "var(--foreground)" }}>
            {name}
          </span>
          {out ? (
            <span className="text-xs font-bold leading-tight" style={{ color: "var(--danger-text)" }}>
              {out.reason}
            </span>
          ) : (
            <span className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
              {price}
            </span>
          )}
        </span>
      </button>
    );
  }
  return (
    <button
      className="card-flat relative flex min-h-[84px] flex-col items-center justify-center gap-1 p-3 text-center"
      style={out ? { background: "var(--surface-hover)", borderStyle: "dashed" } : undefined}
      onClick={onClick}
      aria-label={out ? `${name}, ${out.reason}` : undefined}
    >
      {out && (
        <span className="absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-black leading-none tracking-wider" style={{ background: "var(--foreground)", color: "var(--background)" }}>
          OUT
        </span>
      )}
      <span className="text-base font-medium leading-snug" style={{ color: out ? "var(--muted)" : "var(--foreground)" }}>
        {name}
      </span>
      {out ? (
        <span className="text-xs font-bold leading-tight" style={{ color: "var(--danger-text)" }}>
          {out.reason}
        </span>
      ) : (
        <span className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
          {price}
        </span>
      )}
    </button>
  );
}

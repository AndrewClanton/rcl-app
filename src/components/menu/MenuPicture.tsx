"use client";

import { useState } from "react";
import Image from "next/image";
import LabelTile from "./LabelTile";

// A menu item's or category's picture in a square box: its photo, or its
// label tile when there's none or the photo won't load. The box's size
// comes from the parent (give it a width and aspect-square, or a size).
export default function MenuPicture({
  url,
  name,
  category,
  parent,
  sizes,
  small = false,
  className = "",
}: {
  url: string | null | undefined;
  name: string;
  category?: string | null;
  parent?: string | null;
  sizes: string;
  small?: boolean;
  className?: string;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const photo = url && url !== broken ? url : null;
  return (
    <span className={`relative block overflow-hidden ${className}`} style={{ background: "var(--surface-hover)" }}>
      {photo ? (
        <Image src={photo} alt={`${name} photo`} fill sizes={sizes} className="object-cover" onError={() => setBroken(photo)} />
      ) : (
        <span className="absolute inset-0">
          <LabelTile name={name} category={category} parent={parent} small={small} />
        </span>
      )}
    </span>
  );
}

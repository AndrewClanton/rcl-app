"use client";

import { useState } from "react";
import Image from "next/image";
import LabelTile from "./LabelTile";
import TextIcon from "./TextIcon";
import { textIconShown, type PictureState, type TextIcon as Icon } from "@/lib/menu-pictures/shared";

// A menu item's or category's picture in a square box: its photo, else its
// text icon, else its label tile (also when the photo won't load). The
// box's size comes from the parent (give it a width and aspect-square, or a
// size).
export default function MenuPicture({
  url,
  text,
  name,
  category,
  parent,
  sizes,
  small = false,
  className = "",
}: {
  url: string | null | undefined;
  text?: Icon | null; // its text icon, when that's what it shows
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
        <Image src={photo} alt={`${name} photo`} fill sizes={sizes} quality={85} className="object-cover" onError={() => setBroken(photo)} />
      ) : (
        <span className="absolute inset-0">
          {text ? <TextIcon icon={text} still={small} /> : <LabelTile name={name} category={category} parent={parent} small={small} />}
        </span>
      )}
    </span>
  );
}

// What a register button shows in its photo's place when it has none: its
// text icon if it has one, else its label tile. `still`: no pulse (the
// button is OUT).
export function ItemArt({
  name,
  category,
  parent,
  picture,
  still = false,
}: {
  name: string;
  category?: string | null;
  parent?: string | null;
  picture: Pick<PictureState, "image_url" | "image_source" | "image_text">;
  still?: boolean;
}) {
  const icon = textIconShown(picture);
  return icon ? <TextIcon icon={icon} still={still} /> : <LabelTile name={name} category={category} parent={parent} />;
}

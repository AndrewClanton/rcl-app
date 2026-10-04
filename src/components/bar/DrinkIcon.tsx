"use client";

import { useId, useMemo } from "react";
import { drinkIconSvg, type IconSpec } from "@/lib/bar/icons";

// A drink's icon (src/lib/bar/icons.ts): its glass, its ingredients' colors,
// ice and garnish. The glass outline is currentColor, so it follows the
// text color around it; the drink's colors are the fixed legend. The SVG
// string escapes everything it holds.
export default function DrinkIcon({
  spec,
  size = 56,
  label,
  className,
}: {
  spec: IconSpec;
  size?: number;
  label?: string | null; // spoken name; leave it off when the name is shown beside it
  className?: string;
}) {
  // Each icon its own clip path id, so two of the same drink on one screen
  // (or one inside a closed panel) never borrow each other's.
  const id = useId();
  const html = useMemo(() => drinkIconSvg(spec, { size, id, label }), [spec, size, id, label]);
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className ?? ""}`}
      style={{ width: size, height: size, lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

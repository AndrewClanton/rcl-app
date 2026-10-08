import type { CSSProperties, ReactNode } from "react";
import { perkOption, titleLabel } from "@/lib/rewards";
import c from "./cardlook.module.css";

// The card perks bought with points (lib/rewards.ts): a frame around the
// member's card, a color for their name, and a title under it. Keys only,
// each looked up here; an unknown key draws nothing extra. Used by the
// customer screen's member card and Spend points preview, and the account's
// Profile tab.

export function CardFrame({ frame, color, children, className }: { frame: string | null | undefined; color: string; children: ReactNode; className?: string }) {
  const key = perkOption("frame", frame)?.key ?? null;
  if (!key) return <>{children}</>;
  return (
    <div className={`${c.frame} ${c[`f_${key}`] ?? ""} ${className ?? ""}`} style={{ "--c": color } as CSSProperties}>
      {key === "marquee" && <span className={c.bulbs} aria-hidden="true" />}
      {children}
    </div>
  );
}

export function NameLine({ name, nameColor, title, as: Tag = "div", className }: { name: string; nameColor: string | null | undefined; title: string | null | undefined; as?: "div" | "h2"; className?: string }) {
  const color = perkOption("name_color", nameColor)?.key ?? null;
  const t = titleLabel(title);
  return (
    <Tag className={className}>
      <span className={color ? `${c.name} ${c[`n_${color}`] ?? ""}` : undefined}>{name}</span>
      {t && <span className={c.title}>{t}</span>}
    </Tag>
  );
}

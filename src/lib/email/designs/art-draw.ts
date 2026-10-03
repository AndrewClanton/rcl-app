import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement as h, type ReactElement } from "react";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { ArtVariant, TabletSpec, TapeSpec } from "./types";

// Draws one of the ready-made emails' pictures with a first name in it
// (api/email/art): the base picture made from the canvas design, with the
// words set on it in the design's font (Archivo Black), where the design
// has them. The words are drawn by Satori (next/og) on a clear layer and
// laid over the base with sharp.

const ART_DIR = join(process.cwd(), "src/lib/email/designs/art");
const FONT = join(process.cwd(), "src/app/admin/schedule-graphic/fonts/ArchivoBlack-Regular.ttf");
const S = 2; // the pictures are 2x

let font: Promise<Buffer> | null = null;
const loadFont = () => (font ??= readFile(FONT));

function tablet(s: TabletSpec, name: string): ReactElement {
  const lines = s.lines.map((l) => l.replace("{name}", name));
  const inner = (s.screen.w - 2 * s.pad) * S;
  const svg = s.icon.replace(/width="\d+"/, `width="${s.iconSize * S}"`).replace(/height="\d+"/, `height="${s.iconSize * S}"`);
  const icon = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  return h(
    "div",
    {
      style: {
        position: "absolute",
        left: s.screen.x * S,
        top: s.screen.y * S,
        width: s.screen.w * S,
        height: s.screen.h * S,
        padding: s.pad * S,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      },
    },
    h("img", { src: icon, width: s.iconSize * S, height: s.iconSize * S, alt: "" }),
    h(
      "div",
      { style: { marginTop: s.gap1 * S, display: "flex", flexDirection: "column", alignItems: "center", maxWidth: inner } },
      ...lines.map((l, i) =>
        h("div", { key: i, style: { fontFamily: "Archivo Black", fontSize: s.font.size * S, lineHeight: `${s.font.lh * S}px`, color: s.font.color, textAlign: "center", maxWidth: inner } }, l),
      ),
    ),
    h("div", { style: { marginTop: s.gap2 * S, width: s.bar.w * S, height: s.bar.h * S, borderRadius: s.bar.h, backgroundColor: s.bar.color } }),
  );
}

function tape(s: TapeSpec, name: string): ReactElement {
  const upper = name.toUpperCase();
  // Archivo Black capitals run about 0.74em wide: a long name gets smaller
  // so it stays on the label.
  const fit = s.text.w / Math.max(1, upper.length * 0.74);
  const size = Math.max(s.font.size * 0.55, Math.min(s.font.size, fit));
  return h(
    "div",
    { style: { position: "absolute", left: s.tape.x * S, top: s.tape.y * S, width: s.tape.w * S, height: s.tape.h * S, display: "flex", transform: `rotate(${s.angle}deg)` } },
    h(
      "div",
      {
        style: {
          position: "absolute",
          left: s.text.x * S,
          top: (s.text.y + (s.font.size - size) / 2) * S,
          width: s.text.w * S,
          display: "flex",
          fontFamily: "Archivo Black",
          fontSize: size * S,
          lineHeight: `${s.font.lh * S}px`,
          color: s.font.color,
          whiteSpace: "nowrap",
        },
      },
      upper,
    ),
  );
}

export async function drawArt(v: ArtVariant, name: string): Promise<Buffer> {
  const w = v.w * S;
  const h2 = v.h * S;
  const words = new ImageResponse(h("div", { style: { width: w, height: h2, display: "flex", position: "relative" } }, v.spec.kind === "tablet" ? tablet(v.spec, name) : tape(v.spec, name)), {
    width: w,
    height: h2,
    fonts: [{ name: "Archivo Black", data: await loadFont(), weight: 400, style: "normal" }],
  });
  const overlay = Buffer.from(await words.arrayBuffer());
  const out = sharp(await readFile(join(ART_DIR, v.base))).composite([{ input: overlay }]);
  return v.ext === "jpg" ? out.jpeg({ quality: 80, mozjpeg: true, progressive: true }).toBuffer() : out.png({ palette: true, quality: 92, effort: 7, dither: 1 }).toBuffer();
}

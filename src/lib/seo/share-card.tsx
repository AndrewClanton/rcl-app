import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The link-preview cards (1200x630, the size Facebook, iMessage, Slack and
// X all crop to): the site-wide one (app/opengraph-image.tsx) and one per
// showtime with its poster and time (showtimes/[id]/opengraph-image.tsx).
// Drawn with next/og like the schedule graphic, in the Proof Sheet look: an
// ink ground, a row of film sprockets top and bottom, Archivo Black heads,
// Space Mono technical lines, gold and red.

export const SHARE_SIZE = { width: 1200, height: 630 };

const INK = "#14110c";
const CREAM = "#f8f5ec";
const GOLD = "#ffc72c";
const RED = "#ed1c24";
const DISPLAY = "Archivo Black";
const MONO = "Space Mono";

// The same font files and wordmark the schedule graphic uses (and the same
// process.cwd()-relative reads, so Vercel's file tracing bundles them; see
// outputFileTracingIncludes in next.config.ts).
const ASSETS_DIR = join(process.cwd(), "src/app/admin/schedule-graphic");
let assets: Promise<{ fonts: { name: string; data: Buffer; weight: 400 | 700; style: "normal" }[]; logo: string }> | null = null;

export function loadShareAssets() {
  assets ??= Promise.all([
    readFile(join(ASSETS_DIR, "fonts/ArchivoBlack-Regular.ttf")),
    readFile(join(ASSETS_DIR, "fonts/SpaceMono-Bold.ttf")),
    readFile(join(ASSETS_DIR, "assets/logo.png")),
  ]).then(([black, mono, logo]) => ({
    fonts: [
      { name: DISPLAY, data: black, weight: 400, style: "normal" },
      { name: MONO, data: mono, weight: 700, style: "normal" },
    ],
    logo: `data:image/png;base64,${logo.toString("base64")}`,
  }));
  return assets;
}

// A file under public/ as a data URL, for the build-time card.
export async function publicImage(path: string, type: "image/jpeg" | "image/png"): Promise<string> {
  const buf = await readFile(join(process.cwd(), "public", path));
  return `data:${type};base64,${buf.toString("base64")}`;
}

// A poster from its URL as a data URL, or null. Only JPEG/PNG (what the card
// renderer can draw), a few seconds at most: a slow or missing poster just
// means a card without one, never a broken preview.
export async function fetchPoster(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const type = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (!res.ok || !["image/jpeg", "image/png"].includes(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 4_000_000) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function Sprockets() {
  return (
    <div style={{ display: "flex", width: "100%", height: 34, background: INK, alignItems: "center", justifyContent: "space-between", padding: "0 18px" }}>
      {Array.from({ length: 40 }, (_, i) => (
        <div key={i} style={{ width: 16, height: 12, borderRadius: 2, background: CREAM, opacity: 0.85 }} />
      ))}
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: INK, color: CREAM, fontFamily: MONO }}>
      <Sprockets />
      <div style={{ display: "flex", flex: 1, padding: "34px 64px", borderTop: `4px solid ${GOLD}`, borderBottom: `4px solid ${GOLD}` }}>{children}</div>
      <Sprockets />
    </div>
  );
}

function Tag({ children, color = GOLD }: { children: React.ReactNode; color?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignSelf: "flex-start",
        background: color,
        color: color === GOLD ? INK : "#fff",
        border: `4px solid ${CREAM}`,
        borderRadius: 4,
        padding: "8px 16px",
        fontFamily: DISPLAY,
        fontSize: 22,
        letterSpacing: 1,
        textTransform: "uppercase",
        transform: "rotate(-3deg)",
      }}
    >
      {children}
    </div>
  );
}

// The site-wide card: wordmark, what we are, where we are, and a photo.
export function BrandCard({ logo, photo }: { logo: string; photo: string | null }) {
  return (
    <Frame>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, paddingRight: photo ? 48 : 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws plain <img> */}
        <img src={logo} width={560} height={197} style={{ width: 560, height: 197 }} alt="" />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Tag>Joplin, MO · on Route 66</Tag>
          <div style={{ display: "flex", marginTop: 26, fontFamily: DISPLAY, fontSize: 52, lineHeight: 1.02, color: CREAM }}>Dine-in cinema, bar &amp; members&apos; lounge</div>
        </div>
        <div style={{ display: "flex", fontSize: 24, letterSpacing: 2, color: GOLD }}>715 E BROADWAY · JOPLIN, MO 64801</div>
      </div>
      {photo && (
        <div style={{ display: "flex", width: 360, height: 482, border: `6px solid ${GOLD}`, borderRadius: 6, boxShadow: `12px 12px 0 ${RED}`, overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws plain <img> */}
          <img src={photo} width={348} height={470} style={{ width: 348, height: 470, objectFit: "cover" }} alt="" />
        </div>
      )}
    </Frame>
  );
}

// One showtime: the poster, the film, the day and time, the place.
export function ShowtimeCard({ logo, poster, title, when }: { logo: string; poster: string | null; title: string; when: string }) {
  const shown = title.length > 64 ? `${title.slice(0, 62).trimEnd()}…` : title;
  const size = shown.length <= 16 ? 84 : shown.length <= 30 ? 68 : 52;
  return (
    <Frame>
      {poster && (
        <div style={{ display: "flex", width: 324, height: 486, marginRight: 56, border: `5px solid ${CREAM}`, borderRadius: 6, boxShadow: `12px 12px 0 ${GOLD}`, overflow: "hidden", flexShrink: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws plain <img> */}
          <img src={poster} width={314} height={476} style={{ width: 314, height: 476, objectFit: "cover" }} alt="" />
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Tag color={RED}>Now showing</Tag>
          <div style={{ display: "flex", marginTop: 30, fontFamily: DISPLAY, fontSize: size, lineHeight: 1.02, color: CREAM }}>{shown}</div>
          <div style={{ display: "flex", marginTop: 26, fontSize: 34, letterSpacing: 1, color: GOLD }}>{when.toUpperCase()}</div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 21, letterSpacing: 2, color: CREAM, opacity: 0.8 }}>715 E BROADWAY · JOPLIN, MO</div>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws plain <img> */}
          <img src={logo} width={250} height={88} style={{ width: 250, height: 88 }} alt="" />
        </div>
      </div>
    </Frame>
  );
}

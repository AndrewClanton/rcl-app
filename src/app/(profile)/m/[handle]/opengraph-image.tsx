import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getProfilePhoto, getPublicProfile } from "@/lib/member-profile-server";
import { DEFAULT_FLAIR_COLOR, flairColor, rgbTriplet } from "@/lib/flair";

// The link preview for a shared profile (what shows when it's pasted into a
// text or a post): their display name, photo, and counts. No film titles
// at all (so nothing our MPLC license keeps off public pages), and no
// emoji, since drawing one would fetch it from another site.
export const alt = "A Royale Cinema Lounge member's profile";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

const INK = "#14110c";
const CREAM = "#f3ecd9";
const GOLD = "#ffc72c";

// The flyer's fonts (admin/schedule-graphic), read once. Without them the
// preview still draws, in the default font.
const FONT_DIR = join(process.cwd(), "src/app/admin/schedule-graphic/fonts");
const fontsPromise = Promise.all([readFile(join(FONT_DIR, "ArchivoBlack-Regular.ttf")), readFile(join(FONT_DIR, "SpaceMono-Bold.ttf"))])
  .then(([display, mono]) => [
    { name: "Archivo Black", data: display, weight: 400 as const, style: "normal" as const },
    { name: "Space Mono", data: mono, weight: 700 as const, style: "normal" as const },
  ])
  .catch(() => undefined);

// Letters the fonts have (Latin, with accents); anything else (emoji,
// other scripts) would be fetched from elsewhere to draw, so it's left out.
function drawable(name: string): string {
  const t = name
    .replace(/[^ -ſ‘-”–—]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t || "A Royale Insider";
}

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const p = await getPublicProfile(handle);
  if (!p) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const [fonts, photo] = await Promise.all([fontsPromise, p.photo ? getProfilePhoto(handle, 320).catch(() => null) : Promise.resolve(null)]);
  const hex = (flairColor(p.flair.color) ?? DEFAULT_FLAIR_COLOR).hex;
  const name = drawable(p.displayName);
  const nameSize = name.length <= 10 ? 104 : name.length <= 16 ? 84 : name.length <= 24 ? 66 : 52;
  const display = fonts ? "Archivo Black" : undefined;
  const mono = fonts ? "Space Mono" : undefined;
  const stats = [
    `${p.badges.length} ${p.badges.length === 1 ? "badge" : "badges"}`,
    `${p.visits} ${p.visits === 1 ? "visit" : "visits"}`,
    ...(p.weekStreak > 1 ? [`${p.weekStreak} weeks in a row`] : []),
    `${p.movies.total} ${p.movies.total === 1 ? "movie" : "movies"}`,
  ];
  const perfs = Array.from({ length: 34 }, (_, i) => i);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: INK, color: CREAM }}>
        <div style={{ display: "flex", gap: 14, padding: "16px 20px 0" }}>
          {perfs.map((i) => (
            <div key={i} style={{ width: 20, height: 12, borderRadius: 3, background: CREAM, opacity: 0.55 }} />
          ))}
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 56,
            padding: "0 72px",
            backgroundImage: `radial-gradient(circle at 24% 50%, rgba(${rgbTriplet(hex)}, 0.33) 0%, rgba(20, 17, 12, 0) 55%)`,
          }}
        >
          <div style={{ display: "flex", padding: 10, borderRadius: 999, background: hex, boxShadow: `0 0 0 6px ${INK}` }}>
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- drawn into a PNG by next/og, not a page
              <img src={`data:image/jpeg;base64,${photo.toString("base64")}`} width={300} height={300} style={{ borderRadius: 999, border: `6px solid ${INK}` }} alt="" />
            ) : (
              <div
                style={{
                  width: 300,
                  height: 300,
                  borderRadius: 999,
                  border: `6px solid ${INK}`,
                  background: "#1f1a13",
                  color: hex,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 150,
                  fontFamily: display,
                }}
              >
                {drawable(p.initial).slice(0, 1)}
              </div>
            )}
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ display: "flex", fontFamily: mono, fontSize: 24, letterSpacing: 3, color: GOLD, textTransform: "uppercase" }}>Royale Cinema Lounge · Joplin</div>
            <div style={{ display: "flex", marginTop: 14, fontFamily: display, fontSize: nameSize, lineHeight: 1, color: CREAM }}>{name}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 32 }}>
              {stats.map((s) => (
                <div
                  key={s}
                  style={{ display: "flex", padding: "8px 16px", borderRadius: 6, background: hex, color: INK, border: `3px solid ${CREAM}`, fontFamily: mono, fontSize: 26, textTransform: "uppercase" }}
                >
                  {s}
                </div>
              ))}
            </div>
            {p.memberSince ? <div style={{ display: "flex", marginTop: 28, fontFamily: mono, fontSize: 22, color: "#b9ae96", textTransform: "uppercase", letterSpacing: 2 }}>Royale Insider since {p.memberSince}</div> : null}
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, padding: "0 20px 16px" }}>
          {perfs.map((i) => (
            <div key={i} style={{ width: 20, height: 12, borderRadius: 3, background: CREAM, opacity: 0.55 }} />
          ))}
        </div>
      </div>
    ),
    { ...size, fonts, headers: { "Cache-Control": "public, max-age=300" } },
  );
}

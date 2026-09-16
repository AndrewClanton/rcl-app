import { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getStaffSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const CENTRAL_TZ = "America/Chicago";
const BG = "#0b0a0f";
const SURFACE = "#16131c";
const BORDER = "#2c2632";
const FOREGROUND = "#f4ede0";
const MUTED = "#a79b8c";
const ACCENT = "#d3a24a";
const ACCENT_FG = "#1a1206";

// Fonts don't depend on request data -- read once at module scope (Next's
// own recommendation for ImageResponse) rather than on every request.
const FONTS_DIR = join(process.cwd(), "src/app/admin/schedule-graphic/fonts");
const fontsPromise = Promise.all([
  readFile(join(FONTS_DIR, "PlayfairDisplay-Bold.ttf")),
  readFile(join(FONTS_DIR, "PlayfairDisplay-SemiBold.ttf")),
  readFile(join(FONTS_DIR, "Inter-Regular.ttf")),
  readFile(join(FONTS_DIR, "Inter-SemiBold.ttf")),
  readFile(join(FONTS_DIR, "Inter-ExtraBold.ttf")),
]).then(([playfairBold, playfairSemi, interReg, interSemi, interExtra]) => [
  { name: "Playfair Display", data: playfairBold, weight: 700 as const, style: "normal" as const },
  { name: "Playfair Display", data: playfairSemi, weight: 600 as const, style: "normal" as const },
  { name: "Inter", data: interReg, weight: 400 as const, style: "normal" as const },
  { name: "Inter", data: interSemi, weight: 600 as const, style: "normal" as const },
  { name: "Inter", data: interExtra, weight: 800 as const, style: "normal" as const },
]);

interface ScreeningRow {
  id: string;
  starts_at: string;
  movie: { title: string; poster_path: string | null } | null;
}

interface MovieGroup {
  title: string;
  posterUrl: string | null;
  showtimes: string[];
}

function groupByMovie(rows: ScreeningRow[]): MovieGroup[] {
  const byTitle = new Map<string, MovieGroup>();
  for (const r of rows) {
    if (!r.movie) continue;
    const label = new Date(r.starts_at)
      .toLocaleString("en-US", { timeZone: CENTRAL_TZ, weekday: "short", hour: "numeric", minute: "2-digit" })
      .toUpperCase();
    const existing = byTitle.get(r.movie.title);
    if (existing) {
      existing.showtimes.push(label);
    } else {
      byTitle.set(r.movie.title, {
        title: r.movie.title,
        posterUrl: r.movie.poster_path ? `https://image.tmdb.org/t/p/w342${r.movie.poster_path}` : null,
        showtimes: [label],
      });
    }
  }
  return [...byTitle.values()];
}

function PosterArt({ url, width, height }: { url: string | null; width: number; height: number }) {
  if (url) {
    return (
      <img
        src={url}
        width={width}
        height={height}
        style={{ width, height, borderRadius: 6, objectFit: "cover" }}
      />
    );
  }
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 6,
        backgroundColor: SURFACE,
        border: `1px solid ${BORDER}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Inter",
        fontSize: 10,
        fontWeight: 600,
        color: MUTED,
        textAlign: "center",
        padding: 4,
      }}
    >
      NO ARTWORK
    </div>
  );
}

function renderPoster(movies: MovieGroup[], rangeLabel: string) {
  return (
    <div
      style={{
        width: "1080px",
        height: "1350px",
        display: "flex",
        flexDirection: "column",
        backgroundColor: BG,
        fontFamily: "Inter",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "56px 60px 28px",
          borderBottom: `2px solid ${BORDER}`,
        }}
      >
        <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 800, fontSize: 20, letterSpacing: 4, color: ACCENT }}>
          ROYALE CINEMA LOUNGE
        </div>
        <div style={{ display: "flex", fontFamily: "Playfair Display", fontWeight: 700, fontSize: 54, color: FOREGROUND, marginTop: 12 }}>
          This Week&apos;s Films
        </div>
        <div style={{ display: "flex", fontFamily: "Inter", fontSize: 20, color: MUTED, marginTop: 8 }}>{rangeLabel}</div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "28px 56px", gap: "20px" }}>
        {movies.length === 0 ? (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", fontFamily: "Inter", fontSize: 22, color: MUTED }}>
            No screenings selected
          </div>
        ) : (
          movies.map((m) => (
            <div key={m.title} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "22px" }}>
              <PosterArt url={m.posterUrl} width={72} height={108} />
              <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                <div style={{ display: "flex", fontFamily: "Playfair Display", fontWeight: 600, fontSize: 28, color: FOREGROUND }}>
                  {m.title}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: 10 }}>
                  {m.showtimes.map((t, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        fontFamily: "Inter",
                        fontWeight: 600,
                        fontSize: 16,
                        color: ACCENT_FG,
                        backgroundColor: ACCENT,
                        padding: "6px 14px",
                        borderRadius: 100,
                      }}
                    >
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "20px 0 44px",
          borderTop: `2px solid ${BORDER}`,
        }}
      >
        <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 600, fontSize: 18, color: FOREGROUND }}>
          715 E Broadway, Joplin, MO
        </div>
        <div style={{ display: "flex", fontFamily: "Inter", fontSize: 15, color: MUTED, marginTop: 6 }}>
          417-281-4172 · royalecinemajoplin.com
        </div>
      </div>
    </div>
  );
}

function renderBanner(movies: MovieGroup[], rangeLabel: string) {
  return (
    <div
      style={{
        width: "1200px",
        height: "628px",
        display: "flex",
        flexDirection: "column",
        backgroundColor: BG,
        fontFamily: "Inter",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "space-between",
          padding: "30px 44px 18px",
          borderBottom: `2px solid ${BORDER}`,
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: "16px" }}>
          <div style={{ display: "flex", fontFamily: "Playfair Display", fontWeight: 700, fontSize: 34, color: FOREGROUND }}>
            Royale Cinema Lounge
          </div>
          <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 600, fontSize: 16, color: ACCENT }}>THIS WEEK</div>
        </div>
        <div style={{ display: "flex", fontFamily: "Inter", fontSize: 17, color: MUTED }}>{rangeLabel}</div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", padding: "22px 34px", gap: "16px" }}>
        {movies.length === 0 ? (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", fontFamily: "Inter", fontSize: 20, color: MUTED }}>
            No screenings selected
          </div>
        ) : (
          movies.slice(0, 10).map((m) => (
            <div key={m.title} style={{ display: "flex", flexDirection: "column", width: "196px" }}>
              <PosterArt url={m.posterUrl} width={196} height={98} />
              <div
                style={{
                  display: "flex",
                  fontFamily: "Playfair Display",
                  fontWeight: 600,
                  fontSize: 17,
                  color: FOREGROUND,
                  marginTop: 8,
                  lineHeight: 1.2,
                }}
              >
                {m.title}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginTop: 6 }}>
                {m.showtimes.slice(0, 4).map((t, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      fontFamily: "Inter",
                      fontWeight: 600,
                      fontSize: 11,
                      color: ACCENT_FG,
                      backgroundColor: ACCENT,
                      padding: "3px 8px",
                      borderRadius: 100,
                    }}
                  >
                    {t}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "center",
          padding: "14px 0 22px",
          borderTop: `2px solid ${BORDER}`,
          fontFamily: "Inter",
          fontSize: 14,
          color: MUTED,
        }}
      >
        715 E Broadway, Joplin, MO · 417-281-4172
      </div>
    </div>
  );
}

export async function GET(request: NextRequest) {
  const session = await getStaffSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = request.nextUrl;
  const format = searchParams.get("format") === "banner" ? "banner" : "poster";
  const rangeLabel = searchParams.get("label") ?? "";
  const ids = (searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let rows: ScreeningRow[] = [];
  if (ids.length > 0) {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("screenings")
      .select("id, starts_at, movie:movies(title, poster_path)")
      .in("id", ids)
      .order("starts_at");
    if (error) return new Response("Failed to load screenings", { status: 500 });
    rows = (data ?? []) as unknown as ScreeningRow[];
  }

  const movies = groupByMovie(rows);
  const fonts = await fontsPromise;

  return new ImageResponse(format === "banner" ? renderBanner(movies, rangeLabel) : renderPoster(movies, rangeLabel), {
    width: format === "banner" ? 1200 : 1080,
    height: format === "banner" ? 628 : 1350,
    fonts,
  });
}

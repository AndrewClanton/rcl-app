// Re-hosts every stored movie poster at a higher resolution (see
// src/lib/posters.ts for the sizes and why).
//
// We never recorded where each stored poster came from, and some were hand-
// picked in the admin poster picker -- so "just fetch the movie's main
// poster in high res" could silently swap in a different image. Instead,
// each stored file is matched byte-for-byte against the renditions we know
// we downloaded it from (OMDb's poster; TMDb's w500 from the original
// backfill; TMDb's w342 from the picker), and only an exact match is
// upgraded. Anything unmatched is left alone and reported.
//
// Idempotent: posters already >= 700px wide are skipped.
// Usage: node scripts/upgrade-poster-resolution.mjs [--dry]
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import sharp from "sharp";

config({ path: ".env.local", quiet: true });
const DRY = process.argv.includes("--dry");
const TMDB = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p";
const MAX_TMDB_POSTERS = 30;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const tmdbHeaders = { Authorization: `Bearer ${process.env.TMDB_API_KEY}` };

// Mirrors highResPosterUrl() in src/lib/posters.ts.
function highRes(url) {
  if (url.startsWith(TMDB_IMG)) return url.replace(/\/t\/p\/[^/]+\//, "/t/p/w780/");
  return url.replace(/\._V1_[^/]*\.(jpe?g|png)$/i, "._V1_SX1000.$1");
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "image/jpeg" };
}
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

async function candidates(movie) {
  const out = [];
  if (movie.imdb_id) {
    const omdb = await (await fetch(`https://www.omdbapi.com/?apikey=${process.env.OMDB_API_KEY}&i=${movie.imdb_id}`)).json();
    if (omdb.Poster && omdb.Poster !== "N/A") out.push(omdb.Poster);
  }
  let tmdbId = movie.tmdb_id;
  if (!tmdbId && movie.imdb_id) {
    const found = await (await fetch(`${TMDB}/find/${movie.imdb_id}?external_source=imdb_id`, { headers: tmdbHeaders })).json();
    tmdbId = found.movie_results?.[0]?.id ?? null;
  }
  if (tmdbId) {
    const [details, images] = await Promise.all([
      fetch(`${TMDB}/movie/${tmdbId}`, { headers: tmdbHeaders }).then((r) => r.json()),
      fetch(`${TMDB}/movie/${tmdbId}/images`, { headers: tmdbHeaders }).then((r) => r.json()),
    ]);
    const paths = [details.poster_path, ...(images.posters ?? []).map((p) => p.file_path)].filter(Boolean);
    for (const p of [...new Set(paths)].slice(0, MAX_TMDB_POSTERS)) out.push(`${TMDB_IMG}/w500${p}`, `${TMDB_IMG}/w342${p}`);
  }
  return out;
}

const { data: movies, error } = await supabase.from("movies").select("id, title, tmdb_id, imdb_id, poster_url").not("poster_url", "is", null).order("title");
if (error) throw error;

const summary = { upgraded: 0, skipped: 0, unmatched: [] };
for (const movie of movies) {
  const stored = await download(movie.poster_url);
  if (!stored) {
    summary.unmatched.push(`${movie.title} (stored file unreadable)`);
    continue;
  }
  const { width: oldW, height: oldH } = await sharp(stored.buf).metadata();
  if (oldW >= 700) {
    console.log(`skip   ${movie.title}: already ${oldW}x${oldH}`);
    summary.skipped++;
    continue;
  }

  const target = sha(stored.buf);
  let match = null;
  for (const url of await candidates(movie)) {
    const c = await download(url);
    if (c && sha(c.buf) === target) {
      match = url;
      break;
    }
  }
  if (!match) {
    console.log(`NO MATCH ${movie.title}: left as is (${oldW}x${oldH})`);
    summary.unmatched.push(movie.title);
    continue;
  }

  const hi = await download(highRes(match));
  const meta = hi && hi.type.startsWith("image/") ? await sharp(hi.buf).metadata() : null;
  if (!hi || !meta || meta.width <= oldW) {
    console.log(`NO HI-RES ${movie.title}: matched ${match} but no larger rendition (${meta ? meta.width : "fetch failed"})`);
    summary.unmatched.push(`${movie.title} (no larger rendition)`);
    continue;
  }

  console.log(`${DRY ? "would upgrade" : "upgrade"} ${movie.title}: ${oldW}x${oldH} -> ${meta.width}x${meta.height} (${(hi.buf.length / 1024).toFixed(0)} KB) via ${match.replace(/^https:\/\/[^/]+/, "")}`);
  if (DRY) continue;

  const ext = hi.type.includes("png") ? "png" : hi.type.includes("webp") ? "webp" : "jpg";
  const path = `${movie.id}-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from("movie-posters").upload(path, hi.buf, { contentType: hi.type, upsert: false });
  if (upErr) throw upErr;
  const { data: urlData } = supabase.storage.from("movie-posters").getPublicUrl(path);
  const { error: dbErr } = await supabase.from("movies").update({ poster_url: urlData.publicUrl }).eq("id", movie.id);
  if (dbErr) throw dbErr;
  summary.upgraded++;
}

console.log(`\n${DRY ? "DRY RUN -- " : ""}upgraded ${summary.upgraded}, already high-res ${summary.skipped}, unmatched ${summary.unmatched.length}${summary.unmatched.length ? ": " + summary.unmatched.join("; ") : ""}`);

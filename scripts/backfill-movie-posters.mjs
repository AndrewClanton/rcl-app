// One-off: for every existing movie row, download its poster from TMDb's
// image CDN one last time and re-host it in our own movie-posters Storage
// bucket, so the live site stops depending on a third party's server for
// posters that were already imported. Run once, after
// 20260922030000_movies_omdb_source.sql (which renames poster_path to
// poster_url without touching the values -- at this point poster_url still
// holds the old TMDb-relative paths, e.g. "/abc123.jpg").
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: movies, error } = await supabase.from("movies").select("id, title, poster_url").not("poster_url", "is", null);
if (error) throw error;

for (const movie of movies) {
  if (movie.poster_url.startsWith("http")) {
    console.log(`skip (already migrated): ${movie.title}`);
    continue;
  }
  const tmdbUrl = `https://image.tmdb.org/t/p/w500${movie.poster_url}`;
  const res = await fetch(tmdbUrl);
  if (!res.ok) {
    console.error(`FAILED to download poster for ${movie.title}: ${res.status}`);
    continue;
  }
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const buffer = Buffer.from(await res.arrayBuffer());
  const path = `${movie.id}.${ext}`;

  const { error: uploadErr } = await supabase.storage.from("movie-posters").upload(path, buffer, { contentType, upsert: true });
  if (uploadErr) {
    console.error(`FAILED to upload poster for ${movie.title}: ${uploadErr.message}`);
    continue;
  }
  const { data: urlData } = supabase.storage.from("movie-posters").getPublicUrl(path);

  const { error: updateErr } = await supabase.from("movies").update({ poster_url: urlData.publicUrl }).eq("id", movie.id);
  if (updateErr) {
    console.error(`FAILED to update DB row for ${movie.title}: ${updateErr.message}`);
    continue;
  }
  console.log(`migrated: ${movie.title}`);
}

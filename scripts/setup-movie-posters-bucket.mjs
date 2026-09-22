// One-off: create the public "movie-posters" Storage bucket, mirroring the
// existing member-avatars / booth-photos buckets. Safe to re-run --
// no-ops if the bucket already exists.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: existing } = await supabase.storage.getBucket("movie-posters");
if (existing) {
  console.log("movie-posters bucket already exists");
  process.exit(0);
}

const { error } = await supabase.storage.createBucket("movie-posters", {
  public: true,
  fileSizeLimit: 8000000,
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
});
if (error) {
  console.error("createBucket failed:", error.message);
  process.exit(1);
}
console.log("Created movie-posters bucket");

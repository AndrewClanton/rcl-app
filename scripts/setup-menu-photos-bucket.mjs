// One-off: create the public "menu-photos" Storage bucket for the product
// photos on the register's menu buttons and category tabs, the same way the
// movie-posters bucket was made. Safe to re-run -- no-ops if the bucket
// already exists.
//
// Photos arrive as ~480x480 JPEGs (the Menu page shrinks them in the
// browser), so the bucket takes JPEGs only, up to 2 MB, like the upload
// action checks.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: existing } = await supabase.storage.getBucket("menu-photos");
if (existing) {
  console.log("menu-photos bucket already exists");
  process.exit(0);
}

const { error } = await supabase.storage.createBucket("menu-photos", {
  public: true,
  fileSizeLimit: 2000000,
  allowedMimeTypes: ["image/jpeg"],
});
if (error) {
  console.error("createBucket failed:", error.message);
  process.exit(1);
}
console.log("Created menu-photos bucket");

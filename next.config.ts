import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// The app's version, stamped at build time (shown to owners only: see
// src/lib/app-version.ts). The release number is package.json's version,
// bumped a minor step each time something ships (1.0, 1.1, 1.2...). The
// commit is Vercel's when Vercel shares it (its "System Environment
// Variables" setting), else git's own (Vercel builds from a git checkout),
// else "dev". Set once in process.env, so every build worker that loads
// this file again gets the same build time.
function appBuildStamp() {
  if (!process.env.NEXT_PUBLIC_APP_BUILD) {
    let commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "";
    if (!commit) {
      try {
        commit = execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).toString().trim();
      } catch {
        commit = "";
      }
    }
    process.env.NEXT_PUBLIC_APP_BUILD = /^[0-9a-f]{7,40}$/i.test(commit) ? commit : "dev";
  }
  if (!process.env.NEXT_PUBLIC_APP_BUILT_AT) process.env.NEXT_PUBLIC_APP_BUILT_AT = new Date().toISOString();
  if (!process.env.NEXT_PUBLIC_APP_VERSION) {
    let version = "0.0.0";
    try {
      version = String(JSON.parse(readFileSync("package.json", "utf8")).version ?? version);
    } catch {
      // keep 0.0.0
    }
    process.env.NEXT_PUBLIC_APP_VERSION = version;
  }
  return {
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
    NEXT_PUBLIC_APP_BUILD: process.env.NEXT_PUBLIC_APP_BUILD,
    NEXT_PUBLIC_APP_BUILT_AT: process.env.NEXT_PUBLIC_APP_BUILT_AT,
  };
}

const nextConfig: NextConfig = {
  env: appBuildStamp(),
  images: {
    remotePatterns: [{ protocol: "https", hostname: "bfuwznfwickzeivnfrle.supabase.co" }],
    // 75 is Next's default for every image; 85 is for the register's menu
    // pictures (components/menu/MenuTile), so a food photo stays sharp on
    // an iPad's retina screen.
    qualities: [75, 85],
  },
  // Next's default (1MB) is well under a real phone camera photo, and photo
  // uploads (member avatars, booth photos) go through Server Actions as
  // multipart form data -- a real photo would be rejected by the framework
  // before the action's own code (and its friendlier error messages) ever
  // runs. Matches the Storage buckets' own 8MB limit, with headroom for
  // multipart overhead.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // The flyer route reads its fonts and the wordmark straight from disk at
  // runtime (Satori needs raw font data; the logo is embedded as a data
  // URL). Inference has picked these up so far, but make the dependency
  // explicit so a future refactor of how the paths are built can't silently
  // drop them from the deployed function.
  outputFileTracingIncludes: {
    "/admin/schedule-graphic/image": ["src/app/admin/schedule-graphic/fonts/**/*", "src/app/admin/schedule-graphic/assets/**/*"],
    // A shared profile's link preview (m/[handle]/opengraph-image) draws
    // with the flyer's fonts, read at request time.
    "/m/**": ["src/app/admin/schedule-graphic/fonts/ArchivoBlack-Regular.ttf", "src/app/admin/schedule-graphic/fonts/SpaceMono-Bold.ttf"],
    // Each showtime's link-preview card (showtimes/[id]/opengraph-image.tsx,
    // drawn per request) uses the same fonts and wordmark (lib/seo/share-card.tsx).
    "/showtimes/**": ["src/app/admin/schedule-graphic/fonts/ArchivoBlack-Regular.ttf", "src/app/admin/schedule-graphic/fonts/SpaceMono-Bold.ttf", "src/app/admin/schedule-graphic/assets/logo.png"],
    // The ready-made emails' pictures with a first name in them
    // (api/email/art): the bases and the font, read at request time.
    "/api/email/art/**": ["src/lib/email/designs/art/**/*", "src/app/admin/schedule-graphic/fonts/ArchivoBlack-Regular.ttf"],
  },
  // Keep search engines off the *.vercel.app addresses. Until switch-over the
  // real domain still serves the old site, and Stripe here is in test mode --
  // a customer who found this copy on Google could "buy" a ticket that was
  // never paid for. After switch-over, royalecinemajoplin.com doesn't match
  // this rule, so it's indexed normally and the vercel.app copy never
  // competes with it.
  async headers() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: ".*\\.vercel\\.app" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;

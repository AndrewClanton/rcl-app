import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "bfuwznfwickzeivnfrle.supabase.co" }],
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
  // The Now Playing screen's old address (it was "the ramp TV"). The TV
  // stick's kiosk browser still starts there; the query string (?rotate=)
  // carries over on its own.
  async redirects() {
    return [{ source: "/display/ramp", destination: "/display/now-playing", permanent: true }];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org" },
      { protocol: "https", hostname: "bfuwznfwickzeivnfrle.supabase.co" },
    ],
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
};

export default nextConfig;

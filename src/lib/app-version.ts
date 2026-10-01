import "server-only";

// Which version of the app this is, for the owners only (the bottom of the
// Back office menu, and Back office → Roadmap). Stamped at build time by
// next.config.ts:
//   NEXT_PUBLIC_APP_VERSION   package.json's version: 1.0.0, then 1.1.0,
//                             1.2.0... one minor bump per release
//   NEXT_PUBLIC_APP_BUILD     the short commit it was built from
//   NEXT_PUBLIC_APP_BUILT_AT  when it was built (ISO)
// Read only on the server and handed to owners' pages, so the commit and
// build time never ship in a public page or script.

export interface AppVersion {
  version: string; // "1.0.0"
  release: string; // "1.0"
  build: string; // "7f3a2c1", or "dev"
  builtAt: string | null; // ISO
  line: string; // "v1.0 · build 7f3a2c1 · Oct 1, 12:40 PM"
}

export function appVersion(): AppVersion {
  const version = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
  const m = /^(\d+)\.(\d+)/.exec(version);
  const release = m ? `${m[1]}.${m[2]}` : version;
  const build = process.env.NEXT_PUBLIC_APP_BUILD || "dev";
  const builtAt = process.env.NEXT_PUBLIC_APP_BUILT_AT || null;
  const when =
    builtAt && !Number.isNaN(Date.parse(builtAt))
      ? new Date(builtAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })
      : null;
  return { version, release, build, builtAt, line: [`v${release}`, `build ${build}`, when].filter(Boolean).join(" · ") };
}

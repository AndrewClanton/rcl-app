// Which deployment this server is running. A register page that was opened
// before a deploy keeps calling the old build's Server Actions, which the
// new server no longer has ("Server Action ... was not found"), so the page
// compares this against what it was rendered with and asks for a reload.
export function deploymentId(): string {
  return process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || "local";
}

// The message Next.js gives when a stale page calls a Server Action.
export function isStaleBuildError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /Server Action .* was not found|failed-to-find-server-action/i.test(msg);
}

export const STALE_BUILD_MESSAGE = "The register was just updated. Refresh this page, then try again. Nothing was charged.";

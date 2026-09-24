import "server-only";
import { headers } from "next/headers";

// The address this request came in on (the live site, a preview deployment
// or localhost), for building Stripe return links -- so they work in every
// environment without a hardcoded site URL.
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

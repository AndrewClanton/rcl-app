import { getUpcomingScreenings, excludeRestrictedReleases } from "@/lib/data/screenings";
import BoxOfficeSignage from "./BoxOfficeSignage";

export const dynamic = "force-dynamic";

// No staff auth here -- this is a public lobby/box-office TV. Screenings
// are read on the server (the public key can't read them), so it keeps
// working unattended without a login. Same
// MPLC advertising restriction as the rest of the public site applies --
// see excludeRestrictedReleases.
export default async function BoxOfficePage() {
  const screenings = excludeRestrictedReleases(await getUpcomingScreenings()).slice(0, 12);
  return <BoxOfficeSignage initialScreenings={screenings} />;
}

import { getUpcomingScreenings, excludeRestrictedReleases } from "@/lib/data/screenings";
import BoxOfficeSignage from "./BoxOfficeSignage";

export const dynamic = "force-dynamic";

// No staff auth here -- this is a public lobby/box-office TV, and
// screenings are already public-readable data (see the initial RLS
// policies), so it should keep working unattended without a login. Same
// MPLC advertising restriction as the rest of the public site applies --
// see excludeRestrictedReleases.
export default async function BoxOfficePage() {
  const screenings = excludeRestrictedReleases(await getUpcomingScreenings()).slice(0, 12);
  return <BoxOfficeSignage initialScreenings={screenings} />;
}

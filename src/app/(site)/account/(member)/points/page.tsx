import { requireMember } from "@/lib/member-auth";
import { getPointsLedger } from "@/lib/data/member-account";
import { visitSummary } from "@/lib/visits-server";
import { getPastVisits } from "@/lib/data/fortis-lookup";
import PointsView from "./PointsView";

export const metadata = { title: "Points" };

export default async function PointsPage() {
  const member = await requireMember();
  const [ledger, visits, past] = await Promise.all([
    getPointsLedger(member.id),
    visitSummary(member.id),
    // Visits on the old card machine, once a person confirmed the card is theirs.
    getPastVisits(member.id).catch(() => null),
  ]);
  return <PointsView balance={Number(member.points)} ledger={ledger} visits={visits} birthday={member.birthday ?? null} past={past} />;
}

import { requireMember } from "@/lib/member-auth";
import { getPointsLedger } from "@/lib/data/member-account";
import { visitSummary } from "@/lib/visits-server";
import PointsView from "./PointsView";

export const metadata = { title: "Points" };

export default async function PointsPage() {
  const member = await requireMember();
  const [ledger, visits] = await Promise.all([getPointsLedger(member.id), visitSummary(member.id)]);
  return <PointsView balance={Number(member.points)} ledger={ledger} visits={visits} birthday={member.birthday ?? null} />;
}

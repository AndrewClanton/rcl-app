import { requireMember } from "@/lib/member-auth";
import { getPointsLedger } from "@/lib/data/member-account";
import PointsView from "./PointsView";

export const metadata = { title: "Points" };

export default async function PointsPage() {
  const member = await requireMember();
  const ledger = await getPointsLedger(member.id);
  return <PointsView balance={Number(member.points)} ledger={ledger} />;
}

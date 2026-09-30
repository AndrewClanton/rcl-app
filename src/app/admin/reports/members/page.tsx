import { requireStaff } from "@/lib/auth";
import { getMembershipAnalytics } from "@/lib/data/reports";
import MembersScreen from "./MembersScreen";

export const dynamic = "force-dynamic";

// Reports -> Members: who our members are, and the free members by
// community program (for grant and impact reporting). Joins and check-ins
// week by week are on the Week and Month tabs.
export default async function MembersReportPage() {
  const [, m] = await Promise.all([requireStaff(), getMembershipAnalytics()]);
  return <MembersScreen m={m} />;
}

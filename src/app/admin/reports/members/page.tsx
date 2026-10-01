import { hasAdminAccess, requireStaff } from "@/lib/auth";
import { getMembershipAnalytics } from "@/lib/data/reports";
import { ensureMemberPaymentsFresh } from "@/lib/membership-payments/sync";
import { getMembersPayments } from "@/lib/membership-payments/read";
import MembersScreen from "./MembersScreen";

export const dynamic = "force-dynamic";
// "Re-read from Stripe" (./actions.ts) reads every payment since launch.
export const maxDuration = 60;

// Reports -> Members: who our members are, who pays for Insiders+ (by plan)
// and what Stripe charged them this month and last, and the free members by
// community program (for grant and impact reporting). Joins and check-ins
// week by week are on the Week and Month tabs.
export default async function MembersReportPage() {
  const staff = await requireStaff();
  // Membership payments are read from Stripe first if it's been a while.
  await ensureMemberPaymentsFresh();
  const [m, payments] = await Promise.all([getMembershipAnalytics(), getMembersPayments()]);
  return <MembersScreen m={m} payments={payments} canReread={hasAdminAccess(staff.role)} />;
}

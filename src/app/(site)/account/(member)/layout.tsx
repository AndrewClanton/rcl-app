import { requireMember } from "@/lib/member-auth";
import { getStaffSession, hasAdminAccess } from "@/lib/auth";
import AccountNav from "./AccountNav";
import AccountHeader from "./AccountHeader";

export const dynamic = "force-dynamic";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const member = await requireMember();
  const staff = await getStaffSession();

  return (
    <div className="space-y-8">
      <AccountHeader member={member} showBackOffice={!!staff && hasAdminAccess(staff.role)} />
      <AccountNav />
      {children}
    </div>
  );
}

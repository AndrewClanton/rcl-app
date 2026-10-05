import { requireMember } from "@/lib/member-auth";
import { getStaffSession, hasAdminAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import AccountNav from "./AccountNav";
import AccountHeader from "./AccountHeader";

export const dynamic = "force-dynamic";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const member = await requireMember();
  const staff = await getStaffSession();
  // Their organization account (lib/orgs.ts), if they're in one.
  const org = member.organization_id
    ? await createAdminClient()
        .from("organizations")
        .select("name, status")
        .eq("id", member.organization_id)
        .maybeSingle()
        .then((r) => (r.data && r.data.status !== "closed" ? { name: r.data.name as string, role: member.org_role ?? null } : null))
    : null;

  return (
    <div className="space-y-6 sm:space-y-8">
      <AccountHeader member={member} showBackOffice={!!staff && hasAdminAccess(staff.role)} org={org} />
      <AccountNav />
      {children}
    </div>
  );
}

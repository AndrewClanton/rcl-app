import { notFound } from "next/navigation";
import { getStaffSession, hasAdminAccess } from "@/lib/auth";
import { getCommunityPrograms, getEraseLogEntry, getMemberById, getMemberPurchaseHistory } from "@/lib/data/members";
import { getStaffInfoForMembers } from "@/lib/data/employees";
import { getGiftsForMember } from "@/lib/gift-membership";
import { maskEmail, seesFullContact } from "@/lib/contact-mask";
import { getMemberEmailPanel } from "@/lib/email/member-panel";
import MemberDetail from "./MemberDetail";
import EmailPanel from "./EmailPanel";

export const dynamic = "force-dynamic";

export default async function AdminMemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A cashier gets the member's email and phone (and a gift buyer's email)
  // shortened before anything reaches the page (lib/contact-mask.ts).
  const session = await getStaffSession();
  const role = session?.role ?? "cashier";
  const fullContact = seesFullContact(role);
  const member = await getMemberById(id, role);
  if (!member) notFound();

  const [purchases, communityPrograms, gifts, eraseLog] = await Promise.all([
    getMemberPurchaseHistory(id),
    getCommunityPrograms(),
    getGiftsForMember(id),
    member.erased_at ? getEraseLogEntry(id) : Promise.resolve(null),
  ]);
  const staffInfo = await getStaffInfoForMembers([member], session?.employeeId ?? null);
  // Cashiers get the on/off switch only; the email history, engagement and
  // never-mail reason are for staff who see full contact details.
  const emailPanel = member.erased_at ? null : await getMemberEmailPanel(id, { detail: fullContact }).catch(() => null);

  return (
    <>
    <MemberDetail
      member={member}
      purchases={purchases}
      gifts={fullContact ? gifts : gifts.map((g) => ({ ...g, buyer_email: maskEmail(g.buyer_email) ?? "" }))}
      communityPrograms={communityPrograms}
      staffInfo={staffInfo[member.id]}
      viewerIsAdmin={!!session && hasAdminAccess(session.role)}
      canEditContact={fullContact}
      eraseLog={eraseLog}
    />
    {emailPanel && (
      <div className="mt-6">
        <EmailPanel memberId={member.id} panel={emailPanel} />
      </div>
    )}
    </>
  );
}

import { notFound } from "next/navigation";
import { getStaffSession, hasAdminAccess } from "@/lib/auth";
import { getCommunityPrograms, getEraseLogEntry, getMemberById, getMemberPurchaseHistory } from "@/lib/data/members";
import { getStaffInfoForMembers } from "@/lib/data/employees";
import { getGiftsForMember } from "@/lib/gift-membership";
import { getPointsHistory } from "@/lib/data/points-history";
import { maskEmail, seesFullContact } from "@/lib/contact-mask";
import { getMemberEmailPanel } from "@/lib/email/member-panel";
import { getPastVisits } from "@/lib/data/fortis-lookup";
import { signInHelpCard } from "@/lib/sign-in-help";
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

  const [purchases, communityPrograms, gifts, eraseLog, pointsHistory, pastVisits, signInHelp] = await Promise.all([
    getMemberPurchaseHistory(id),
    getCommunityPrograms(),
    getGiftsForMember(id),
    member.erased_at ? getEraseLogEntry(id) : Promise.resolve(null),
    member.erased_at ? Promise.resolve({ rows: [], total: 0 }) : getPointsHistory(id),
    // Visit days on their cards from the old card machine; never card digits.
    member.erased_at ? Promise.resolve(null) : getPastVisits(id).catch(() => null),
    // Sign-in help (a password reset, or a setup link for someone with no
    // login): managers and up (lib/sign-in-help.ts). A cashier's page
    // never looks up the login.
    member.erased_at ? Promise.resolve(null) : signInHelpCard(member, session?.role ?? null),
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
      pointsHistory={pointsHistory}
      pastVisits={pastVisits}
      signInHelp={signInHelp}
    />
    {emailPanel && (
      <div className="mt-6">
        <EmailPanel memberId={member.id} panel={emailPanel} />
      </div>
    )}
    </>
  );
}

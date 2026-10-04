import { notFound } from "next/navigation";
import { getStaffSession, hasAdminAccess, hasManagerAccess } from "@/lib/auth";
import { getCommunityPrograms, getEraseLogEntry, getMemberById, getMemberCards, getMemberPurchaseHistory } from "@/lib/data/members";
import { getStaffInfoForMembers } from "@/lib/data/employees";
import { currentGiftFrom, getGiftsForMember } from "@/lib/gift-membership";
import { getPaidThrough, oldSitePlan, prepaidInForce } from "@/lib/paid-through";
import { getPointsHistory } from "@/lib/data/points-history";
import { maskEmail, seesFullContact } from "@/lib/contact-mask";
import { getMemberEmailPanel } from "@/lib/email/member-panel";
import { getPastVisits } from "@/lib/data/fortis-lookup";
import { signInHelpCard } from "@/lib/sign-in-help";
import { memberFlags } from "@/lib/member-flags-server";
import { visitBusinessDate } from "@/lib/visits";
import MemberDetail from "./MemberDetail";
import EmailPanel from "./EmailPanel";
import FlagBox from "./FlagBox";
import PaidThroughCard, { type PaidThroughInfo } from "./PaidThroughCard";

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

  const [purchases, communityPrograms, gifts, eraseLog, pointsHistory, pastVisits, signInHelp, cards, flags] = await Promise.all([
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
    member.erased_at ? Promise.resolve([]) : getMemberCards(id),
    // "Flag suspicious activity" from the register (lib/member-flags.ts).
    member.erased_at ? Promise.resolve([]) : memberFlags(id),
  ]);
  const staffInfo = await getStaffInfoForMembers([member], session?.employeeId ?? null);
  // Insiders+ paid ahead until a date (lib/paid-through.ts).
  const [paidRec, giftFrom, oldPlan] = member.erased_at
    ? [null, null, null]
    : await Promise.all([getPaidThrough(id), currentGiftFrom(id), oldSitePlan(member as { legacy_user_id?: number | null })]);
  const inForce = prepaidInForce(member, paidRec);
  const paidThrough: PaidThroughInfo = {
    inForce: inForce?.paidThrough ? { paidThrough: inForce.paidThrough, renewsAs: inForce.renewsAs } : null,
    last: paidRec,
    defaultRenewsAs: oldPlan ?? "year",
    gifted: !!giftFrom,
  };
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
      canManage={!!session && hasManagerAccess(session.role)}
      canEditContact={fullContact}
      eraseLog={eraseLog}
      pointsHistory={pointsHistory}
      pastVisits={pastVisits}
      signInHelp={signInHelp}
      cards={cards}
      canUndoCardMatch={!!session && hasManagerAccess(session.role)}
      paidThroughCard={member.erased_at ? null : <PaidThroughCard member={member} info={paidThrough} canEdit={!!session && hasAdminAccess(session.role)} />}
      prepaidRenewsAs={paidThrough.inForce?.renewsAs ?? null}
      flags={flags.length ? <FlagBox flags={flags} canAct={!!session && hasAdminAccess(session.role)} today={visitBusinessDate(new Date())} /> : null}
    />
    {emailPanel && (
      <div className="mt-6">
        <EmailPanel memberId={member.id} panel={emailPanel} />
      </div>
    )}
    </>
  );
}

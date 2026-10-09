import { requireMember } from "@/lib/member-auth";
import { createClient } from "@/lib/supabase/server";
import { googlePhotoUrl } from "@/lib/member-link";
import { getMemberBooths, getMemberScreenings, getPurchases } from "@/lib/data/member-account";
import { dailyCoffeeToday } from "@/lib/daily-perk-server";
import { hasPlusPerks } from "@/lib/plus-status";
import { memberGiftCards } from "@/lib/gift-cards-server";
import OverviewView from "./OverviewView";

export const metadata = { title: "My account" };

export default async function AccountOverviewPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const member = await requireMember();
  const { welcome } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [purchases, screenings, booths, coffee, giftCards] = await Promise.all([
    getPurchases(member.id),
    getMemberScreenings(member.id),
    getMemberBooths(member.id),
    // Insiders+: today's free coffee (lib/daily-perk.ts).
    hasPlusPerks(member) ? dailyCoffeeToday(member.id) : null,
    // Gift cards on their account (lib/gift-cards.ts).
    memberGiftCards(member.id),
  ]);
  const googlePhoto = !member.avatar_url && user ? googlePhotoUrl(user) : null;
  return <OverviewView member={member} purchases={purchases} screenings={screenings} booths={booths} coffee={coffee} giftCards={giftCards} googlePhoto={googlePhoto} welcome={welcome === "1"} />;
}

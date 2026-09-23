import { requireMember } from "@/lib/member-auth";
import { createClient } from "@/lib/supabase/server";
import { googlePhotoUrl } from "@/lib/member-link";
import { getMemberScreenings, getPurchases } from "@/lib/data/member-account";
import OverviewView from "./OverviewView";

export const metadata = { title: "My account" };

export default async function AccountOverviewPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const member = await requireMember();
  const { welcome } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [purchases, screenings] = await Promise.all([getPurchases(member.id), getMemberScreenings(member.id)]);
  const googlePhoto = !member.avatar_url && user ? googlePhotoUrl(user) : null;
  return <OverviewView member={member} purchases={purchases} screenings={screenings} googlePhoto={googlePhoto} welcome={welcome === "1"} />;
}

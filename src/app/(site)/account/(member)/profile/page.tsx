import { requireMember } from "@/lib/member-auth";
import { createClient } from "@/lib/supabase/server";
import { googlePhotoUrl } from "@/lib/member-link";
import { getSignInProviders } from "@/lib/auth-providers";
import { getMyLinkedCards } from "@/lib/data/member-account";
import { ownedPerks, sweepPerks } from "@/lib/rewards-server";
import ProfileView from "./ProfileView";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const member = await requireMember();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const providers = [...new Set((user?.identities ?? []).map((i) => i.provider))];
  const googlePhoto = user ? googlePhotoUrl(user) : null;
  // A timed perk that ran out shows the default again, before it's read.
  await sweepPerks(member.id);
  const [enabled, cards, owned] = await Promise.all([getSignInProviders(), getMyLinkedCards(member.id), ownedPerks(member.id).catch(() => [])]);
  return <ProfileView member={member} providers={providers} googlePhoto={googlePhoto} enabled={enabled} cards={cards} owned={owned} />;
}

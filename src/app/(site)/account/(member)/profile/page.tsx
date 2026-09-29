import { requireMember } from "@/lib/member-auth";
import { createClient } from "@/lib/supabase/server";
import { googlePhotoUrl } from "@/lib/member-link";
import { getSignInProviders } from "@/lib/auth-providers";
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
  const enabled = await getSignInProviders();
  return <ProfileView member={member} providers={providers} googlePhoto={googlePhoto} enabled={enabled} />;
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicProfile, getPublicProfileCards } from "@/lib/member-profile-server";
import { profileBlurb } from "@/lib/member-profile";
import ProfileSheet from "./ProfileSheet";

// A member's shared profile page (lib/member-profile.ts says what it shows
// and never shows). Rendered fresh every time, so turning sharing off or
// changing the link takes effect at once; an unknown link, one that's
// switched off and one staff turned off all look the same: not found.
export const dynamic = "force-dynamic";

const NOINDEX = { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } };

export async function generateMetadata({ params }: PageProps<"/m/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  const p = await getPublicProfile(handle);
  if (!p) return { title: "Profile not found", robots: NOINDEX };
  const title = `${p.displayName} at Royale Cinema Lounge`;
  const description = profileBlurb(p);
  return {
    title: { absolute: `${p.displayName} · Royale Cinema Lounge` },
    description,
    robots: NOINDEX,
    openGraph: { title, description, type: "profile", url: `/m/${p.handle}`, siteName: "Royale Cinema Lounge", locale: "en_US" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SharedProfilePage({ params }: PageProps<"/m/[handle]">) {
  const { handle } = await params;
  const p = await getPublicProfile(handle);
  if (!p) notFound();
  const cards = await getPublicProfileCards(handle);
  return <ProfileSheet p={p} cards={cards} />;
}

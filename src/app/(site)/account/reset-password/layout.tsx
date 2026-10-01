import { pageMeta } from "@/lib/seo/page-meta";

// Only here for the page's title: the page itself is a Client Component,
// which can't export metadata.
export const metadata = pageMeta({
  title: "Reset your password",
  description: "Choose a new password for your Royale Cinema Lounge account.",
  path: "/account/reset-password",
  noindex: true,
});

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}

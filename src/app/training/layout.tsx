import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";

export const metadata: Metadata = { title: { default: "Training", template: "%s · Training" }, robots: { index: false, follow: false } };

// Staff training: each person's assigned trainings and the full library.
// Opened on a phone (signed in as themselves) or inside the register's
// training window (the register's login, for whoever's on shift). The
// Royale site skin, without the public header.
export default async function TrainingLayout({ children }: { children: React.ReactNode }) {
  const session = await getStaffSession();
  if (!session) redirect("/login?redirect=/training");
  return (
    <div className="site min-h-full" style={{ background: "var(--background)" }}>
      <div className="mx-auto w-full max-w-3xl px-4 py-8">{children}</div>
    </div>
  );
}

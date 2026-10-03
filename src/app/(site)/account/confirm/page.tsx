import type { Metadata } from "next";
import Link from "next/link";
import { PageMasthead } from "@/components/print";
import { safePath } from "@/lib/safe-path";
import ConfirmButton from "./ConfirmButton";

// Where the links in Supabase's sign-up confirmation and email change
// emails land (and password reset's, if that template is switched too),
// once the email templates in Supabase point here:
//   {{ .SiteURL }}/account/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}
// with type=email_change for "Change email address" (type=recovery for
// "Reset password"). Opening the page does nothing by itself; the button
// does the one-time step (confirmEmailLink), so a mail scanner that opens
// every link can't spend it first.
export const metadata: Metadata = { title: "Confirm your email", robots: { index: false, follow: false } };

const TYPES = new Set(["email", "signup", "recovery", "email_change", "invite"]);

// {{ .RedirectTo }} arrives as a full address; only its path is used.
function nextPath(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, "https://this-site.invalid");
    return safePath(u.pathname + u.search);
  } catch {
    return null;
  }
}

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function ConfirmEmailPage({ searchParams }: { searchParams: Promise<{ token_hash?: string | string[]; type?: string | string[]; next?: string | string[] }> }) {
  const params = await searchParams;
  const tokenHash = one(params.token_hash);
  const type = one(params.type) || "email";
  const recovery = type === "recovery";
  const valid = !!tokenHash && tokenHash.length <= 500 && TYPES.has(type);

  return (
    <div className="mx-auto max-w-md">
      <PageMasthead eyebrow="My account" title={recovery ? "Reset password" : "Confirm your email"} className="!mb-6" />
      {valid ? (
        <div className="sheet p-5 sm:p-6">
          <p className="text-[15px]">
            {recovery ? "Press the button to choose a new password." : "One more step: press the button to confirm this is your email and open your account."}
          </p>
          <div className="mt-5">
            <ConfirmButton
              tokenHash={tokenHash}
              type={type}
              next={nextPath(one(params.next) || undefined)}
              label={recovery ? "Choose a new password" : "Confirm my email"}
            />
          </div>
        </div>
      ) : (
        <div className="notice notice-warn">
          <p>This link isn&apos;t complete. Copy the whole link from the email, or ask for a new one.</p>
          <p className="mt-2">
            <Link href="/account/login" className="font-bold underline">
              Go to sign in
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

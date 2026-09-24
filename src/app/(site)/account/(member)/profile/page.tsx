import Link from "next/link";
import { requireMember } from "@/lib/member-auth";
import { createClient } from "@/lib/supabase/server";
import { googlePhotoUrl } from "@/lib/member-link";
import { getSignInProviders } from "@/lib/auth-providers";
import MemberAvatar from "@/components/MemberAvatar";
import SignOutButton from "../../SignOutButton";
import { GooglePhotoButton, PhotoUploadButton, RemovePhotoButton } from "../../PhotoButtons";
import { EmailPreference, PasswordForm, ProfileDetailsForm } from "./ProfileForms";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const member = await requireMember();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const providers = new Set((user?.identities ?? []).map((i) => i.provider));
  const googlePhoto = user ? googlePhotoUrl(user) : null;
  const enabled = await getSignInProviders();

  return (
    <div className="space-y-6">
      <Section title="Your photo">
        <div className="flex flex-wrap items-center gap-5">
          <MemberAvatar name={member.name} url={member.avatar_url} size={96} />
          <div className="space-y-2">
            <p className="max-w-md text-sm text-[var(--muted)]">
              Staff use your photo to find your account at the register, and it shows on the screen facing you when you check out. Only staff and you
              see it.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <PhotoUploadButton label={member.avatar_url ? "Change photo" : "Upload a photo"} className={member.avatar_url ? "btn-secondary" : "btn-primary"} />
              {googlePhoto && <GooglePhotoButton />}
              {member.avatar_url && <RemovePhotoButton />}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Your details">
        <ProfileDetailsForm name={member.name} phone={member.phone ?? ""} />
        <div className="mt-4 border-t border-[var(--border)] pt-4 text-sm">
          <div className="label-xs">Email</div>
          <div className="font-bold">{member.email}</div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            This is how you sign in. To change it, email info@royalecinemajoplin.com or ask at the box office.
          </p>
        </div>
      </Section>

      <Section title="Signing in">
        <ul className="mb-4 space-y-2 text-sm">
          {(["google", "facebook"] as const)
            .filter((p) => enabled[p] || providers.has(p))
            .map((p) => {
              const label = p === "google" ? "Google" : "Facebook";
              return (
                <li key={p} className="flex items-center gap-2">
                  <Dot on={providers.has(p)} />
                  <span>
                    <strong>{label}</strong>{" "}
                    {providers.has(p)
                      ? `is connected. You can sign in with the ${label} button.`
                      : `isn't connected. Use "Continue with ${label}" with ${member.email} and it connects automatically.`}
                  </span>
                </li>
              );
            })}
          <li className="flex items-center gap-2">
            <Dot on={providers.has("email")} />
            <span>
              <strong>Email and password</strong> {providers.has("email") ? "is set up." : "isn't set up. You can add a password below."}
            </span>
          </li>
        </ul>
        <PasswordForm hasPassword={providers.has("email")} />
      </Section>

      <Section title="Emails">
        <EmailPreference optIn={member.email_opt_in !== false} />
      </Section>

      <Section title="Your data">
        <p className="text-sm text-[var(--muted)]">
          Want a copy of everything on your account, or want it closed and deleted? Email info@royalecinemajoplin.com and we&apos;ll take care of it.
          Receipts and statements are on the Purchases and Billing tabs. See our{" "}
          <Link href="/privacy" className="font-bold text-[var(--accent)] hover:underline">
            privacy policy
          </Link>{" "}
          and{" "}
          <Link href="/data-deletion" className="font-bold text-[var(--accent)] hover:underline">
            how deleting your data works
          </Link>
          .
        </p>
        <div className="mt-4">
          <SignOutButton />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
      <h2 className="font-display mb-4 text-lg">{title}</h2>
      {children}
    </section>
  );
}

function Dot({ on }: { on: boolean }) {
  return <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${on ? "bg-[var(--success-text)]" : "bg-[var(--border)]"}`} />;
}

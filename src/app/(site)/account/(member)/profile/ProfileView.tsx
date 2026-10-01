import Link from "next/link";
import type { Member } from "@/lib/types";
import MemberAvatar from "@/components/MemberAvatar";
import SignOutButton from "../../SignOutButton";
import { GooglePhotoButton, PhotoUploadButton, RemovePhotoButton } from "../../PhotoButtons";
import { EmailPreference, PasswordForm, ProfileDetailsForm } from "./ProfileForms";
import { Panel } from "../ui";
import { birthdayToInput } from "@/lib/visits";
import ProfilePanels from "./ProfilePanels";

export default function ProfileView({
  member,
  providers,
  googlePhoto,
  enabled,
}: {
  member: Member;
  providers: string[];
  googlePhoto: string | null;
  enabled: { google: boolean; facebook: boolean };
}) {
  const has = new Set(providers);
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <Panel title="Your photo" className="lg:col-span-2">
        <div className="flex flex-wrap items-center gap-6 p-5">
          <MemberAvatar name={member.name} url={member.avatar_url} size={104} plus={member.tier === "Insiders+"} />
          <div className="min-w-0 flex-1 space-y-3">
            <p className="max-w-lg text-[15px] text-[var(--muted)]">
              Staff use your photo to find your account at the register. If you share your profile page, it shows there too.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <PhotoUploadButton label={member.avatar_url ? "Change photo" : "Upload a photo"} className={`${member.avatar_url ? "btn-secondary" : "btn-primary"} px-4 py-2.5`} />
              {googlePhoto && <GooglePhotoButton />}
              {member.avatar_url && <RemovePhotoButton />}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Your details">
        <div className="p-5">
          <ProfileDetailsForm name={member.name} phone={member.phone ?? ""} tagline={member.tagline ?? ""} birthday={birthdayToInput(member.birthday)} lineHidden={!!member.tagline_hidden_at} />
          <div className="mt-5 border-t-2 border-dashed border-[var(--border)] pt-4">
            <div className="label-xs">Email</div>
            <div className="font-bold">{member.email}</div>
            <p className="mt-1 text-sm text-[var(--muted)]">This is how you sign in. To change it, email info@royalecinemajoplin.com or ask at the box office.</p>
          </div>
        </div>
      </Panel>

      <Panel title="Signing in">
        <div className="p-5">
          <ul className="mb-5 space-y-3 text-[15px]">
            {(["google", "facebook"] as const)
              .filter((p) => enabled[p] || has.has(p))
              .map((p) => {
                const label = p === "google" ? "Google" : "Facebook";
                return (
                  <li key={p} className="flex items-start gap-3">
                    <Mark on={has.has(p)} />
                    <span>
                      <strong>{label}</strong>{" "}
                      {has.has(p) ? `is connected. You can sign in with the ${label} button.` : `isn't connected. Use "Continue with ${label}" with ${member.email} and it connects automatically.`}
                    </span>
                  </li>
                );
              })}
            <li className="flex items-start gap-3">
              <Mark on={has.has("email")} />
              <span>
                <strong>Email and password</strong> {has.has("email") ? "is set up." : "isn't set up. You can add a password below."}
              </span>
            </li>
          </ul>
          <PasswordForm hasPassword={has.has("email")} />
        </div>
      </Panel>

      <ProfilePanels member={member} />

      <Panel title="Emails">
        <div className="p-5">
          <EmailPreference optIn={member.email_opt_in !== false} />
        </div>
      </Panel>

      <Panel title="Your data">
        <div className="p-5">
          <p className="text-[15px] text-[var(--muted)]">
            Want a copy of everything on your account, or want it closed and deleted? Email info@royalecinemajoplin.com and we&apos;ll take care of it. Receipts and
            statements are on the Purchases and Billing tabs. See our{" "}
            <Link href="/privacy" className="font-bold text-[var(--accent)] hover:underline">
              privacy policy
            </Link>{" "}
            and{" "}
            <Link href="/data-deletion" className="font-bold text-[var(--accent)] hover:underline">
              how deleting your data works
            </Link>
            .
          </p>
          <div className="mt-5">
            <SignOutButton />
          </div>
        </div>
      </Panel>
    </div>
  );
}

// Connected / not connected, as a small printed check box.
function Mark({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`font-display mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] border-2 border-[var(--foreground)] text-xs ${on ? "bg-[var(--gold)]" : "bg-[var(--surface)]"}`}
    >
      {on ? "✓" : ""}
    </span>
  );
}

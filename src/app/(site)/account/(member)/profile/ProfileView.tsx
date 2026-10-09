import Link from "next/link";
import type { Member } from "@/lib/types";
import MemberAvatar from "@/components/MemberAvatar";
import SignOutButton from "../../SignOutButton";
import { GooglePhotoButton, PhotoUploadButton, RemovePhotoButton } from "../../PhotoButtons";
import { PasswordForm, ProfileDetailsForm } from "./ProfileForms";
import { LinkedCards } from "./LinkedCards";
import type { MyLinkedCard } from "@/lib/data/member-account";
import { Panel, TAP } from "../ui";
import { birthdayToInput } from "@/lib/visits";
import ProfilePanels from "./ProfilePanels";
import type { OwnedPerkKey } from "./PerksPanel";

export default function ProfileView({
  member,
  providers,
  googlePhoto,
  enabled,
  cards,
  owned = [],
}: {
  member: Member;
  providers: string[];
  googlePhoto: string | null;
  enabled: { google: boolean; facebook: boolean };
  cards: MyLinkedCard[];
  owned?: OwnedPerkKey[];
}) {
  const has = new Set(providers);
  return (
    <div className="grid grid-cols-1 gap-8 sm:gap-10 lg:grid-cols-2">
      <Panel title="Your photo" className="lg:col-span-2">
        {/* The photo beside the words; on a phone the buttons go full width
            under both, from a tablet up they sit under the words. */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-4 p-5 sm:gap-x-6">
          <div className="sm:row-span-2">
            <MemberAvatar name={member.name} url={member.avatar_url} size={80} plus={member.tier === "Insiders+"} className="sm:hidden" />
            <MemberAvatar name={member.name} url={member.avatar_url} size={104} plus={member.tier === "Insiders+"} className="hidden sm:block" />
          </div>
          <p className="max-w-lg text-[15px] text-[var(--muted)]">
            Staff use your photo to find your account at the register. If you share your profile page, it shows there too.
          </p>
          <div className="col-span-2 grid gap-3 sm:col-span-1 sm:col-start-2 sm:flex sm:flex-wrap sm:items-center">
            <PhotoUploadButton label={member.avatar_url ? "Change photo" : "Upload a photo"} className={`${member.avatar_url ? "btn-secondary" : "btn-primary"} ${TAP} px-4 py-2.5`} />
            {googlePhoto && <GooglePhotoButton className={`btn-secondary ${TAP} px-4 py-2.5`} />}
            {member.avatar_url && <RemovePhotoButton />}
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

      <ProfilePanels member={member} owned={owned} />

      <Panel title="Cards linked to your account">
        <div className="p-5">
          <LinkedCards cards={cards} linkCards={member.link_cards !== false} />
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

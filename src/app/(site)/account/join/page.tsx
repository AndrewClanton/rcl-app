import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSignInProviders } from "@/lib/auth-providers";
import { describeLogin } from "@/lib/member-claim";
import { PageMasthead } from "@/components/print";
import AccountForm from "../login/AccountForm";
import { UseAnotherLogin } from "../claim/ClaimSteps";
import { personalAccountReason, readInvite } from "./invite";
import JoinButton from "./JoinButton";

// A helper's sign-up link for their organization (Back office →
// Organizations, lib/orgs.ts). They sign up or sign in with their WORK
// email; that login's Royale account joins the organization as a helper,
// separate from any personal account (one login per email, as always).
export const metadata: Metadata = { title: "Join your organization", robots: { index: false, follow: false } };

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md">
      <PageMasthead eyebrow="Organization account" title={title} className="!mb-6" />
      {children}
    </div>
  );
}

export default async function JoinOrgPage({ searchParams }: { searchParams: Promise<{ c?: string | string[] }> }) {
  const code = one((await searchParams).c);
  const supabase = await createClient();
  const [invite, { data: auth }] = await Promise.all([readInvite(code), supabase.auth.getUser()]);
  if (!invite) {
    return (
      <Shell title="This link doesn't work">
        <p className="text-[15px]">It may have been cut off, or replaced with a new one. Ask your organization for the current link.</p>
      </Shell>
    );
  }
  const user = auth.user;
  const here = `/account/join?c=${encodeURIComponent(code)}`;

  if (!user) {
    const providers = await getSignInProviders();
    return (
      <Shell title={`Join ${invite.name}`}>
        <p className="text-[15px] text-[var(--muted)]">
          For {invite.name} staff and helpers. Sign up or sign in with your <strong>work email</strong>, not a personal one: this account is for
          bringing guests to the Royale, and it stays separate from any Royale account of your own.
        </p>
        <div className="mt-6">
          <AccountForm providers={providers} next={here} />
        </div>
      </Shell>
    );
  }

  const login = await describeLogin(user);
  const { data: m } = await createAdminClient().from("members").select("organization_id, tier, stripe_subscription_id").eq("auth_user_id", user.id).maybeSingle();
  const personal = m ? personalAccountReason(m) : null;
  if (m?.organization_id === invite.id) {
    return (
      <Shell title="You're all set">
        <p className="text-[15px]">
          This login is a helper account for {invite.name}. Show it at the box office when you bring guests.
        </p>
        <Link href="/account" className="btn-primary mt-6 block w-full text-center">
          My account
        </Link>
      </Shell>
    );
  }
  const problem = login.screen || login.staff ? "This is one of the Royale's own logins." : !m ? "We couldn't find the Royale account for this login." : m.organization_id ? "This login is already with another organization." : personal;
  return (
    <Shell title={`Join ${invite.name}`}>
      <p className="text-[15px] text-[var(--muted)]">
        You&apos;re signed in as <strong className="break-all">{login.email ?? "a login"}</strong>. Is that your work email? This account becomes a
        helper account for {invite.name}.
      </p>
      <div className="mt-6 space-y-3">
        {problem ? (
          <>
            <p className="notice notice-warn text-sm">{problem} Sign in with your work email instead.</p>
            <UseAnotherLogin className="btn-primary w-full" />
          </>
        ) : (
          <>
            <JoinButton code={code} orgName={invite.name} />
            <UseAnotherLogin className="btn-secondary w-full" />
          </>
        )}
      </div>
    </Shell>
  );
}

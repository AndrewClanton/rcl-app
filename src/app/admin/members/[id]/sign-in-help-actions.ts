"use server";

import { assertManager } from "@/lib/auth";
import { emailSignInHelp, signInHelpLink, type HelpLink, type HelpSent } from "@/lib/sign-in-help";

// The member page's sign-in help (lib/sign-in-help.ts decides what goes
// out and checks the role again). Managers and up; copying a password
// reset link is owner only.

export async function emailMemberSignInHelp(memberId: string): Promise<HelpSent> {
  const staff = await assertManager();
  return emailSignInHelp(String(memberId), staff);
}

export async function copyMemberSignInLink(memberId: string): Promise<HelpLink> {
  const staff = await assertManager();
  return signInHelpLink(String(memberId), staff);
}

"use server";

import { issueFormToken, type GuardedForm } from "@/lib/public-form-guard";

// The bot check's signed "form opened at" stamp (lib/public-form-guard.ts),
// for a form that asks for it once it's on screen (lib/use-form-token.ts)
// instead of having it printed into the page: a page that may be cached
// (the events page) would carry a stamp as old as the cached copy. Nothing
// secret: it only proves when it was handed out, as loading a page with one
// does. Pages built per request pass issueFormToken() in as a prop instead.
const ASKED_FOR: GuardedForm[] = ["eventInquiry"];

export async function publicFormToken(form: GuardedForm): Promise<string | null> {
  if (!ASKED_FOR.includes(form)) return null;
  return issueFormToken(form);
}

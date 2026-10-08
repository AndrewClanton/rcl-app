"use server";

import { after } from "next/server";
import { assertDisplayScreen } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanEmail, cleanFirstName, firstNameOf, formatPhone, isFullPhone, phoneDigits, type CheckinRequest, type TabletCheckin } from "@/lib/checkin";
import {
  memberIdsWithPhone,
  memberWithEmail,
  openCheckin,
  saveNameFromCheckin,
  savePhoneFromCheckin,
  sealCheckin,
  type EmailMatch,
} from "@/lib/checkin-server";
import { recordVisit } from "@/lib/visits-server";
import { EMAIL_DEVICE } from "@/lib/tablet-wallet";
import { lookOf, sweepPerks } from "@/lib/rewards-server";
import { currentMemberId } from "@/lib/member-forward";
import { entranceFor, flairKeys, parseFlair } from "@/lib/flair";
import { visibleLine } from "@/lib/member-profile";
import { allowAttempt, TOO_MANY_TRIES } from "@/lib/rate-limit";
import { issueClaimLink } from "@/lib/member-claim";
import { legacyNeedsSetup } from "@/lib/legacy-plus";
import { shortName } from "@/lib/card-match";
import { emailConfigured } from "@/lib/email/send";
import { emailSetupLinkToNewMember } from "@/lib/sign-in-help";
import { hasName, memberLabel } from "@/lib/member-name";
import { birthdayWeekYear, visitBusinessDate } from "@/lib/visits";

// Check-in for points, from the customer screen. The screen page is gated by
// requireDisplayScreen() (a physical device, signed in with its display-only
// login or a staff one), and assertDisplayScreen() re-checks here so these
// can't be called by anyone else.
//
// "Phone or email" (Andrew, 10/1): about half the members have no usable
// phone on file but nearly all have an email, so the tablet looks people up
// by either. Typing it is the check-in (Andrew, 10/2): one account found
// (or just made) and today's visit is recorded and paid right here
// (checkInHere), with the same once-a-day, streak and badge rules as ever,
// and the screen plays the reward. The register still hears about it (a
// sealed request) to show staff who came in, put them on the order and
// offer Undo.
// - A known number checks in. A shared family number (a few accounts)
//   asks "Which one is you?" right there (first name and last initial
//   only), and the one they tap checks in the same way (checkInNow).
//   Nothing waits on staff (Andrew, 10/2).
// - A known email checks in too, with a first name and last initial for
//   "Welcome back, Sarah M.!", unless there's a number to offer adding
//   first (then checkInNow, once they've answered).
// - Anything unknown just hears "new".

// unlimited: the account is a former unlimited member's with nothing paying
// for it here (lib/legacy-plus.ts): the screen tells them their card goes
// on at the register. Nothing else about them comes back.
// askName: a phone account with no name yet, back for its second visit:
// the screen asks once, gently, "Add your name?" (nameCheckin), and skipping
// sends `request` as it is. Nothing else about them comes back.
// checkedIn: the visit's recorded and paid (what the reward shows). Missing
// while "Add your name?" is still to answer.
// pick: a shared family number, "Which one is you?" (CheckinPick).
export type CheckinStart =
  | { ok: true; status: "known"; request: CheckinRequest; checkedIn?: TabletCheckin; unlimited?: true; askName?: true }
  | CheckinPick
  | { ok: true; status: "new" }
  | { ok: false; error: string };

// A shared family number: one button per account, "Sarah M." (a first name
// and last initial, nothing else about them), each with its own sealed
// request (that account and the number they typed) for checkInNow.
export type CheckinChoice = { name: string; ref: string };
export type CheckinPick = { ok: true; status: "pick"; choices: CheckinChoice[] };

// Found by email: checked in already, and nothing about the account comes
// back (name is empty; no checkedIn, so the screen shows a plain "Thanks!").
// withPhone and phone are no longer sent (the "Add this phone?" offer is
// gone: a phone typed at the screen never goes onto an account found by
// email); kept in the type for screens that haven't reloaded.
export type CheckinFound = {
  ok: true;
  status: "found";
  name: string;
  request: CheckinRequest;
  withPhone?: CheckinRequest;
  phone?: string;
  unlimited?: true;
  checkedIn?: TabletCheckin;
};

export type EmailStart = CheckinFound | { ok: true; status: "new" } | { ok: false; error: string };

const NOT_A_NUMBER = "That doesn't look like a full phone number. Try again?";
const NOT_AN_EMAIL = "That email doesn't look right. Check it and try again?";
const LOOKUP_FAILED = "We couldn't look that up just now. Ask a staff member for help.";
// One letter, any alphabet (the RegExp constructor: \p{} needs a newer
// target than this project compiles to).
const ONE_LETTER = new RegExp("^\\p{L}$", "u");

// Anyone at the tablet can type, so lookups are capped per signed-in screen,
// on top of the screen's own lockout. Roomy enough for a group checking in
// one after another at the door. Phone and email share the cap.
const lookupAllowed = (employeeId: string) => allowAttempt(`checkin-lookup:${employeeId}`, 30, 60);

const NOT_SAVED = "We couldn't check you in just now. Try again, or ask a staff member.";

// Today's visit for one account, recorded and paid now (lib/visits-server.ts
// recordVisit: once a business day, with the week streak and badges as
// ever: typing the number again later just says "Welcome back"), anything
// they said yes to at the screen saved now too (the number found by email,
// "Add your name?"), and the sealed request for the register, marked done.
// What comes back for the reward is what a register's confirmation used to
// carry: a first name, points, their flair keys and profile line. Never a
// claim link: the link alone opens the account, and anyone can type a
// number; theirs comes on their receipt. Nobody confirmed it, so the visit
// and its points history name no staff member. Null if the visit couldn't
// be saved.
async function checkInHere(
  details: { memberId: string; phone?: string; addPhone?: string; addName?: string; fresh?: boolean },
  isNew = false,
  // "email": found by an email typed at the screen (foundByEmail).
  by: "phone" | "email" = "phone",
): Promise<{ request: CheckinRequest; checkedIn: TabletCheckin } | null> {
  const memberId = (await currentMemberId(details.memberId)) ?? details.memberId;
  const screen = await assertDisplayScreen();
  const visit = await recordVisit(memberId, null, new Date(), `${by === "email" ? EMAIL_DEVICE : "screen:"}${screen.employeeId}`);
  if (!visit) return null;
  const request = sealCheckin({ kind: "known", ...details, memberId, done: true, paid: !visit.alreadyToday });
  await Promise.all([savePhoneFromCheckin(request.ref, memberId), saveNameFromCheckin(request.ref, memberId)]);
  // A timed perk that ran out shows the default again.
  await sweepPerks(memberId);
  // "*": only what's picked out below leaves the server.
  const { data: m } = await createAdminClient().from("members").select("*").eq("id", memberId).maybeSingle();
  const sound = m ? lookOf(m).sound : null;
  const flair = m ? parseFlair(m) : null;
  const keys = flair ? flairKeys(flair) : null;
  const partyWeek = !!m && m.birthday_party !== false && birthdayWeekYear(m.birthday as string | null, visitBusinessDate(new Date())) !== null;
  const line = m ? visibleLine(m as Parameters<typeof visibleLine>[0]) : null;
  return {
    request,
    checkedIn: {
      firstName: firstNameOf(memberLabel(m?.name as string | null, m?.phone as string | null)),
      points: Math.round(visit.balance),
      isNew,
      visit: { earned: visit.earned, visitPoints: visit.visitPoints, weekStreak: visit.weekStreak, alreadyToday: visit.alreadyToday, badges: visit.badges },
      ...(flair && keys ? { flair: { color: keys.color, entrance: entranceFor(flair, partyWeek), sticker: keys.sticker, ...(sound ? { sound } : {}) } } : {}),
      ...(line ? { line } : {}),
    },
  };
}

// As someone starts typing: wakes the server and its database connection,
// so the check-in itself doesn't wait on either.
export async function warmCheckin(): Promise<void> {
  await assertDisplayScreen();
  await createAdminClient().from("members").select("id").limit(1);
}

export async function startCheckin(phone: string): Promise<CheckinStart> {
  const screen = await assertDisplayScreen();
  const digits = phoneDigits(phone);
  if (!isFullPhone(digits)) return { ok: false, error: NOT_A_NUMBER };
  if (!(await lookupAllowed(screen.employeeId))) return { ok: false, error: TOO_MANY_TRIES };

  const found = await memberIdsWithPhone(digits);
  if (!found.ok) return { ok: false, error: LOOKUP_FAILED };
  if (found.ids.length === 0) return { ok: true, status: "new" };
  // A shared family number: "Which one is you?" (checkInNow checks in the one
  // they tap).
  if (found.ids.length > 1) return pickFor(found.ids, digits);
  const unlimitedNow = unlimitedWithoutCard(found.ids);
  // "Add your name?" to answer first (nameCheckin or checkInNow checks them in).
  if (await namelessToAsk(found.ids[0])) {
    const request = sealCheckin({ kind: "known", phone: digits });
    const flags = (await unlimitedNow) ? { unlimited: true as const } : {};
    return { ok: true, status: "known", request, ...flags, askName: true };
  }
  const [unlimited, done] = await Promise.all([unlimitedNow, checkInHere({ memberId: found.ids[0], phone: digits })]);
  if (!done) return { ok: false, error: NOT_SAVED };
  return { ok: true, status: "known", request: done.request, checkedIn: done.checkedIn, ...(unlimited ? { unlimited: true as const } : {}) };
}

// "Add this phone?" answered (the request they chose: with the number or
// without), "Add your name?" skipped, or "Which one is you?" answered:
// checked in now. unlimited: that account is a former unlimited member's
// with no card on file (the screen then says where it goes on).
export async function checkInNow(
  ref: string,
): Promise<{ ok: true; request: CheckinRequest; checkedIn?: TabletCheckin; unlimited?: true } | CheckinPick | { ok: false; error: string }> {
  const screen = await assertDisplayScreen();
  const c = typeof ref === "string" ? openCheckin(ref) : null;
  if (!c || c.kind !== "known") return { ok: false, error: "That took too long. Please start again." };
  if (!(await lookupAllowed(screen.employeeId))) return { ok: false, error: TOO_MANY_TRIES };
  if ("memberId" in c) {
    // Checked in already: the same request again.
    if (c.done) return { ok: true, request: { id: c.id, ref, kind: "known", done: true } };
    const [unlimited, done] = await Promise.all([
      unlimitedWithoutCard([c.memberId]),
      // Never a phone typed here onto an account found by email (an older
      // request may still carry one): only the name, for a phone account.
      checkInHere({ memberId: c.memberId, phone: c.phone, addName: c.addName, fresh: c.fresh }, false, c.phone ? "phone" : "email"),
    ]);
    return done ? { ok: true, ...done, ...(unlimited ? { unlimited: true as const } : {}) } : { ok: false, error: NOT_SAVED };
  }
  const found = await memberIdsWithPhone(c.phone);
  if (!found.ok) return { ok: false, error: LOOKUP_FAILED };
  if (found.ids.length === 0) return { ok: false, error: "We couldn't find that number just now. Ask a staff member for help." };
  // Someone else put this number on their account a moment ago.
  if (found.ids.length > 1) return pickFor(found.ids, c.phone);
  const done = await checkInHere({ memberId: found.ids[0], phone: c.phone });
  return done ? { ok: true, ...done } : { ok: false, error: NOT_SAVED };
}

// A phone account (lib/member-name.ts) with no name, on its second visit:
// one earlier day checked in, and none today. So it's asked once: after
// this visit there are two, and a skip never asks again. False whenever it
// can't tell.
async function namelessToAsk(memberId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: m, error } = await admin.from("members").select("name").eq("id", memberId).is("erased_at", null).maybeSingle();
  if (error || !m || hasName(m.name as string | null)) return false;
  const { data: visits, error: vErr } = await admin.from("member_visits").select("business_date").eq("member_id", memberId).limit(2);
  if (vErr || visits?.length !== 1) return false;
  return visits[0].business_date !== visitBusinessDate(new Date());
}

// "Which one is you?": the accounts on a shared number, oldest first, each
// as "Sarah M." (lib/card-match.ts shortName; a phone account with no name
// is "Guest ·· 0199") with a sealed request for that account and the
// number. Nothing else about them leaves the server.
async function pickFor(ids: string[], digits: string): Promise<CheckinPick | { ok: false; error: string }> {
  const { data, error } = await createAdminClient().from("members").select("id, name, phone").in("id", ids);
  if (error || !data?.length) return { ok: false, error: LOOKUP_FAILED };
  const byId = new Map(data.map((m) => [m.id as string, m]));
  const choices = ids.flatMap((id) => {
    const m = byId.get(id);
    if (!m) return [];
    return [{ name: shortName(memberLabel(m.name as string | null, m.phone as string | null)), ref: sealCheckin({ kind: "known", memberId: id, phone: digits }).ref }];
  });
  return choices.length ? { ok: true, status: "pick", choices } : { ok: false, error: LOOKUP_FAILED };
}

// "Add your name?" answered: the number they typed (again, so nothing about
// the account rides on the screen) and a first name and last initial. They
// check in now, and the name goes on with it: only onto that account, and
// only while it still has none (savePhoneFromCheckin's twin, lib/
// checkin-server.ts saveNameFromCheckin). An account that isn't a nameless
// one any more just checks in as it is.
export async function nameCheckin(fields: {
  phone: string;
  firstName: string;
  lastInitial?: string | null;
}): Promise<{ ok: true; request: CheckinRequest; firstName: string; checkedIn?: TabletCheckin } | CheckinPick | { ok: false; error: string }> {
  const screen = await assertDisplayScreen();
  const digits = phoneDigits(String(fields?.phone ?? ""));
  if (!isFullPhone(digits)) return { ok: false, error: NOT_A_NUMBER };
  const firstName = cleanFirstName(String(fields?.firstName ?? ""));
  if (!firstName) return { ok: false, error: "Type your first name (letters only)." };
  const initial = String(fields?.lastInitial ?? "")
    .trim()
    .replace(/\.$/, "");
  if (initial && !ONE_LETTER.test(initial)) return { ok: false, error: "Just the first letter of your last name, or leave it blank." };
  if (!(await lookupAllowed(screen.employeeId))) return { ok: false, error: TOO_MANY_TRIES };

  const found = await memberIdsWithPhone(digits);
  if (!found.ok) return { ok: false, error: LOOKUP_FAILED };
  if (found.ids.length === 0) return { ok: false, error: "We couldn't find that number just now. Ask a staff member for help." };
  if (found.ids.length > 1) return pickFor(found.ids, digits);
  const name = initial ? `${firstName} ${initial.toLocaleUpperCase()}.` : firstName;
  const done = await checkInHere({ memberId: found.ids[0], phone: digits, addName: name });
  return done ? { ok: true, ...done, firstName } : { ok: false, error: NOT_SAVED };
}

// The email they typed. `phone`: a number they tried first that we didn't
// find; no longer used (a phone typed at the screen is never added to an
// account found by email), still accepted from older screens.
export async function startEmailCheckin(fields: { email: string; phone?: string | null }): Promise<EmailStart> {
  const screen = await assertDisplayScreen();
  const email = cleanEmail(String(fields.email ?? ""));
  if (!email) return { ok: false, error: NOT_AN_EMAIL };
  if (!(await lookupAllowed(screen.employeeId))) return { ok: false, error: TOO_MANY_TRIES };

  const found = await memberWithEmail(email);
  if (!found.ok) return { ok: false, error: LOOKUP_FAILED };
  if (!found.member) return { ok: true, status: "new" };
  return foundByEmail(found.member);
}

// Found by a typed email: checked in, with a plain "Thanks!" on the screen.
// Anyone can type anyone's email, so nothing about the account comes back
// to the screen (no name, points, flair or membership), a phone typed here
// is never added to it, and the check-in is marked as by email
// ("screen-email:"), which keeps Spend points on the screen shut for them
// today until they check in by phone (lib/tablet-wallet.ts). Staff see who
// it is on the register, as with any check-in.
async function foundByEmail(m: EmailMatch): Promise<CheckinFound | { ok: false; error: string }> {
  const done = await checkInHere({ memberId: m.id }, false, "email");
  if (!done) return { ok: false, error: NOT_SAVED };
  return { ok: true, status: "found", name: "", request: done.request };
}

// Every account here paid for unlimited on the old site and has nothing
// paying for it here (usually there's one; a shared family number only
// counts when it's true of all of them, so nobody is told about someone
// else's membership). False whenever it can't tell.
async function unlimitedWithoutCard(ids: string[]): Promise<boolean> {
  if (!ids.length) return false;
  // "*": works before and after the onboarding migration adds its column.
  const { data, error } = await createAdminClient().from("members").select("*").in("id", ids.slice(0, 8));
  if (error || !data?.length) return false;
  return data.every((m) => legacyNeedsSetup({ ...m, comped: !!m.comped }));
}

// emailed: a setup link is on its way to their inbox (sent just after this
// answers, so the line doesn't wait on it).
export type KioskCreate =
  | { ok: true; status: "known"; request: CheckinRequest; checkedIn?: TabletCheckin }
  | CheckinFound
  | CheckinPick
  | { ok: true; status: "created"; request: CheckinRequest; firstName: string; claimUrl: string | null; emailed: boolean; checkedIn: TabletCheckin }
  | { ok: false; error: string };

// Someone new, at the door: the account is made right away from their name
// and email (phone optional), so the next person doesn't wait on the
// bartender, and their first visit is checked in with it (its points, the
// Welcome badge's included). The register shows "New regular" with the
// name. They finish the rest (password, photo) on their own phone, from
// the QR code here or the setup link emailed to them now. Email marketing
// stays off: the setup email is about their account, not a list.
// An email or number that's on an account already (typed here, or signed
// up since) checks in that account instead of making a second one; a
// shared family number asks "Which one is you?". notThem: they've already
// said "None of these" to that number, so they get an account of their own
// on it.
export async function createKioskMember(fields: { firstName: string; lastName: string; email: string; phone?: string | null; notThem?: boolean }): Promise<KioskCreate> {
  const screen = await assertDisplayScreen();
  const firstName = cleanFirstName(String(fields.firstName ?? ""));
  if (!firstName) return { ok: false, error: "Type your first name (letters only)." };
  const lastName = cleanFirstName(String(fields.lastName ?? ""));
  if (!lastName) return { ok: false, error: "Type your last name (letters only)." };
  const email = cleanEmail(String(fields.email ?? ""));
  if (!email) return { ok: false, error: NOT_AN_EMAIL };
  const rawPhone = phoneDigits(String(fields.phone ?? ""));
  if (rawPhone && !isFullPhone(rawPhone)) return { ok: false, error: "That phone number doesn't look right. Fix it, or leave it blank." };
  const digits = rawPhone || null;
  if (!(await allowAttempt(`checkin-create:${screen.employeeId}`, 8, 60))) return { ok: false, error: TOO_MANY_TRIES };

  const byEmail = await memberWithEmail(email);
  if (!byEmail.ok) return { ok: false, error: LOOKUP_FAILED };
  if (byEmail.member) return foundByEmail(byEmail.member);
  if (digits) {
    const byPhone = await memberIdsWithPhone(digits);
    if (!byPhone.ok) return { ok: false, error: LOOKUP_FAILED };
    if (byPhone.ids.length > 1 && fields.notThem !== true) return pickFor(byPhone.ids, digits);
    if (byPhone.ids.length === 1) {
      const done = await checkInHere({ memberId: byPhone.ids[0], phone: digits });
      return done ? { ok: true, status: "known", ...done } : { ok: false, error: NOT_SAVED };
    }
  }

  const { data, error } = await createAdminClient()
    .from("members")
    .insert({ name: `${firstName} ${lastName}`, phone: digits ? formatPhone(digits) : null, email, email_opt_in: false, points: 0, tier: "Insiders" })
    .select("id")
    .single();
  if (error?.code === "23505") {
    // Their email went on an account a moment ago (the other screen, say).
    const again = await memberWithEmail(email);
    if (again.ok && again.member) return foundByEmail(again.member);
  }
  if (error || !data) return { ok: false, error: "We couldn't set that up just now. Ask the box office to add you." };
  const memberId = data.id as string;

  // The "finish on your phone" QR code: a 30-minute claim link (lib/
  // member-claim.ts). Null if it can't be made: the screen then just says
  // welcome. And the setup link by email, good for 30 days.
  const [claimUrl, done] = await Promise.all([
    issueClaimLink(memberId, "kiosk"),
    checkInHere({ memberId, ...(digits ? { phone: digits } : {}), fresh: true }, true),
  ]);
  const emailed = emailConfigured();
  if (emailed) {
    after(async () => {
      await emailSetupLinkToNewMember(memberId);
    });
  }
  // The account's made either way; a first visit that didn't save is
  // checked in at the register instead.
  if (!done) return { ok: false, error: "Your account's made, but we couldn't check you in just now. Ask the box office." };
  return { ok: true, status: "created", request: done.request, checkedIn: done.checkedIn, firstName, claimUrl, emailed };
}

// "Just use my phone number" (Andrew, 10/2): a number we don't know becomes
// a phone account (lib/member-name.ts), nothing but the number. No name, no
// email, email marketing off, no setup link, no QR code: they just type
// the number each time. Their first visit is checked in with it (its
// points, the Welcome badge's included). A number that's on an account by
// now checks that account in instead, or asks "Which one is you?" for a
// shared one, unless they've already said "None of these" to it (notThem):
// then it's theirs too.
export async function createPhoneAccount(
  phone: string,
  notThem = false,
): Promise<{ ok: true; request: CheckinRequest; made: boolean; checkedIn?: TabletCheckin } | CheckinPick | { ok: false; error: string }> {
  const screen = await assertDisplayScreen();
  const digits = phoneDigits(String(phone ?? ""));
  if (!isFullPhone(digits)) return { ok: false, error: NOT_A_NUMBER };
  if (!(await allowAttempt(`checkin-create:${screen.employeeId}`, 8, 60))) return { ok: false, error: TOO_MANY_TRIES };

  const found = await memberIdsWithPhone(digits);
  if (!found.ok) return { ok: false, error: LOOKUP_FAILED };
  if (found.ids.length > 1 && notThem !== true) return pickFor(found.ids, digits);
  if (found.ids.length === 1) {
    const done = await checkInHere({ memberId: found.ids[0], phone: digits });
    return done ? { ok: true, ...done, made: false } : { ok: false, error: NOT_SAVED };
  }

  const { data, error } = await createAdminClient()
    .from("members")
    .insert({ name: "", phone: formatPhone(digits), email: null, email_opt_in: false, points: 0, tier: "Insiders" })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "We couldn't set that up just now. Ask the box office to add you." };
  const done = await checkInHere({ memberId: data.id as string, phone: digits, fresh: true }, true);
  if (!done) return { ok: false, error: "Your number's saved, but we couldn't check you in just now. Type it again in a moment." };
  return { ok: true, ...done, made: true };
}

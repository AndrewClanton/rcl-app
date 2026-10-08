"use server";

import { assertDisplayScreen } from "@/lib/auth";
import { openWallet } from "@/lib/tablet-wallet";
import { setLook, unlockPerk, walletFor, type UnlockResult } from "@/lib/rewards-server";
import { currentMemberId } from "@/lib/member-forward";
import { allowAttempt, TOO_MANY_TRIES } from "@/lib/rate-limit";
import { isPerkSlot, isUuid, type MemberLook, type PerkSlot, type RewardOffer } from "@/lib/rewards";

// "Spend points" on the customer screen (SpendPoints.tsx). The screen only
// has the sealed reference the register sent with the member's card
// (lib/tablet-wallet.ts), never their id; each action opens it here, on a
// signed-in screen (assertDisplayScreen). The guest taps, no staff PIN: a
// perk unlocks at once; a good goes to the register over the channel
// (lib/rewards.ts RewardAdd), which checks it again before it goes on the
// order.

const GONE = "Ask at the bar to put you on the order again.";

async function memberFrom(ref: unknown): Promise<string | null> {
  const id = openWallet(ref);
  if (!id) return null;
  return (await currentMemberId(id)) ?? id;
}

export interface TabletWallet {
  points: number;
  earned: number;
  look: MemberLook;
  entrance: string | null;
  offers: RewardOffer[];
}

export async function loadWallet(ref: string, pending: { id: string; qty: number }[] = []): Promise<{ ok: true; wallet: TabletWallet } | { ok: false; error: string }> {
  await assertDisplayScreen();
  const memberId = await memberFrom(ref);
  if (!memberId) return { ok: false, error: GONE };
  const clean = (Array.isArray(pending) ? pending : [])
    .filter((p) => isUuid(p?.id) && Number.isInteger(p.qty) && p.qty > 0)
    .slice(0, 50)
    .map((p) => ({ rewardId: p.id, qty: Math.min(p.qty, 20) }));
  const w = await walletFor(memberId, clean).catch(() => null);
  if (!w) return { ok: false, error: "The rewards couldn't load just now. Try again in a moment." };
  return { ok: true, wallet: { points: w.points, earned: w.earned, look: w.look, entrance: w.entrance, offers: w.offers } };
}

export async function unlockOnTablet(ref: string, rewardId: string): Promise<UnlockResult> {
  await assertDisplayScreen();
  const memberId = await memberFrom(ref);
  if (!memberId) return { ok: false, error: GONE };
  if (!isUuid(rewardId)) return { ok: false, error: "That reward couldn't be read." };
  if (!(await allowAttempt(`reward-unlock:${memberId}`, 12, 600))) return { ok: false, error: TOO_MANY_TRIES };
  // The guest tapped it, not staff: no one is named in their history.
  return unlockPerk(memberId, rewardId, null);
}

export async function chooseOnTablet(ref: string, slot: string, key: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  await assertDisplayScreen();
  const memberId = await memberFrom(ref);
  if (!memberId) return { ok: false, error: GONE };
  if (!isPerkSlot(slot)) return { ok: false, error: "That isn't one of the choices." };
  if (!(await allowAttempt(`reward-look:${memberId}`, 40, 600))) return { ok: false, error: TOO_MANY_TRIES };
  return setLook(memberId, slot as PerkSlot, typeof key === "string" ? key : null);
}

"use server";

import { revalidatePath } from "next/cache";
import { assertStaff } from "@/lib/auth";
import { checkManagerPin } from "@/lib/manager-pin";
import { openApproval, sealApproval } from "@/lib/approval-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { logOpsChange } from "@/lib/ops/changes";
import { isRowId, jpegFromForm, NOT_THERE, removePhoto, storePhoto } from "@/lib/menu-pictures/store";
import { approvePicture, defaultQuery, storeFoundPicture } from "@/lib/menu-pictures/found";
import { findCandidates, toView } from "@/lib/menu-pictures/sources";
import { cleanQuery } from "@/lib/menu-pictures/query";
import type { PictureResult, SearchResult } from "@/lib/menu-pictures/shared";

// The register's item settings: press and hold a menu button. The register
// iPad is signed in with a shared login, so the settings open only after a
// manager's PIN (checked once by checkManagerPin, logged and counted like
// refunds). That approval comes back as a short-lived signed token, tied to
// this sign-in, which every change below checks again; none of them trust
// the screen.

type Result = { ok: true } | { ok: false; error: string };

const SCOPE = "item-settings";
const APPROVAL_MS = 15 * 60_000;
const EXPIRED: Result = { ok: false, error: "The manager approval ran out. Close this and hold the button again." };
const NAME_MAX = 80;
const PRICE_MAX = 1000;

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function revalidate() {
  revalidatePath("/pos");
  revalidatePath("/admin/menu");
  revalidatePath("/menu");
}

async function approved(token: unknown): Promise<{ approverId: string | null } | null> {
  const staff = await assertStaff();
  return openApproval(token, SCOPE, staff.employeeId);
}

export type UnlockResult = { ok: true; token: string; approvedBy: string | null; defaultPin: boolean } | { ok: false; error: string };

export async function unlockItemSettings(pin: string, itemId: string): Promise<UnlockResult> {
  const staff = await assertStaff();
  if (!isRowId(itemId)) return NOT_THERE as { ok: false; error: string };
  const approval = await checkManagerPin(pin, SCOPE, staff.employeeId, itemId.toLowerCase());
  if (!approval.ok) return approval;
  const token = sealApproval(SCOPE, staff.employeeId, approval.approverId, APPROVAL_MS);
  if (!token) return { ok: false, error: "The register can't approve changes right now. Use Back office → Menu." };
  return { ok: true, token, approvedBy: approval.approvedBy, defaultPin: approval.defaultPin };
}

// A photo taken or chosen on the register; its new address comes back so
// the sheet can show it straight away.
export async function uploadItemPhoto(token: string, itemId: string, formData: FormData): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!(await approved(token))) return EXPIRED as { ok: false; error: string };
  const file = await jpegFromForm(formData);
  if (!file.ok) return file;
  const r = await storePhoto("item", itemId, file.jpeg);
  if (!r.ok) return r;
  revalidate();
  return { ok: true, url: r.url };
}

// Free-to-use pictures for the button, to browse with ◀ ▶: what the item's
// name suggests, or the words typed in. Only the credits come back; the
// previews load from our own server (/api/menu-pictures/preview).
export async function findItemPictures(token: string, itemId: string, query: string | null): Promise<SearchResult> {
  if (!(await approved(token))) return EXPIRED as { ok: false; error: string };
  const q = cleanQuery(query) || (await defaultQuery("item", itemId));
  if (!q) return NOT_THERE as { ok: false; error: string };
  const { candidates, complete } = await findCandidates(q);
  if (!candidates.length) return { ok: false, error: complete ? `No free pictures for "${q}". Try other words.` : "The picture search isn't answering. Try again in a minute." };
  return { ok: true, query: q, candidates: candidates.map(toView) };
}

// The one on screen: downloaded to our server and put on the button.
export async function pickItemPicture(token: string, itemId: string, query: string, index: number, page: string | null): Promise<PictureResult> {
  if (!(await approved(token))) return EXPIRED as { ok: false; error: string };
  const r = await storeFoundPicture("item", itemId, query, index, page, true);
  if (r.ok) revalidate();
  return r;
}

// A picture that was found automatically, looked at and kept.
export async function keepItemPicture(token: string, itemId: string): Promise<PictureResult> {
  if (!(await approved(token))) return EXPIRED as { ok: false; error: string };
  const r = await approvePicture("item", itemId);
  if (r.ok) revalidate();
  return r;
}

// Back to the label tile.
export async function showItemLabelTile(token: string, itemId: string): Promise<Result> {
  if (!(await approved(token))) return EXPIRED;
  const r = await removePhoto("item", itemId);
  if (!r.ok) return r;
  revalidate();
  return { ok: true };
}

export interface ItemDetails {
  name: string;
  price: number;
  active: boolean;
}

// Name, price, and whether it's on the register. Only what's sent changes.
export async function saveItemDetails(token: string, itemId: string, fields: Partial<ItemDetails>): Promise<{ ok: true; item: ItemDetails } | { ok: false; error: string }> {
  const ok = await approved(token);
  if (!ok) return EXPIRED as { ok: false; error: string };
  if (!isRowId(itemId) || !fields || typeof fields !== "object") return NOT_THERE as { ok: false; error: string };
  const patch: Partial<ItemDetails> = {};
  if (fields.name !== undefined) {
    const name = typeof fields.name === "string" ? fields.name.replace(/\s+/g, " ").trim() : "";
    if (!name) return { ok: false, error: "An item needs a name." };
    if (name.length > NAME_MAX) return { ok: false, error: `Keep the name under ${NAME_MAX} characters.` };
    patch.name = name;
  }
  if (fields.price !== undefined) {
    const price = fields.price;
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > PRICE_MAX) {
      return { ok: false, error: `Enter a price from $0.00 to ${money(PRICE_MAX)}.` };
    }
    patch.price = Math.round(price * 100) / 100;
  }
  if (fields.active !== undefined) {
    if (typeof fields.active !== "boolean") return { ok: false, error: "That didn't come through. Try again." };
    patch.active = fields.active;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to save." };

  const supabase = createAdminClient();
  const key = itemId.toLowerCase();
  const { data: before } = await supabase.from("menu_items").select("name, price, active").eq("id", key).maybeSingle();
  if (!before) return NOT_THERE as { ok: false; error: string };
  const { data: after, error } = await supabase.from("menu_items").update(patch).eq("id", key).select("name, price, active").maybeSingle();
  if (error || !after) {
    console.error("item settings: not saved", error);
    return { ok: false, error: "That didn't save. Try again." };
  }

  const was = before.name as string;
  const changes: string[] = [];
  if (patch.name !== undefined && patch.name !== was) changes.push(`renamed to ${patch.name}`);
  if (patch.price !== undefined && Number(before.price) !== patch.price) changes.push(`price ${money(Number(before.price))} → ${money(patch.price)}`);
  if (patch.active !== undefined && before.active !== patch.active) changes.push(patch.active ? "back on the register" : "hidden from the register");
  if (changes.length) await logOpsChange("menu_item", key, "changed", `${was}: ${changes.join(", ")} (register, manager PIN)`, ok.approverId);
  revalidate();
  return { ok: true, item: { name: after.name as string, price: Number(after.price), active: after.active !== false } };
}

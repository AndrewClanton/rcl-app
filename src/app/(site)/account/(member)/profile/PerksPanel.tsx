"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CardFrame, NameLine } from "@/components/flair/CardLook";
import { DEFAULT_FLAIR_COLOR, flairColor } from "@/lib/flair";
import { SLOT_LABEL, perkOption, type MemberLook, type PerkSlot } from "@/lib/rewards";
import { perkSound, previewSound } from "@/app/display/customer/sounds";
import { updateLook } from "../../actions";

// The perks they've unlocked with points (Spend points, on the screen at
// the bar): pick which sign-in sound, card frame, name color and title to
// show, or none. Entrances are picked with the free ones, above. Only what
// they own is listed; the server checks again (updateLook).

export type OwnedPerkKey = { slot: PerkSlot; key: string; expiresAt: string | null };

const SLOTS: Exclude<PerkSlot, "entrance" | "mobile">[] = ["sound", "frame", "name_color", "title"];

const LOOK_KEY: Record<(typeof SLOTS)[number], keyof MemberLook> = { sound: "sound", frame: "frame", name_color: "nameColor", title: "title" };

export default function PerksPanel({ owned, look: saved, name, color }: { owned: OwnedPerkKey[]; look: MemberLook; name: string; color: string | null }) {
  const router = useRouter();
  const [look, setLook] = useState<MemberLook>(saved);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const hex = (flairColor(color) ?? DEFAULT_FLAIR_COLOR).hex;
  const slots = SLOTS.filter((s) => owned.some((o) => o.slot === s));

  if (!slots.length) {
    return (
      <p className="p-5 text-[15px] text-[var(--muted)]">
        Spend points on the screen at the bar to unlock sign-in sounds, new entrances, card frames, name colors and titles. Spending never lowers your all-time
        points.
      </p>
    );
  }

  async function pick(slot: (typeof SLOTS)[number], key: string | null) {
    if (busy) return;
    // A sample of the sound they picked; "The coin" is the one everyone has.
    if (slot === "sound") previewSound(key ? (perkSound(key) ?? "checkin") : "checkin");
    setBusy(true);
    setMsg(null);
    const r = await updateLook(slot, key).catch(() => ({ ok: false as const, error: "Something went wrong." }));
    setBusy(false);
    if (r.ok) {
      setLook((l) => ({ ...l, [LOOK_KEY[slot]]: key }));
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    } else setMsg({ ok: false, text: r.error });
  }

  return (
    <div className="grid gap-5 p-5">
      <div className="rounded-[10px] bg-[#14110c] p-4 text-[#f3ecd9]">
        <CardFrame frame={look.frame} color={hex}>
          <div className="rounded-[12px] bg-[#1f1a13] px-4 py-3">
            <NameLine name={name} nameColor={look.nameColor} title={look.title} className="font-display text-2xl" />
          </div>
        </CardFrame>
      </div>
      {slots.map((slot) => {
        const mine = owned.filter((o) => o.slot === slot);
        const current = look[LOOK_KEY[slot]];
        return (
          <fieldset key={slot}>
            <legend className="label-xs">{SLOT_LABEL[slot]}</legend>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => pick(slot, null)} className={`chip ${current === null ? "chip-selected" : ""}`} aria-pressed={current === null}>
                {slot === "sound" ? "The coin" : "None"}
              </button>
              {mine.map((o) => {
                const label = perkOption(slot, o.key)?.label ?? o.key;
                const on = current === o.key;
                return (
                  <button key={o.key} type="button" disabled={busy} onClick={() => pick(slot, o.key)} className={`chip ${on ? "chip-selected" : ""}`} aria-pressed={on}>
                    {on ? "✓ " : ""}
                    {label}
                    {o.expiresAt ? ` · until ${new Date(o.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
      {msg && <p className={`text-sm font-bold ${msg.ok ? "text-[var(--success-text,#2f7a4f)]" : "text-[var(--danger-text,#b3261e)]"}`}>{msg.text}</p>}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { flairColor, DEFAULT_FLAIR_COLOR } from "@/lib/flair";
import { SLOT_LABEL, type MemberLook, type PerkSlot, type RewardAdd, type RewardOffer } from "@/lib/rewards";
import { loadWallet, unlockOnTablet, chooseOnTablet, type TabletWallet } from "./reward-actions";
import { perkSound, playSound } from "./sounds";
import { CardFrame, NameLine } from "@/components/flair/CardLook";
import sp from "./spend.module.css";

// "Spend points" on the customer screen: everything points buy, cheapest
// first, over the whole screen until they close it (or a minute untouched,
// or they're off the order).
// - What they can afford is bright with a Use button (tap, then tap again
//   to be sure); the rest is greyed out with "X more points".
// - A good (popcorn, a drink, $5 off...) goes to the register as a $0 line,
//   "Reward: Personal popcorn (−40 pts)" ("reward-add"; the register checks
//   it with the server and answers "reward-added"). Its points come off
//   when the order is paid, and come back if the line is taken off.
// - A vanity perk unlocks at once, shows "Yours", and plays: an entrance
//   over the screen, a sign-in sound, or their card with the new frame,
//   name color or title. One they own can be switched on or off here.
// What's on the order already counts as spent (cart member.rewardPoints).
// Nothing typed, nothing from the channel is drawn as-is: names come from
// the server's catalog, keys are looked up in lib/rewards.ts.

const IDLE_MS = 60_000;
const CONFIRM_MS = 4_000;
const ANSWER_MS = 8_000;

export interface SpendFor {
  firstName: string;
  wallet: string;
  name: string; // shown on the preview card
  color: string | null; // their flair color key
  photo: string | null;
  pendingPoints: number;
  pending: { id: string; qty: number }[];
}

type Note = { ok: boolean; text: string } | null;

const SLOT_ICON: Record<PerkSlot, string> = { sound: "🔊", entrance: "✨", frame: "🖼️", name_color: "🌈", title: "🏷️", mobile: "📱" };

function iconFor(o: RewardOffer): string {
  if (o.kind === "discount") return "💵";
  if (o.kind === "perk" && o.slot) return SLOT_ICON[o.slot];
  const n = o.name.toLowerCase();
  if (n.includes("popcorn")) return "🍿";
  if (n.includes("soda")) return "🥤";
  if (n.includes("candy")) return "🍬";
  if (n.includes("beer") || n.includes("drink")) return "🍺";
  if (n.includes("ticket")) return "🎟️";
  if (n.includes("booth")) return "🛋️";
  return "🎁";
}

export default function SpendPoints({
  who,
  send,
  onAnswer,
  onEntrance,
  onClose,
  previewWallet,
}: {
  who: SpendFor;
  send: (event: "reward-add" | "rewards-changed", payload: object) => void;
  // The register's "reward-added" answers come in through here.
  onAnswer: (listen: ((a: { id: string; ok: boolean; message: string }) => void) | null) => void;
  // Plays an entrance over the screen (CheckinKiosk's encore).
  onEntrance: (entrance: string) => void;
  onClose: () => void;
  // For previews only: shown as-is, nothing is loaded.
  previewWallet?: TabletWallet;
}) {
  const [wallet, setWallet] = useState<TabletWallet | null>(previewWallet ?? null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [preview, setPreview] = useState<{ key: number; look: MemberLook } | null>(null);
  const waiting = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [touch, setTouch] = useState(0);

  // Loaded on open, whenever the order's rewards change, and after each
  // unlock or pick (version).
  const [version, setVersion] = useState(0);
  const load = () => setVersion((v) => v + 1);
  const seq = useRef(0);
  const pendingKey = JSON.stringify(who.pending);
  useEffect(() => {
    if (previewWallet) return;
    let live = true;
    loadWallet(who.wallet, JSON.parse(pendingKey) as SpendFor["pending"])
      .catch(() => ({ ok: false as const, error: "The rewards couldn't load just now." }))
      .then((r) => {
        if (!live) return;
        if (r.ok) {
          setWallet(r.wallet);
          setError(null);
        } else setError(r.error);
      });
    return () => {
      live = false;
    };
  }, [who.wallet, pendingKey, version, previewWallet]);

  // A minute untouched: it closes.
  useEffect(() => {
    const t = setTimeout(onClose, IDLE_MS);
    return () => clearTimeout(t);
  }, [touch, onClose]);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(null), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirm]);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 6_000);
    return () => clearTimeout(t);
  }, [note]);

  // The register's answer to a good.
  useEffect(() => {
    onAnswer((a) => {
      if (!waiting.current || waiting.current.id !== a.id) return;
      clearTimeout(waiting.current.timer);
      waiting.current = null;
      setBusy(null);
      setNote({ ok: a.ok, text: a.ok ? `${a.message} Points come off when you pay.` : a.message });
      playSound(a.ok ? "unlock" : "notFound");
    });
    return () => {
      onAnswer(null);
      if (waiting.current) clearTimeout(waiting.current.timer);
    };
  }, [onAnswer]);

  const available = wallet ? Math.max(0, wallet.points - Math.max(0, who.pendingPoints)) : 0;

  async function use(o: RewardOffer) {
    setTouch((n) => n + 1);
    if (busy) return;
    if (confirm !== o.id) {
      setConfirm(o.id);
      playSound("key");
      return;
    }
    setConfirm(null);
    if (o.kind === "perk") {
      setBusy(o.id);
      const r = await unlockOnTablet(who.wallet, o.id).catch(() => ({ ok: false as const, error: "That didn't go through. Try again." }));
      setBusy(null);
      if (!r.ok) {
        setNote({ ok: false, text: r.error });
        playSound("notFound");
        return;
      }
      setNote({ ok: true, text: r.status === "owned" ? `${o.name} is already yours.` : `${o.name} is yours!` });
      send("rewards-changed", { firstName: who.firstName });
      showOff(r.slot, r.key);
      load();
      return;
    }
    // A good: over to the register, which puts it on the order.
    seq.current += 1;
    const id = `${who.wallet.slice(-10)}-${seq.current}`;
    const add: RewardAdd = { id, rewardId: o.id, firstName: who.firstName };
    setBusy(o.id);
    waiting.current = {
      id,
      timer: setTimeout(() => {
        waiting.current = null;
        setBusy(null);
        setNote({ ok: false, text: "The register didn't answer. Ask at the bar." });
      }, ANSWER_MS),
    };
    send("reward-add", add);
  }

  // A perk plays as it's unlocked or switched on.
  function showOff(slot: PerkSlot, key: string) {
    if (slot === "entrance") {
      playSound("unlock");
      onEntrance(key);
    } else if (slot === "sound") {
      const s = perkSound(key);
      playSound(s ?? "unlock");
    } else {
      playSound("unlock");
      const base = wallet?.look ?? { sound: null, frame: null, nameColor: null, title: null };
      const look: MemberLook = {
        ...base,
        ...(slot === "frame" ? { frame: key } : {}),
        ...(slot === "name_color" ? { nameColor: key } : {}),
        ...(slot === "title" ? { title: key } : {}),
      };
      seq.current += 1;
      setPreview({ key: seq.current, look });
    }
  }

  async function choose(o: RewardOffer, on: boolean) {
    setTouch((n) => n + 1);
    if (!o.slot || busy) return;
    setBusy(o.id);
    const r = await chooseOnTablet(who.wallet, o.slot, on ? o.key : null).catch(() => ({ ok: false as const, error: "That didn't save." }));
    setBusy(null);
    if (!r.ok) {
      setNote({ ok: false, text: r.error });
      return;
    }
    send("rewards-changed", { firstName: who.firstName });
    if (on && o.key) showOff(o.slot, o.key);
    else playSound("remove");
    load();
  }

  function isOn(o: RewardOffer): boolean {
    if (!wallet || !o.key) return false;
    switch (o.slot) {
      case "sound":
        return wallet.look.sound === o.key;
      case "entrance":
        return wallet.entrance === o.key;
      case "frame":
        return wallet.look.frame === o.key;
      case "name_color":
        return wallet.look.nameColor === o.key;
      case "title":
        return wallet.look.title === o.key;
      default:
        return false;
    }
  }

  const color = (flairColor(who.color) ?? DEFAULT_FLAIR_COLOR).hex;

  return (
    <div className={sp.sheet} role="dialog" aria-modal="true" aria-label="Spend points" onPointerDown={() => setTouch((n) => n + 1)}>
      <header className={sp.head}>
        <div>
          <h2 className={sp.title}>Spend points</h2>
          <p className={sp.balance}>
            {wallet ? (
              <>
                <b>{available.toLocaleString("en-US")}</b> to spend
                {who.pendingPoints > 0 && <span className={sp.dim}> · {who.pendingPoints.toLocaleString("en-US")} on this order</span>}
                <span className={sp.dim}> · {wallet.earned.toLocaleString("en-US")} earned all time</span>
              </>
            ) : (
              "Loading…"
            )}
          </p>
        </div>
        <button type="button" className={sp.close} onClick={onClose}>
          <span aria-hidden="true">✕</span> Close
        </button>
      </header>

      {note && (
        <div className={`${sp.note} ${note.ok ? sp.noteOk : sp.noteNo}`} role="status" aria-live="polite">
          {note.text}
        </div>
      )}
      {error && <p className={sp.error}>{error}</p>}

      {preview && (
        <div className={sp.preview} key={preview.key}>
          <CardFrame frame={preview.look.frame} color={color}>
            <div className={sp.previewCard}>
              {who.photo ? (
                // eslint-disable-next-line @next/next/no-img-element -- the screen's own photo route
                <img src={`/display/customer/photo/${who.photo}`} alt="" width={72} height={72} className={sp.previewPhoto} />
              ) : (
                <span className={sp.previewPhoto} aria-hidden="true" />
              )}
              <NameLine name={who.name} nameColor={preview.look.nameColor} title={preview.look.title} />
            </div>
          </CardFrame>
          <button type="button" className={sp.previewDone} onClick={() => setPreview(null)}>
            Looks good
          </button>
        </div>
      )}

      <ul className={sp.list}>
        {(wallet?.offers ?? []).map((o) => {
          const owned = o.owned;
          const forGood = owned && !o.until;
          const short = Math.max(0, o.points - available);
          const can = !o.soon && !o.problem && short === 0 && !forGood;
          const on = owned && isOn(o);
          return (
            <li key={o.id} className={`${sp.item} ${can || owned ? sp.bright : sp.grey}`}>
              <span className={sp.icon} aria-hidden="true">
                {iconFor(o)}
              </span>
              <div className={sp.what}>
                <div className={sp.name}>
                  {o.name}
                  {owned && <span className={sp.yours}>Yours</span>}
                  {o.soon && <span className={sp.soon}>Coming soon</span>}
                </div>
                <div className={sp.desc}>
                  {o.description ?? (o.slot ? SLOT_LABEL[o.slot] : "")}
                  {o.kind === "perk" && o.days && !owned ? ` · ${o.days} days` : ""}
                  {owned && o.until ? ` · until ${new Date(o.until).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                  {o.alcohol ? " · 21+" : ""}
                </div>
              </div>
              <span className={sp.pts}>{o.points.toLocaleString("en-US")} pts</span>
              <div className={sp.act}>
                {owned && o.slot && o.slot !== "mobile" ? (
                  <button type="button" className={on ? sp.onBtn : sp.useBtn} disabled={busy === o.id} onClick={() => choose(o, !on)} aria-pressed={on}>
                    {on ? "✓ On" : "Use"}
                  </button>
                ) : o.soon ? null : can ? (
                  <button type="button" className={confirm === o.id ? sp.sureBtn : sp.useBtn} disabled={!!busy} onClick={() => use(o)}>
                    {busy === o.id ? "…" : confirm === o.id ? `Use ${o.points} pts?` : "Use"}
                  </button>
                ) : (
                  <span className={sp.more}>{o.problem && short === 0 ? o.problem : `${short.toLocaleString("en-US")} more points`}</span>
                )}
                {owned && o.until && can && (
                  <button type="button" className={sp.extend} disabled={!!busy} onClick={() => use(o)}>
                    {confirm === o.id ? "Sure?" : "Add more time"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className={sp.foot}>
        Spending points never lowers your all-time total. Real goods go on your order and come off your points when you pay. Pick your look any time at the bar or
        on your account.
      </p>
    </div>
  );
}

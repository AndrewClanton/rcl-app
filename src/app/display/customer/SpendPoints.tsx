"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { flairColor, DEFAULT_FLAIR_COLOR } from "@/lib/flair";
import {
  SLOT_LABEL,
  groupRewards,
  shortName,
  type MemberLook,
  type PerkSlot,
  type RewardAdd,
  type RewardOffer,
} from "@/lib/rewards";
import {
  loadWallet,
  unlockOnTablet,
  chooseOnTablet,
  type TabletWallet,
} from "./reward-actions";
import { perkSound, playSound } from "./sounds";
import { CardFrame, NameLine } from "@/components/flair/CardLook";
import sp from "./spend.module.css";
import { FLY_MS, FPS, bodyKeyframes, simulate, type Box } from "./blast";

// "Spend points" on the customer screen: everything points buy, over the
// whole screen until they close it (or a minute untouched, or they're off
// the order). In sections, each cheapest first (lib/rewards.ts
// groupRewards): Money off, Food & drinks, Tickets & booths, then Make it
// yours, the perks by kind (Sounds, Name colors, Titles, Card frames,
// Entrances), each named without its "Sound: " prefix.
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

const SLOT_ICON: Record<PerkSlot, string> = {
  sound: "🔊",
  entrance: "✨",
  frame: "🖼️",
  name_color: "🌈",
  title: "🏷️",
  mobile: "📱",
};

// The Big ticket section is the M1 Abrams joke (lib/rewards.ts GoodSection):
// its button only blows the card up, here on the screen. It never asks the
// register or the server for anything, and its stock of 0 means the server
// would refuse it anyway.
function isTank(o: RewardOffer): boolean {
  return o.kind === "good" && o.section === "big";
}
// The blast (blast.ts): the card's pieces fly as rigid bodies off the other
// cards and the screen's edges for FLY_MS, then ease home for HOME_MS. The
// physics runs once at the tap (≤ 30 bodies, 108 frames) and plays back as
// transform-only keyframes on a fixed layer, so nothing reflows.
const HOME_MS = 650;
const BOOM_MS = FLY_MS + HOME_MS + 60;
const SHARDS = 6;
const MAX_BITS = 30 - SHARDS;
const MAX_OBSTACLES = 24;

// The tank's words, each its own piece (data-bit), so each can fly. Long
// text pairs words up so the card stays at `max` pieces or fewer.
function Bits({ text, max }: { text: string; max: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  const per = Math.max(1, Math.ceil(words.length / Math.max(1, max)));
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += per)
    chunks.push(words.slice(i, i + per).join(" "));
  return chunks.map((c, i) => (
    <span key={i}>
      {i > 0 && " "}
      <span data-bit="" className={sp.bit}>
        {c}
      </span>
    </span>
  ));
}

// Copies a piece onto the blast layer: the button as itself, text and the
// icon as a plain box in the same font, at the same spot.
function cloneBit(el: HTMLElement, at: Box): HTMLElement {
  let c: HTMLElement;
  if (el.tagName === "BUTTON") {
    c = el.cloneNode(true) as HTMLElement;
    c.removeAttribute("disabled");
  } else {
    c = document.createElement("div");
    c.textContent = el.textContent;
    const cs = getComputedStyle(el);
    c.style.fontFamily = cs.fontFamily;
    c.style.fontSize = cs.fontSize;
    c.style.fontWeight = cs.fontWeight;
    c.style.letterSpacing = cs.letterSpacing;
    c.style.textTransform = cs.textTransform;
    c.style.color = cs.color;
    c.style.lineHeight = `${at.h}px`;
    c.className = sp.bitClone;
  }
  c.removeAttribute("data-bit");
  c.style.position = "absolute";
  c.style.margin = "0";
  c.style.left = `${at.x}px`;
  c.style.top = `${at.y}px`;
  c.style.width = `${at.w}px`;
  c.style.height = `${at.h}px`;
  c.style.willChange = "transform";
  return c;
}

function iconFor(o: RewardOffer): string {
  if (isTank(o)) return "🪖";
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
  onAnswer: (
    listen: ((a: { id: string; ok: boolean; message: string }) => void) | null,
  ) => void;
  // Plays an entrance over the screen (CheckinKiosk's encore).
  onEntrance: (entrance: string) => void;
  onClose: () => void;
  // For previews only: shown as-is, nothing is loaded.
  previewWallet?: TabletWallet;
}) {
  const [wallet, setWallet] = useState<TabletWallet | null>(
    previewWallet ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [preview, setPreview] = useState<{
    key: number;
    look: MemberLook;
  } | null>(null);
  const waiting = useRef<{
    id: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [touch, setTouch] = useState(0);
  // The tank card mid-explosion (n: a new key each tap, so it replays; fly:
  // its pieces are out on the blast layer, so the card's own are hidden).
  const [boom, setBoom] = useState<{
    id: string;
    n: number;
    fly: boolean;
  } | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const blasting = useRef(false);
  const wobbles = useRef<Animation[]>([]);
  const boomN = useRef(0);
  useEffect(() => {
    if (!boom) return;
    const t = setTimeout(() => {
      layerRef.current?.replaceChildren();
      wobbles.current.forEach((a) => a.cancel());
      wobbles.current = [];
      blasting.current = false;
      setBoom(null);
    }, BOOM_MS);
    return () => clearTimeout(t);
  }, [boom]);
  useEffect(
    () => () => {
      wobbles.current.forEach((a) => a.cancel());
    },
    [],
  );
  // Never redeems anything: no register, no server. Just the show.
  function explode(o: RewardOffer, e: MouseEvent<HTMLButtonElement>) {
    if (blasting.current) return; // one at a time
    blasting.current = true;
    setTouch((n) => n + 1);
    const n = ++boomN.current;
    playSound("boom");
    const card = e.currentTarget.closest("li");
    const layer = layerRef.current;
    const still =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let fly = false;
    if (card && layer && !still && typeof layer.animate === "function") {
      fly = launch(card, layer, (Math.round(e.clientX) * 73856093) ^ (Math.round(e.clientY) * 19349663) ^ (n * 83492791));
    }
    setBoom({ id: o.id, n, fly });
  }
  function launch(card: HTMLElement, layer: HTMLDivElement, seed: number) {
    const home = layer.getBoundingClientRect();
    const box = (r: DOMRect): Box => ({
      x: r.left - home.left,
      y: r.top - home.top,
      w: r.width,
      h: r.height,
    });
    const bits = Array.from(
      card.querySelectorAll<HTMLElement>("[data-bit]"),
    ).slice(0, MAX_BITS);
    const at = bits.map((b) => box(b.getBoundingClientRect()));
    const c = box(card.getBoundingClientRect());
    const center = { x: c.x + c.w * 0.3, y: c.y + c.h * 0.6 };
    for (let i = 0; i < SHARDS; i++) {
      const s = 8 + ((i * 5) % 7);
      at.push({
        x: center.x - s / 2 + ((i * 29) % 40) - 20,
        y: center.y - s / 2 + ((i * 17) % 20) - 10,
        w: s,
        h: s,
      });
    }
    // The other cards on screen are what the pieces hit.
    const others: HTMLElement[] = [];
    const walls: Box[] = [];
    for (const li of layer.parentElement?.querySelectorAll<HTMLElement>("li") ?? []) {
      if (li === card || others.length >= MAX_OBSTACLES) continue;
      const b = box(li.getBoundingClientRect());
      if (b.y + b.h < 0 || b.y > home.height || b.w === 0) continue;
      others.push(li);
      walls.push(b);
    }
    const plan = simulate(at, walls, { w: home.width, h: home.height }, center, seed);
    const frag = document.createDocumentFragment();
    const els = at.map((b, i) => {
      const el =
        i < bits.length
          ? cloneBit(bits[i], b)
          : (() => {
              const d = document.createElement("div");
              d.className = sp.shard;
              d.style.left = `${b.x}px`;
              d.style.top = `${b.y}px`;
              d.style.width = d.style.height = `${b.w}px`;
              return d;
            })();
      frag.appendChild(el);
      return el;
    });
    layer.replaceChildren(frag);
    const total = FLY_MS + HOME_MS;
    els.forEach((el, i) => {
      const keys = bodyKeyframes(plan.tracks[i], plan.frames, HOME_MS);
      // Shards burn up instead of flying home.
      if (i >= bits.length) {
        keys.forEach((k) => {
          k.opacity = Math.max(0, 1 - (k.offset as number) * 1.6);
        });
      }
      el.animate(keys, { duration: total, easing: "linear", fill: "forwards" });
    });
    // A hard hit knocks the card it hit, then it settles.
    wobbles.current = plan.hits.map((h) => {
      const dx = h.dx * 16;
      const dy = h.dy * 12;
      const r = h.dx * 2.5 - h.dy * 1.5;
      return others[h.obstacle].animate(
        [
          { transform: "none" },
          { transform: `translate(${dx}px, ${dy}px) rotate(${r}deg)` },
          { transform: `translate(${-dx * 0.4}px, ${-dy * 0.4}px) rotate(${-r * 0.4}deg)` },
          { transform: `translate(${dx * 0.15}px, ${dy * 0.15}px)` },
          { transform: "none" },
        ],
        { duration: 480, delay: (h.frame / FPS) * 1000, easing: "ease-out" },
      );
    });
    return true;
  }

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
      .catch(() => ({
        ok: false as const,
        error: "The rewards couldn't load just now.",
      }))
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
      setNote({
        ok: a.ok,
        text: a.ok ? `${a.message} Points come off when you pay.` : a.message,
      });
      playSound(a.ok ? "unlock" : "notFound");
    });
    return () => {
      onAnswer(null);
      if (waiting.current) clearTimeout(waiting.current.timer);
    };
  }, [onAnswer]);

  const available = wallet
    ? Math.max(0, wallet.points - Math.max(0, who.pendingPoints))
    : 0;

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
      const r = await unlockOnTablet(who.wallet, o.id).catch(() => ({
        ok: false as const,
        error: "That didn't go through. Try again.",
      }));
      setBusy(null);
      if (!r.ok) {
        setNote({ ok: false, text: r.error });
        playSound("notFound");
        return;
      }
      setNote({
        ok: true,
        text:
          r.status === "owned"
            ? `${shortName(o)} is already yours.`
            : `${shortName(o)} is yours!`,
      });
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
        setNote({
          ok: false,
          text: "The register didn't answer. Ask at the bar.",
        });
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
      const base = wallet?.look ?? {
        sound: null,
        frame: null,
        nameColor: null,
        title: null,
      };
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
    const r = await chooseOnTablet(who.wallet, o.slot, on ? o.key : null).catch(
      () => ({ ok: false as const, error: "That didn't save." }),
    );
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
    <div
      className={sp.sheet}
      role="dialog"
      aria-modal="true"
      aria-label="Spend points"
      onPointerDown={() => setTouch((n) => n + 1)}
    >
      <header className={sp.head}>
        <div>
          <h2 className={sp.title}>Spend points</h2>
          <p className={sp.balance}>
            {wallet ? (
              <>
                <b>{available.toLocaleString("en-US")}</b> to spend
                {who.pendingPoints > 0 && (
                  <span className={sp.dim}>
                    {" "}
                    · {who.pendingPoints.toLocaleString("en-US")} on this order
                  </span>
                )}
                <span className={sp.dim}>
                  {" "}
                  · {wallet.earned.toLocaleString("en-US")} earned all time
                </span>
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
        <div
          className={`${sp.note} ${note.ok ? sp.noteOk : sp.noteNo}`}
          role="status"
          aria-live="polite"
        >
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
                <img
                  src={`/display/customer/photo/${who.photo}`}
                  alt=""
                  width={72}
                  height={72}
                  className={sp.previewPhoto}
                />
              ) : (
                <span className={sp.previewPhoto} aria-hidden="true" />
              )}
              <NameLine
                name={who.name}
                nameColor={preview.look.nameColor}
                title={preview.look.title}
              />
            </div>
          </CardFrame>
          <button
            type="button"
            className={sp.previewDone}
            onClick={() => setPreview(null)}
          >
            Looks good
          </button>
        </div>
      )}

      <div className={sp.list}>
        {groupRewards(wallet?.offers ?? [], (o) => o.slot).map((s) => (
          <section key={s.section} className={sp.section} aria-label={s.label}>
            <h3 className={sp.sectionHead}>{s.label}</h3>
            {s.groups.map((g) => (
              <div key={g.key} className={sp.group}>
                {g.label && <h4 className={sp.groupHead}>{g.label}</h4>}
                <ul className={sp.grid}>
                  {g.items.map((o) => {
                    const owned = o.owned;
                    const forGood = owned && !o.until;
                    const short = Math.max(0, o.points - available);
                    const can =
                      !o.soon && !o.problem && short === 0 && !forGood;
                    const on = owned && isOn(o);
                    const tank = isTank(o);
                    const blowing = tank && boom?.id === o.id;
                    return (
                      <li
                        key={o.id}
                        className={`${sp.item} ${can || owned || tank ? sp.bright : sp.grey}${blowing ? ` ${sp.boom}` : ""}${blowing && boom.fly ? ` ${sp.blasted}` : ""}`}
                      >
                        {blowing && (
                          <span
                            key={boom.n}
                            className={sp.blast}
                            aria-hidden="true"
                          >
                            <span className={sp.flash} />
                            <span className={sp.smoke} />
                          </span>
                        )}
                        <span
                          className={sp.icon}
                          aria-hidden="true"
                          data-bit={tank ? "" : undefined}
                        >
                          {iconFor(o)}
                        </span>
                        <div className={sp.what}>
                          <div className={sp.name}>
                            {tank ? (
                              <Bits text={shortName(o)} max={6} />
                            ) : (
                              shortName(o)
                            )}
                            {owned && <span className={sp.yours}>Yours</span>}
                            {o.soon && (
                              <span className={sp.soon}>Coming soon</span>
                            )}
                          </div>
                          {tank ? (
                            <div className={sp.desc}>
                              {/* For show only (Andrew, 10/9): the real stock stays 0, so the server still refuses it. */}
                              <Bits
                                text={`${o.description ?? ""} · 4 in stock`}
                                max={MAX_BITS - 9}
                              />
                            </div>
                          ) : (
                          <div className={sp.desc}>
                            {o.description ??
                              (o.slot ? SLOT_LABEL[o.slot] : "")}
                            {o.kind === "perk" && o.days && !owned
                              ? ` · ${o.days} days`
                              : ""}
                            {owned && o.until
                              ? ` · until ${new Date(o.until).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                              : ""}
                            {o.alcohol ? " · 21+" : ""}
                            {/* A small order takes fewer points (lib/loyalty.ts rewardPointsFor). */}
                            {o.kind === "discount" ? `${o.description ? " · " : ""}uses only what you need` : ""}
                          </div>
                          )}
                        </div>
                        <span
                          className={sp.pts}
                          data-bit={tank ? "" : undefined}
                        >
                          {o.points.toLocaleString("en-US")} pts
                        </span>
                        <div className={sp.act}>
                          {tank ? (
                            <button
                              type="button"
                              className={sp.useBtn}
                              disabled={blowing}
                              data-bit=""
                              onClick={(e) => explode(o, e)}
                            >
                              Use
                            </button>
                          ) : owned && o.slot && o.slot !== "mobile" ? (
                            <button
                              type="button"
                              className={on ? sp.onBtn : sp.useBtn}
                              disabled={busy === o.id}
                              onClick={() => choose(o, !on)}
                              aria-pressed={on}
                            >
                              {on ? "✓ On" : "Use"}
                            </button>
                          ) : o.soon ? null : can ? (
                            <button
                              type="button"
                              className={
                                confirm === o.id ? sp.sureBtn : sp.useBtn
                              }
                              disabled={!!busy}
                              onClick={() => use(o)}
                            >
                              {busy === o.id
                                ? "…"
                                : confirm === o.id
                                  ? `Use ${o.points} pts?`
                                  : "Use"}
                            </button>
                          ) : (
                            <span className={sp.more}>
                              {o.problem && short === 0
                                ? o.problem
                                : `${short.toLocaleString("en-US")} more points`}
                            </span>
                          )}
                          {owned && o.until && can && (
                            <button
                              type="button"
                              className={sp.extend}
                              disabled={!!busy}
                              onClick={() => use(o)}
                            >
                              {confirm === o.id ? "Sure?" : "Add more time"}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
      <p className={sp.foot}>
        Spending points never lowers your all-time total. Real goods go on your
        order and come off your points when you pay. Pick your look any time at
        the bar or on your account.
      </p>
      <div ref={layerRef} className={sp.blastLayer} aria-hidden="true" />
    </div>
  );
}

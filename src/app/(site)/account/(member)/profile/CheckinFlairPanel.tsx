"use client";

import { useRef, useState, type CSSProperties, type RefObject } from "react";
import { useRouter } from "next/navigation";
import FlairEffect from "@/components/flair/FlairEffect";
import Sticker from "@/components/flair/Sticker";
import {
  DEFAULT_FLAIR_COLOR,
  FLAIR_COLORS,
  FLAIR_EFFECTS,
  FLAIR_STICKERS,
  flairColor,
  type EntranceKey,
  type FlairColorKey,
  type FlairEffectKey,
  type FlairKeys,
  type StickerKey,
} from "@/lib/flair";
import { updateFlair } from "../../actions";
import stage from "./stage.module.css";

const EFFECT_ICON: Record<FlairEffectKey, string> = {
  classic: "🎟️",
  confetti: "🎉",
  unicorn: "🦄",
  fireworks: "🎆",
  reactions: "💖",
  neon: "💡",
  vhs: "📼",
  reel: "🎞️",
  arcade: "👾",
  popcorn: "🍿",
};

// Where a choice plays: on the little stage, or, when the stage is out of
// sight (scrolled past, or under the site's header), over the whole window
// the way it fills the screen at the door.
type Where = "stage" | "page" | "phone";
interface Show {
  run: number;
  entrance: EntranceKey;
  where: Where;
}

// Whether most of the stage can be seen right now: its middle, high and
// low, is on screen and not under anything (the sticky site header).
// Effects never take taps, so one already playing doesn't count.
function inView(el: HTMLElement | null): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  return [0.3, 0.7].every((f) => {
    const y = r.top + r.height * f;
    if (y < 0 || y > window.innerHeight || x < 0 || x > window.innerWidth) return false;
    const hit = document.elementFromPoint(x, y);
    return !!hit && el.contains(hit);
  });
}

// "Your check-in": what the screen at the door does when they check in
// them (lib/flair.ts). A favorite color, an entrance, a sticker for
// Floating reactions, and the birthday-week party, with a little copy of
// the screen that plays each choice as it's picked. On a phone the stage
// comes first, above the choices; whenever it's out of sight, a choice
// plays over the whole window instead, so it's never playing unseen.
export default function CheckinFlairPanel({
  ready,
  flair: saved,
  birthdayParty: savedParty,
  hasBirthday,
  firstName,
  line,
  ownedEntrances = [],
}: {
  ready: boolean;
  flair: FlairKeys;
  birthdayParty: boolean;
  hasBirthday: boolean;
  firstName: string;
  line: string | null;
  // Entrances they unlocked with points: listed with the free ones.
  ownedEntrances?: string[];
}) {
  const effects = FLAIR_EFFECTS.filter((e) => !e.paid || ownedEntrances.includes(e.key));
  const router = useRouter();
  const [color, setColor] = useState<FlairColorKey | null>(saved.color);
  const [effect, setEffect] = useState<FlairEffectKey>(saved.effect);
  const [sticker, setSticker] = useState<StickerKey>(saved.sticker);
  const [party, setParty] = useState(savedParty);
  const [show, setShow] = useState<Show | null>(null);
  const [runs, setRuns] = useState(0); // the banner drops in again with each play
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const hex = (flairColor(color) ?? DEFAULT_FLAIR_COLOR).hex;
  const dirty = color !== saved.color || effect !== saved.effect || sticker !== saved.sticker || party !== savedParty;

  function play(entrance: EntranceKey) {
    const where: Where = inView(stageRef.current) ? "stage" : window.innerWidth < window.innerHeight ? "phone" : "page";
    setShow({ run: runs + 1, entrance, where });
    setRuns(runs + 1);
  }

  async function save() {
    if (busy || !dirty) return;
    setBusy(true);
    setMsg(null);
    const r = await updateFlair({ color, effect, sticker, birthdayParty: party }).catch(() => ({ ok: false as const, error: "Something went wrong." }));
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: "Saved. See you at the door!" } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  }

  return (
    <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
      <div className="min-w-0 space-y-5">
        <p className="text-[15px] text-[var(--muted)]">
          When you check in, the screen at the door welcomes you with your color and your entrance. It only takes a few seconds and never holds up the line.
        </p>
        {!ready && <p className="notice notice-warn text-sm">Check-in effects are almost ready. Try them out here; saving opens up soon.</p>}

        <fieldset>
          <legend className="label-xs">Favorite color</legend>
          <div className="flex flex-wrap gap-2.5">
            {FLAIR_COLORS.map((c) => {
              const on = (color ?? DEFAULT_FLAIR_COLOR.key) === c.key;
              return (
                <label key={c.key} className="relative cursor-pointer" title={c.label}>
                  <input
                    type="radio"
                    name="flair-color"
                    className="peer sr-only"
                    checked={on}
                    onChange={() => {
                      setColor(c.key);
                      setMsg(null);
                      play(effect);
                    }}
                  />
                  <span
                    className={`grid size-11 place-items-center rounded-full border-2 border-[var(--foreground)] text-sm font-black transition-transform peer-focus-visible:shadow-[3px_3px_0_var(--accent)] ${on ? "scale-110 shadow-[2px_2px_0_var(--foreground)]" : "hover:scale-105"}`}
                    style={{ background: c.hex }}
                  >
                    {on ? "✓" : ""}
                  </span>
                  <span className="sr-only">{c.label}</span>
                </label>
              );
            })}
          </div>
          <div className="mt-1.5 text-xs text-[var(--muted)]">{(flairColor(color) ?? DEFAULT_FLAIR_COLOR).label}</div>
        </fieldset>

        <fieldset>
          <legend className="label-xs">Your entrance</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {effects.map((e) => {
              const on = effect === e.key;
              return (
                <label
                  key={e.key}
                  className={`flex cursor-pointer items-start gap-3 rounded-[6px] border-2 p-3 transition-colors has-[:focus-visible]:shadow-[3px_3px_0_var(--accent)] ${on ? "border-[var(--foreground)] bg-[var(--gold)] shadow-[3px_3px_0_var(--foreground)]" : "border-[rgba(20,17,12,0.35)] bg-[var(--surface)] hover:border-[var(--foreground)]"}`}
                >
                  <input
                    type="radio"
                    name="flair-effect"
                    className="sr-only"
                    checked={on}
                    onChange={() => {
                      setEffect(e.key);
                      setMsg(null);
                      play(e.key);
                    }}
                  />
                  <span className="text-2xl leading-none" aria-hidden="true">
                    {EFFECT_ICON[e.key]}
                  </span>
                  <span className="min-w-0">
                    <span className="font-display block leading-tight">
                      {e.label}
                      {e.paid && <span className="ml-1.5 align-middle text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">Yours</span>}
                    </span>
                    <span className={`mt-0.5 block text-[13px] leading-snug ${on ? "text-[var(--foreground)]" : "text-[var(--muted)]"}`}>{e.blurb}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {effect === "reactions" && (
          <fieldset>
            <legend className="label-xs">Your sticker</legend>
            <div className="flex flex-wrap gap-2">
              {FLAIR_STICKERS.map((st) => {
                const on = sticker === st.key;
                return (
                  <label
                    key={st.key}
                    title={st.label}
                    className={`grid size-14 cursor-pointer place-items-center rounded-[6px] border-2 bg-[#14110c] transition-transform has-[:focus-visible]:shadow-[3px_3px_0_var(--accent)] ${on ? "scale-105 border-[var(--foreground)] shadow-[3px_3px_0_var(--gold)]" : "border-transparent [&>*]:opacity-60 hover:[&>*]:opacity-100"}`}
                  >
                    <input
                      type="radio"
                      name="flair-sticker"
                      className="sr-only"
                      checked={on}
                      onChange={() => {
                        setSticker(st.key);
                        setMsg(null);
                        play("reactions");
                      }}
                    />
                    {st.key === "mix" ? (
                      <span className="grid grid-cols-2 gap-0.5 p-1">
                        {(["heart", "popcorn", "star", "reel"] as const).map((k) => (
                          <Sticker key={k} kind={k} color={hex} className="size-4" />
                        ))}
                      </span>
                    ) : (
                      <Sticker kind={st.key} color={hex} className="size-9" />
                    )}
                    <span className="sr-only">{st.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        <label className="flex cursor-pointer items-start gap-3">
          <input
            id="flair-birthday"
            type="checkbox"
            className="mt-0.5 h-5 w-5 accent-[var(--accent)]"
            checked={party}
            onChange={(e) => {
              setParty(e.target.checked);
              setMsg(null);
              if (e.target.checked) play("party");
            }}
          />
          <span className="text-sm">
            <strong>A party in my birthday week</strong>
            <span className="block text-[var(--muted)]">
              Balloons, confetti and a &ldquo;Happy birthday week!&rdquo; instead of your entrance, when you check in that week.
              {!hasBirthday && " Add your birthday under Your details to get it."}
            </span>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary min-h-11 !px-5 !py-2 text-sm" disabled={!ready || busy || !dirty} onClick={() => void save()}>
            {busy ? "Saving…" : "Save my check-in"}
          </button>
          {msg && (
            <span className={`text-sm ${msg.ok ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"}`} role={msg.ok ? "status" : "alert"}>
              {msg.text}
            </span>
          )}
        </div>
      </div>

      <div className="order-first min-w-0 lg:order-none">
        <div className="label-xs">Preview</div>
        <Stage stageRef={stageRef} hex={hex} firstName={firstName} line={line} show={show} runs={runs} sticker={sticker} onDone={() => setShow(null)} />
        {show && show.where !== "stage" && (
          <FlairEffect key={show.run} entrance={show.entrance} color={hex} sticker={sticker} mode={show.where} seed={show.run} onDone={() => setShow(null)} />
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary min-h-11 !px-3 !py-1.5 text-sm" onClick={() => play(effect)}>
            ▶ Play
          </button>
          {party && (
            <button type="button" className="btn-secondary min-h-11 !px-3 !py-1.5 text-sm" onClick={() => play("party")}>
              🎂 Birthday week
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// A little copy of the check-in screen: the keypad (faint), the "checked
// in" banner in their color, and the entrance playing over it.
function Stage({
  stageRef,
  hex,
  firstName,
  line,
  show,
  runs,
  sticker,
  onDone,
}: {
  stageRef: RefObject<HTMLDivElement | null>;
  hex: string;
  firstName: string;
  line: string | null;
  show: Show | null;
  runs: number;
  sticker: StickerKey;
  onDone: () => void;
}) {
  return (
    <div
      ref={stageRef}
      className="relative aspect-[16/10] w-full overflow-hidden rounded-[10px] border-[3px] border-[var(--foreground)] shadow-[4px_4px_0_var(--foreground)]"
      style={{ background: "radial-gradient(circle at 1px 1px, rgba(255,199,44,0.08) 1px, transparent 1.5px) 0 0 / 12px 12px, #14110c" } as CSSProperties}
    >
      <div aria-hidden="true" className="absolute top-[38%] bottom-[6%] left-[6%] grid w-[34%] grid-cols-3 gap-[4%] opacity-25">
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className="rounded-[4px] border border-[#f3ecd9]/60" />
        ))}
      </div>
      <div aria-hidden="true" className="absolute top-[40%] right-[6%] bottom-[8%] left-[46%] rounded-[6px] border border-dashed border-[#f3ecd9]/25" />
      <div
        key={runs}
        className={`absolute top-[5%] right-[5%] left-[5%] rounded-[8px] border-[2.5px] border-[#14110c] px-3 py-2 text-[#14110c] shadow-[0_6px_16px_rgba(0,0,0,0.45)] ${stage.toast}`}
        style={{ background: hex }}
      >
        <div className="font-display truncate text-[15px] leading-tight">✓ {firstName}, you&apos;re checked in</div>
        <div className="text-[12px] font-bold">+5 points</div>
        {line && <div className="mt-0.5 truncate text-[12px] italic">“{line}”</div>}
      </div>
      {show?.where === "stage" && <FlairEffect key={show.run} entrance={show.entrance} color={hex} sticker={sticker} mode="preview" seed={show.run} onDone={onDone} />}
    </div>
  );
}

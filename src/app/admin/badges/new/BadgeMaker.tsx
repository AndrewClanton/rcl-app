"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FORM_IDS, FORM_INFO, P, PART_COLOR, PART_IDS, PART_TEXT, SERIES1_ART, SHAPE_IDS, STARTERS, renderArt, type ArtSpec, type FormId, type FormOpts, type PartId, type PartOpts } from "@/lib/badges/art";
import { cardFrontSvg } from "@/lib/badges/card";
import { RULE_INFO, RULE_TYPES, type RuleType } from "@/lib/badges/rules";
import { countEventBadge, createBadge } from "../actions";

// What "For an event" can point at (lib/badges/events.ts eventChoices).
export interface EventChoices {
  screenings: { id: string; label: string; series: string | null; upcoming: boolean }[];
  houseEvents: { id: string; label: string; series: string | null; upcoming: boolean }[];
  series: string[];
}

// The badge maker: a recipe (a form, its colors, parts placed on it) drawn
// live by the same generator that draws minted copies (lib/badges/art.ts),
// on the card it'll be minted on.

const SWATCHES = Object.entries(P) as [string, string][];
const clone = (s: ArtSpec): ArtSpec => JSON.parse(JSON.stringify(s));
const FORM_DEFAULTS: Record<string, string> = { fill: P.red, edge: P.gold, stitch: P.gold, tail: P.navy };

function Swatches({ value, onPick, label }: { value: string | undefined; onPick: (hex: string) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {SWATCHES.map(([name, hex]) => (
        <button
          key={name}
          type="button"
          title={name}
          aria-label={`${label}: ${name}`}
          aria-pressed={value === hex}
          onClick={() => onPick(hex)}
          className={`size-6 rounded-[5px] border-2 ${value === hex ? "border-[var(--foreground)]" : "border-[var(--border)]"}`}
          style={{ background: hex }}
        />
      ))}
    </div>
  );
}

const Thumb = ({ spec, size = 48 }: { spec: ArtSpec; size?: number }) => (
  <span className="badge-svg block" style={{ width: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: renderArt(spec) }} />
);

export default function BadgeMaker({ nextNumber, issuer, events, forEvent = false }: { nextNumber: number; issuer: string; events: EventChoices; forEvent?: boolean }) {
  const router = useRouter();
  const [spec, setSpec] = useState<ArtSpec>(() => clone(STARTERS[0].spec));
  const [name, setName] = useState("");
  const [flavor, setFlavor] = useState("");
  const [formLabel, setFormLabel] = useState<string | null>(null);
  const [ruleType, setRuleType] = useState<RuleType>(forEvent ? "event" : "manual");
  const [count, setCount] = useState("25");
  const [weeks, setWeeks] = useState("8");
  const [from, setFrom] = useState("12:00");
  const [before, setBefore] = useState("14:00");
  const [eventKind, setEventKind] = useState<"house_event" | "screening" | "series">("house_event");
  const [eventMatch, setEventMatch] = useState("");
  const [eventTimes, setEventTimes] = useState("1");
  const [came, setCame] = useState<{ key: string; n: number } | null>(null);
  const [counting, startCount] = useTransition();
  const eventKey = `${eventKind}|${eventMatch}|${eventKind === "series" ? eventTimes : 1}`;
  const cameNow = came && came.key === eventKey ? came.n : null;
  function countWhoCame() {
    setError(null);
    startCount(async () => {
      const r = await countEventBadge({ eventKind, eventMatch, eventTimes: Number(eventTimes) });
      if (!r.ok) return setError(r.error);
      setCame({ key: eventKey, n: r.came });
    });
  }
  // Picking a series (or an event in one) starts the art from that series'
  // remix, if there is one and the art hasn't been touched.
  const [artTouched, setArtTouched] = useState(false);
  function pickEvent(match: string) {
    setEventMatch(match);
    const list = eventKind === "screening" ? events.screenings : eventKind === "house_event" ? events.houseEvents : null;
    const series = list ? (list.find((e) => e.id === match)?.series ?? null) : match;
    const starter = series ? STARTERS.find((s) => s.name.toLowerCase().startsWith(series.toLowerCase().split(" ")[0])) : null;
    if (starter && !artTouched) setSpec(clone(starter.spec));
  }
  const [points, setPoints] = useState("25");
  const [addPart, setAddPart] = useState<PartId>("star");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [formId, formOpts = {}] = spec.form;
  const parts = spec.parts ?? [];
  const preview = useMemo(
    () =>
      cardFrontSvg({
        name: name.trim() || "New badge",
        flavor: flavor.trim(),
        art: renderArt(spec),
        series: 1,
        setNumber: nextNumber,
        setSize: nextNumber,
        rarity: null,
        serial: null,
        of: 0,
        minted: "",
        issuer,
        event: null,
        stats: [],
        code: null,
        verifyUrl: null,
        qr: null,
        revoked: false,
      }),
    [spec, name, flavor, nextNumber, issuer],
  );

  const setForm = (id: FormId) => {
    const opts: FormOpts = {};
    for (const k of FORM_INFO[id].colors) opts[k] = (formOpts as FormOpts)[k] ?? FORM_DEFAULTS[k];
    if (FORM_INFO[id].shapes) opts.shape = (formOpts as FormOpts).shape ?? "round";
    setSpec({ form: [id, opts], parts });
  };
  const setFormOpt = (k: keyof FormOpts, v: string) => setSpec({ form: [formId, { ...formOpts, [k]: v } as FormOpts], parts });
  const setPart = (i: number, o: PartOpts) => setSpec({ form: spec.form, parts: parts.map((p, j) => (j === i ? [p[0], { ...(p[1] ?? {}), ...o }] : p)) as ArtSpec["parts"] });
  const removePart = (i: number) => setSpec({ form: spec.form, parts: parts.filter((_, j) => j !== i) });
  const movePart = (i: number, d: -1 | 1) => {
    const next = [...parts];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setSpec({ form: spec.form, parts: next });
  };

  function save() {
    setError(null);
    start(async () => {
      const r = await createBadge({
        name,
        flavor,
        spec,
        formLabel: formLabel ?? FORM_INFO[formId].label,
        ruleType,
        count: Number(count),
        weeks: Number(weeks),
        from,
        before,
        eventKind,
        eventMatch,
        eventTimes: Number(eventTimes),
        points: Number(points),
      });
      if (!r.ok) return setError(r.error);
      router.push(`/admin/badges/${r.id}`);
    });
  }

  const input = "mt-1 w-full rounded-[8px] border border-[var(--border)] bg-[var(--background)] px-3 py-2";
  const label = "block text-sm font-bold";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6" onClickCapture={(e) => {
        // Any click in the art sections counts as touching the art.
        if ((e.target as HTMLElement).closest("[data-art]")) setArtTouched(true);
      }}>
        <section className="space-y-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="font-bold">What it&apos;s for</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`chip ${ruleType === "event" ? "chip-selected" : ""}`} aria-pressed={ruleType === "event"} onClick={() => setRuleType("event")}>
              For an event
            </button>
            <button type="button" className={`chip ${ruleType !== "event" ? "chip-selected" : ""}`} aria-pressed={ruleType !== "event"} onClick={() => setRuleType(ruleType === "event" ? "manual" : ruleType)}>
              Something else
            </button>
          </div>
          {ruleType === "event" && (
            <div className="space-y-3">
              <p className="text-sm text-[var(--muted)]">
                Everyone who already came gets it when you add it, and anyone who comes later gets it then: a ticket for the showing, or a check-in that day for an event like trivia.
              </p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Kind">
                {(
                  [
                    ["house_event", "A house event"],
                    ["screening", "A showing"],
                    ["series", "A series"],
                  ] as const
                ).map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    className={`chip ${eventKind === k ? "chip-selected" : ""}`}
                    aria-pressed={eventKind === k}
                    onClick={() => {
                      setEventKind(k);
                      setEventMatch("");
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {eventKind === "series" ? (
                <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
                  <label className={label}>
                    Series
                    <select className={input} value={eventMatch} onChange={(e) => pickEvent(e.target.value)}>
                      <option value="">Pick a series…</option>
                      {events.series.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={label}>
                    Times
                    <input className={input} type="number" min={1} max={100} value={eventTimes} onChange={(e) => setEventTimes(e.target.value)} />
                  </label>
                </div>
              ) : (
                <label className={label}>
                  {eventKind === "screening" ? "Showing" : "Event"}
                  <select className={input} value={eventMatch} onChange={(e) => pickEvent(e.target.value)}>
                    <option value="">{eventKind === "screening" ? "Pick a showing…" : "Pick an event…"}</option>
                    {(["upcoming", "past"] as const).map((when) => {
                      const list = (eventKind === "screening" ? events.screenings : events.houseEvents).filter((e) => e.upcoming === (when === "upcoming"));
                      const ordered = when === "upcoming" ? [...list].reverse() : list;
                      return ordered.length ? (
                        <optgroup key={when} label={when === "upcoming" ? "Coming up" : "Already happened"}>
                          {ordered.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.label}
                              {e.series ? ` [${e.series}]` : ""}
                            </option>
                          ))}
                        </optgroup>
                      ) : null;
                    })}
                  </select>
                </label>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="btn-secondary px-3 py-2 disabled:opacity-50" disabled={!eventMatch || counting} onClick={countWhoCame}>
                  {counting ? "Counting…" : "Count who came (dry run)"}
                </button>
                {cameNow !== null && (
                  <span className="text-sm font-bold">
                    {cameNow === 0 ? "Nobody yet. It goes to people as they come." : `${cameNow.toLocaleString("en-US")} ${cameNow === 1 ? "member has" : "members have"} earned it so far.`}
                  </span>
                )}
              </div>
            </div>
          )}
        </section>

        <section data-art className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="font-bold">Start from</h2>
          <p className="text-sm text-[var(--muted)]">A remix of a badge that&apos;s already drawn. Then change anything.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[...STARTERS, ...Object.entries(SERIES1_ART).map(([k, a]) => ({ name: k.replace(/_/g, " "), spec: a.spec }))].map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => setSpec(clone(s.spec))}
                className="flex flex-col items-center gap-1 rounded-[8px] border border-[var(--border)] p-1.5 text-[11px] hover:border-[var(--foreground)]"
              >
                <Thumb spec={s.spec} />
                {s.name}
              </button>
            ))}
          </div>
        </section>

        <section data-art className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="font-bold">Form</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {FORM_IDS.map((id) => (
              <button key={id} type="button" onClick={() => setForm(id)} className={`chip ${formId === id ? "chip-selected" : ""}`} aria-pressed={formId === id}>
                {FORM_INFO[id].label}
              </button>
            ))}
          </div>
          {FORM_INFO[formId].shapes && (
            <div className="mt-3">
              <span className={label}>Shape</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {SHAPE_IDS.map((sh) => (
                  <button key={sh} type="button" onClick={() => setFormOpt("shape", sh)} className={`chip ${(formOpts as FormOpts).shape === sh ? "chip-selected" : ""}`}>
                    {sh}
                  </button>
                ))}
              </div>
            </div>
          )}
          {FORM_INFO[formId].colors.map((k) => (
            <div key={k} className="mt-3">
              <span className={label}>{k === "fill" ? "Color" : k === "edge" ? "Edge" : k === "stitch" ? "Stitching" : "Ribbon tails"}</span>
              <div className="mt-1">
                <Swatches value={(formOpts as FormOpts)[k] as string | undefined} onPick={(hex) => setFormOpt(k, hex)} label={k} />
              </div>
            </div>
          ))}
          <label className={`${label} mt-3`} htmlFor="form-label">
            What it is (on the catalog)
          </label>
          <input id="form-label" className={input} maxLength={30} value={formLabel ?? FORM_INFO[formId].label} onChange={(e) => setFormLabel(e.target.value)} />
        </section>

        <section data-art className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="font-bold">Parts</h2>
          <ul className="mt-2 space-y-3">
            {parts.map(([id, o = {}], i) => (
              <li key={`${id}-${i}`} className="rounded-[8px] border border-[var(--border)] p-3">
                <div className="flex items-center gap-3">
                  <Thumb spec={{ form: ["none"], parts: [[id, { ...o, x: 50, y: 50, s: 1, r: 0 }]] }} size={40} />
                  <span className="font-bold">{id}</span>
                  <span className="ml-auto flex gap-1">
                    <button type="button" className="chip" onClick={() => movePart(i, -1)} aria-label="Draw it further back">
                      ↑
                    </button>
                    <button type="button" className="chip" onClick={() => movePart(i, 1)} aria-label="Draw it further forward">
                      ↓
                    </button>
                    <button type="button" className="chip" onClick={() => removePart(i)}>
                      Remove
                    </button>
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(
                    [
                      ["x", "Across", 0, 100, 1, 50],
                      ["y", "Down", 0, 100, 1, 50],
                      ["s", "Size", 0.3, 1.6, 0.02, 1],
                      ["r", "Turn", -45, 45, 1, 0],
                    ] as const
                  ).map(([k, l, min, max, step, dflt]) => (
                    <label key={k} className="text-xs">
                      {l}
                      <input type="range" className="w-full" min={min} max={max} step={step} value={(o as PartOpts)[k] ?? dflt} onChange={(e) => setPart(i, { [k]: Number(e.target.value) })} />
                    </label>
                  ))}
                </div>
                {PART_TEXT[id] !== undefined && (
                  <label className="mt-2 block text-xs">
                    Words (up to {PART_TEXT[id]})
                    <input className={input} maxLength={PART_TEXT[id]} value={o.t ?? ""} onChange={(e) => setPart(i, { t: e.target.value.toUpperCase().replace(/[^A-Z0-9 .'&!?#-]/g, "") })} />
                  </label>
                )}
                {PART_COLOR.includes(id) && (
                  <div className="mt-2">
                    <Swatches value={o.c} onPick={(hex) => setPart(i, { c: hex, ...(id === "crown" ? { c2: hex } : {}) })} label={`${id} color`} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select className="rounded-[8px] border border-[var(--border)] bg-[var(--background)] px-3 py-2" value={addPart} onChange={(e) => setAddPart(e.target.value as PartId)} aria-label="Part to add">
              {PART_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-secondary px-3 py-2"
              disabled={parts.length >= 8}
              onClick={() => setSpec({ form: spec.form, parts: [...parts, PART_TEXT[addPart] !== undefined ? [addPart, { t: addPart === "plate" ? "NAME" : "1" }] : [addPart]] })}
            >
              Add part
            </button>
          </div>
        </section>

        <section className="space-y-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="font-bold">{ruleType === "event" ? "Name and points" : "Name and rule"}</h2>
          <label className={label} htmlFor="badge-name">
            Name
          </label>
          <input id="badge-name" className={input} maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder="The Usual Spot" />
          <label className={label} htmlFor="badge-flavor">
            Flavor text
          </label>
          <input id="badge-flavor" className={input} maxLength={80} value={flavor} onChange={(e) => setFlavor(e.target.value)} placeholder="Same stool, every Friday." />
          {ruleType !== "event" && (
            <>
              <label className={label} htmlFor="badge-rule">
                How it&apos;s earned
              </label>
              <select id="badge-rule" className={input} value={ruleType} onChange={(e) => setRuleType(e.target.value as RuleType)}>
                {RULE_TYPES.filter((t) => t !== "event").map((t) => (
                  <option key={t} value={t}>
                    {RULE_INFO[t].label}
                  </option>
                ))}
              </select>
              <p className="text-sm text-[var(--muted)]">{RULE_INFO[ruleType].about}</p>
            </>
          )}
          {ruleType === "visit_count" && (
            <label className={label}>
              Which check-in
              <input className={input} type="number" min={2} value={count} onChange={(e) => setCount(e.target.value)} />
            </label>
          )}
          {ruleType === "week_streak" && (
            <label className={label}>
              Weeks in a row
              <input className={input} type="number" min={2} value={weeks} onChange={(e) => setWeeks(e.target.value)} />
            </label>
          )}
          {ruleType === "checkin_time" && (
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>
                From
                <input className={input} type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className={label}>
                Before
                <input className={input} type="time" value={before} onChange={(e) => setBefore(e.target.value)} />
              </label>
            </div>
          )}
          <label className={label}>
            Points when earned
            <input className={input} type="number" min={0} max={1000} value={points} onChange={(e) => setPoints(e.target.value)} />
          </label>
        </section>
      </div>

      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <div className="badge-face badge-svg" dangerouslySetInnerHTML={{ __html: preview }} />
        <div className="flex items-end justify-center gap-3">
          {[72, 40, 24].map((s) => (
            <Thumb key={s} spec={spec} size={s} />
          ))}
        </div>
        {error && (
          <p className="text-sm font-bold text-[var(--accent)]" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="btn-primary w-full px-4 py-3 disabled:opacity-50" disabled={pending || name.trim().length < 2 || (ruleType === "event" && !eventMatch)} onClick={save}>
          {pending
            ? "Saving…"
            : ruleType === "event"
              ? `Create and award${cameNow ? ` to ${cameNow.toLocaleString("en-US")}` : ""} · #${String(nextNumber).padStart(2, "0")}`
              : `Add it as Series 1 · #${String(nextNumber).padStart(2, "0")}`}
        </button>
      </aside>
    </div>
  );
}

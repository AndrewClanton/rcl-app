"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ConfirmModal";
import type { CampaignRow } from "@/lib/email/campaign";
import type { ComposerOptions } from "@/lib/email/render-data";
import { BLOCK_CHOICES, newBlock, referencedIds, renderCampaign, type Block, type BlockType, type CampaignContent, type RenderData } from "@/lib/email/render";
import { lintCampaign } from "@/lib/email/lint";
import { CONSENT_CHOICES, PRESETS, RULE_CHOICES, defaultRule, describeRule } from "@/lib/email/rules";
import { CATEGORY_LABEL, CONSENT_LABEL, EXCLUSION_LABEL, PREF_CATEGORIES, type Audience, type Category, type ConsentSource, type Exclusion, type Rule, type RuleKey } from "@/lib/email/types";
import { rangeLabel, whenLabel } from "@/lib/email/format";
import { countAudience, lintCampaignNow, previewData, saveCampaign, scheduleCampaign, sendCampaignTest, sendNextWave, unscheduleCampaign, type CampaignDraft } from "../actions";

// The composer: who it goes to (with a live count and the reasons people
// are left out), what it says (the lineup builds itself from the
// showtimes; everything else is blocks), a live preview at desktop and
// phone width with the inbox line and the plain-text version, a test to
// yourself, and scheduling. The preview renders in the browser with the
// same code the server sends with, but the server always renders the
// email again from the saved campaign: nothing is sent from this page's HTML.

type Msg = { ok: boolean; text: string } | null;

const input = "rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
const DAY_CHOICES = [1, 2, 3, 4, 5, 6, 7, 10, 14];

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

// ---------- one segment rule ----------
function RuleEditor({ rule, onChange, onRemove, campaigns }: { rule: Rule; onChange: (r: Rule) => void; onRemove: () => void; campaigns: { id: string; name: string }[] }) {
  const num = (v: number, set: (n: number) => void, min = 1, max = 365) => (
    <input type="number" className={`${input} w-20`} min={min} max={max} value={v} onChange={(e) => set(Math.max(min, Math.min(max, Math.floor(Number(e.target.value)) || min)))} />
  );
  let params: React.ReactNode = null;
  switch (rule.r) {
    case "tier":
      params = (
        <select className={input} value={rule.v} onChange={(e) => onChange({ ...rule, v: e.target.value as "Insiders" | "Insiders+" })}>
          <option value="Insiders">Free Insiders</option>
          <option value="Insiders+">Insiders+</option>
        </select>
      );
      break;
    case "consent":
      params = (
        <span className="flex flex-wrap gap-2">
          {CONSENT_CHOICES.map((s: ConsentSource) => (
            <label key={s} className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={rule.v.includes(s)} onChange={(e) => onChange({ ...rule, v: e.target.checked ? [...rule.v, s] : rule.v.filter((x) => x !== s) })} />
              {CONSENT_LABEL[s]}
            </label>
          ))}
        </span>
      );
      break;
    case "joined_within":
    case "birthday_within":
    case "lapsed":
    case "clicked_within":
    case "engaged":
      params = <span className="flex items-center gap-1 text-xs">{num(rule.days, (n) => onChange({ ...rule, days: n }))} days</span>;
      break;
    case "visit_days":
    case "archive_fans":
    case "paid_tickets":
      params = (
        <span className="flex items-center gap-1 text-xs">
          at least {num(rule.min, (n) => onChange({ ...rule, min: n }), 1, 50)} in {num(rule.within, (n) => onChange({ ...rule, within: n }))} days
        </span>
      );
      break;
    case "genre":
      params = (
        <span className="flex flex-wrap items-center gap-1 text-xs">
          <input className={`${input} w-28`} value={rule.v} onChange={(e) => onChange({ ...rule, v: e.target.value.slice(0, 40) })} />
          at least {num(rule.min, (n) => onChange({ ...rule, min: n }), 1, 50)} in {num(rule.within, (n) => onChange({ ...rule, within: n }))} days
        </span>
      );
      break;
    case "bar":
      params = (
        <span className="flex flex-wrap items-center gap-1 text-xs">
          <select className={input} value={rule.v} onChange={(e) => onChange({ ...rule, v: e.target.value as "alcohol" | "coffee" | "food" })}>
            <option value="alcohol">Bar</option>
            <option value="coffee">Coffee bar</option>
            <option value="food">Kitchen</option>
          </select>
          at least {num(rule.min, (n) => onChange({ ...rule, min: n }), 1, 50)} in {num(rule.within, (n) => onChange({ ...rule, within: n }))} days
        </span>
      );
      break;
    case "clicked_campaign":
    case "received_campaign":
      params = (
        <select className={input} value={rule.id} onChange={(e) => onChange({ ...rule, id: e.target.value })}>
          <option value="">Pick an email…</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      );
      break;
    case "has_login":
    case "old_site":
      params = (
        <select className={input} value={rule.v ? "yes" : "no"} onChange={(e) => onChange({ ...rule, v: e.target.value === "yes" })}>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      );
      break;
    default:
      params = null;
  }
  return (
    <li className="flex flex-wrap items-center gap-2 rounded border border-[var(--border)] p-2">
      <select className={input} value={rule.r} onChange={(e) => onChange(defaultRule(e.target.value as RuleKey))}>
        {RULE_CHOICES.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
      {params}
      <button type="button" className="ml-auto text-xs text-[var(--muted)] hover:text-[var(--danger-text)]" onClick={onRemove}>
        Remove
      </button>
    </li>
  );
}

// ---------- one content block ----------
function BlockEditor({ block, onChange, options, data }: { block: Block; onChange: (b: Block) => void; options: ComposerOptions; data: RenderData }) {
  const text = (label: string, value: string, set: (v: string) => void, max = 300) => (
    <label className="block text-xs">
      <span className="text-[var(--muted)]">{label}</span>
      <input className={`${input} mt-0.5 w-full`} value={value} maxLength={max} onChange={(e) => set(e.target.value)} />
    </label>
  );
  switch (block.t) {
    case "hero":
      return (
        <div className="grid gap-2 sm:grid-cols-3">
          {text("Small line on top", block.eyebrow ?? "", (v) => onChange({ ...block, eyebrow: v }), 60)}
          {text("Headline", block.headline, (v) => onChange({ ...block, headline: v }), 90)}
          {text("Under it", block.sub ?? "", (v) => onChange({ ...block, sub: v }), 160)}
        </div>
      );
    case "paragraph":
      return (
        <textarea
          className={`${input} w-full`}
          rows={4}
          maxLength={3000}
          value={block.text}
          placeholder="Plain text. A blank line starts a new paragraph. {first name} fills in their name."
          onChange={(e) => onChange({ ...block, text: e.target.value })}
        />
      );
    case "button":
      return (
        <div className="grid gap-2 sm:grid-cols-3">
          {text("Label", block.label, (v) => onChange({ ...block, label: v }), 40)}
          {text("Goes to (/showtimes, /membership#join, or https://…)", block.link, (v) => onChange({ ...block, link: v }), 300)}
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={block.primary !== false} onChange={(e) => onChange({ ...block, primary: e.target.checked })} /> The main (red) button
          </label>
        </div>
      );
    case "filmCard":
      return (
        <select className={input} value={block.movieId} onChange={(e) => onChange({ ...block, movieId: e.target.value })}>
          <option value="">Pick a film…</option>
          {options.films
            .filter((f) => !f.archive)
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
        </select>
      );
    case "archiveSection": {
      const archive = options.films.filter((f) => f.archive);
      return (
        <div className="text-xs">
          <p className="mb-1 text-[var(--muted)]">Members only, with the &ldquo;please don&apos;t post these&rdquo; note. Leave all unticked to include every archive film in the dates.</p>
          <div className="flex flex-wrap gap-3">
            {archive.map((f) => (
              <label key={f.id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={(block.movieIds ?? []).includes(f.id)}
                  onChange={(e) => onChange({ ...block, movieIds: e.target.checked ? [...(block.movieIds ?? []), f.id] : (block.movieIds ?? []).filter((x) => x !== f.id) })}
                />
                {f.title}
              </label>
            ))}
            {archive.length === 0 && <span className="text-[var(--muted)]">No archive films in the next two weeks.</span>}
          </div>
        </div>
      );
    }
    case "eventRow":
      return (
        <select className={input} value={block.houseEventId} onChange={(e) => onChange({ ...block, houseEventId: e.target.value })}>
          <option value="">Pick a house event…</option>
          {options.houseEvents.map((h) => (
            <option key={h.id} value={h.id}>
              {h.title} · {whenLabel(h.startsAt)}
            </option>
          ))}
        </select>
      );
    case "barNote":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <select className={input} value={block.menuItemId ?? ""} onChange={(e) => onChange({ ...block, menuItemId: e.target.value || null })}>
            <option value="">No menu item</option>
            {options.menuItems.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {text("One line", block.line, (v) => onChange({ ...block, line: v }), 200)}
        </div>
      );
    case "perks":
      return (
        <select className={input} value={block.kind} onChange={(e) => onChange({ ...block, kind: e.target.value as "insiders" | "plus" })}>
          <option value="insiders">What Insiders get</option>
          <option value="plus">Insiders+ (ink panel)</option>
        </select>
      );
    case "ticketStub":
      return (
        <div className="grid gap-2 sm:grid-cols-3">
          {text("Label", block.label, (v) => onChange({ ...block, label: v }), 40)}
          {text("Big line", block.big, (v) => onChange({ ...block, big: v }), 30)}
          {text("Under it", block.sub ?? "", (v) => onChange({ ...block, sub: v }), 160)}
        </div>
      );
    case "signoff":
      return text("Signed", block.from ?? "", (v) => onChange({ ...block, from: v }), 60);
    case "lineup":
      return <p className="text-xs text-[var(--muted)]">Now showing, the film archive (members only) and Also at the Royale, from {rangeLabel(data.range.start, data.range.days)}. Pick films and events above.</p>;
    case "claim":
      return <p className="text-xs text-[var(--muted)]">Their personal &ldquo;Set my password&rdquo; link (good for 30 days), or &ldquo;Open my account&rdquo; if they already have a login.</p>;
    case "memberCard":
      return <p className="text-xs text-[var(--muted)]">An &ldquo;Open my member card&rdquo; button.</p>;
    case "ticketSpend":
      return <p className="text-xs text-[var(--muted)]">Their own paid tickets and spend in the last 30 days (for the Insiders+ upsell).</p>;
    case "divider":
      return null;
    case "design":
      return <p className="text-xs text-[var(--muted)]">One of the ready-made emails. Send it from Email &rarr; Ready to send.</p>;
  }
}

export default function Composer({
  sendKey,
  campaign,
  initialData,
  options,
  canSend,
  gate,
  sender,
  myEmail,
  myFirstName,
  seedCount,
  suggested,
  lastWaveProblem,
}: {
  sendKey: string;
  campaign: CampaignRow;
  initialData: RenderData;
  options: ComposerOptions;
  canSend: boolean;
  gate: { ok: true } | { ok: false; reason: string };
  sender: { from: string | null; ready: boolean; problem: string | null };
  myEmail: string;
  myFirstName: string | null;
  seedCount: number;
  suggested: { date: string; time: string; label: string };
  lastWaveProblem: string | null;
}) {
  const router = useRouter();
  const c = campaign;
  const [name, setName] = useState(c.name);
  const [subject, setSubject] = useState(c.subject);
  const [preheader, setPreheader] = useState(c.preheader ?? "");
  const [category, setCategory] = useState<Category>(c.category);
  const [content, setContent] = useState<CampaignContent>(c.content?.blocks ? c.content : { ...c.content, blocks: [] });
  const [audience, setAudience] = useState<Audience>(c.audience?.include ? c.audience : { include: [{ r: "all" }] });
  const [holdout, setHoldout] = useState(c.holdout_pct);
  const [data, setData] = useState<RenderData>(initialData);
  const [dirty, setDirty] = useState(false);
  const [width, setWidth] = useState<"desktop" | "phone" | "text">("desktop");
  const [sample, setSample] = useState(myFirstName ?? "Sam");
  const [count, setCount] = useState<{ willSend: number; heldOut: number; excluded: Partial<Record<Exclusion, number>>; considered: number } | null>(null);
  const [counting, setCounting] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const [seeds, setSeeds] = useState(false);
  const [when, setWhen] = useState<"now" | "at">("at");
  const [date, setDate] = useState(suggested.date);
  const [time, setTime] = useState(suggested.time);
  const [sendAgain, setSendAgain] = useState(false);
  const [confirm, setConfirm] = useState<null | "schedule" | "wave">(null);
  const [waveSize, setWaveSize] = useState(150);
  const [override, setOverride] = useState("");

  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };
  const setContentD = edit(setContent);
  const setAudienceD = edit(setAudience);

  // ---------- data for the preview ----------
  const dataKey = JSON.stringify({ l: content.lineup ? { s: content.lineup.start, d: content.lineup.days } : null, w: content.window ?? null, ids: referencedIds(content) });
  const firstKey = useRef(dataKey);
  useEffect(() => {
    if (dataKey === firstKey.current) return;
    const t = setTimeout(async () => {
      const r = await previewData(content).catch(() => null);
      if (r?.ok) setData(r.data);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  // ---------- the live count ----------
  const countKey = JSON.stringify({ audience, holdout });
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      setCounting(true);
      const r = await countAudience(c.id, audience, holdout).catch(() => null);
      if (!live) return;
      setCounting(false);
      if (r?.ok) setCount({ willSend: r.willSend, heldOut: r.heldOut, excluded: r.excluded, considered: r.considered });
    }, 700);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countKey]);

  // ---------- the preview and the live lint ----------
  const draft: CampaignDraft = { name, subject, preheader, category, content, audience, holdoutPct: holdout };
  const rendered = useMemo(
    () =>
      renderCampaign({ kind: c.kind, category, subject, preheader, content }, data, { firstName: sample.trim() || null, consentSource: "indy_yes", tier: "Insiders", hasLogin: false, email: myEmail || "sam@example.com", claimUrl: "https://example.com/account/claim", ticketSpend30: 24, paidTickets30: 3 }, {
        preferencesUrl: "#preferences",
        unsubscribeUrl: "#unsubscribe",
        href: (u) => u,
      }),
    [c.kind, category, subject, preheader, content, data, sample, myEmail],
  );
  const lint = useMemo(
    () =>
      lintCampaign({
        subject: rendered.subject,
        preheader: rendered.preheader,
        bodyTexts: rendered.meta.bodyTexts,
        primaryButtons: rendered.meta.primaryButtons,
        plainFilmTitles: rendered.meta.plainFilms,
        restrictedTitles: options.restrictedTitles,
        htmlBytes: new TextEncoder().encode(rendered.html).length,
      }),
    [rendered, options.restrictedTitles],
  );

  function run(label: string, fn: () => Promise<Msg>) {
    setMsg({ ok: true, text: `${label}…` });
    start(async () => {
      const m = await fn().catch((): Msg => ({ ok: false, text: "Couldn't reach the server. Reload the page to see what happened before trying again." }));
      setMsg(m);
      router.refresh();
    });
  }

  async function save(): Promise<Msg | null> {
    const r = await saveCampaign(c.id, draft);
    if (!r.ok) return { ok: false, text: r.error };
    setDirty(false);
    return null;
  }

  const lineup = c.kind === "lineup";
  const showWindow = !lineup && (content.window || content.blocks.some((b) => b.t === "filmCard" || b.t === "archiveSection"));
  const range = content.lineup ?? content.window ?? { start: data.range.start, days: data.range.days };
  const isAutomation = c.kind === "automation";
  const inboxFrom = (sender.from ?? "Royale Cinema Lounge").replace(/\s*<.*>$/, "");

  function setRange(start: string, days: number) {
    if (lineup) setContentD({ ...content, lineup: { skipMovieIds: [], skipHappeningIds: [], featuredMovieId: null, ...content.lineup, start, days } });
    else setContentD({ ...content, window: { start, days } });
  }

  function moveBlock(i: number, d: -1 | 1) {
    const b = [...content.blocks];
    const j = i + d;
    if (j < 0 || j >= b.length) return;
    [b[i], b[j]] = [b[j], b[i]];
    setContentD({ ...content, blocks: b });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        {/* ---------- audience ---------- */}
        <Section
          title="Who gets it"
          aside={
            <span className="text-sm">
              {counting ? (
                "Counting…"
              ) : count ? (
                <>
                  <strong>{count.willSend.toLocaleString()}</strong> would get it{count.heldOut ? `, ${count.heldOut} held back` : ""}
                </>
              ) : (
                "—"
              )}
            </span>
          }
        >
          {!isAutomation && (
            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-xs text-[var(--muted)]">Start from a segment</span>
              <select
                className={`${input} w-full`}
                value=""
                onChange={(e) => {
                  const p = PRESETS.find((x) => x.key === e.target.value);
                  if (p) setAudienceD({ ...p.audience, limit: audience.limit });
                }}
              >
                <option value="">Pick a segment…</option>
                {PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="text-xs text-[var(--muted)]">Everyone who matches all of these:</div>
          <ul className="mt-1 space-y-1.5">
            {audience.include.map((r, i) => (
              <RuleEditor
                key={i}
                rule={r}
                campaigns={options.campaigns.filter((x) => x.id !== c.id)}
                onChange={(n) => setAudienceD({ ...audience, include: audience.include.map((x, j) => (j === i ? n : x)) })}
                onRemove={() => setAudienceD({ ...audience, include: audience.include.filter((_, j) => j !== i) })}
              />
            ))}
          </ul>
          <button type="button" className="mt-1 text-xs font-semibold text-[var(--accent)]" onClick={() => setAudienceD({ ...audience, include: [...audience.include, { r: "engaged", days: 60 }] })}>
            + Add a rule
          </button>
          <div className="mt-3 text-xs text-[var(--muted)]">…except anyone who matches any of these:</div>
          <ul className="mt-1 space-y-1.5">
            {(audience.exclude ?? []).map((r, i) => (
              <RuleEditor
                key={i}
                rule={r}
                campaigns={options.campaigns.filter((x) => x.id !== c.id)}
                onChange={(n) => setAudienceD({ ...audience, exclude: (audience.exclude ?? []).map((x, j) => (j === i ? n : x)) })}
                onRemove={() => setAudienceD({ ...audience, exclude: (audience.exclude ?? []).filter((_, j) => j !== i) })}
              />
            ))}
          </ul>
          <button type="button" className="mt-1 text-xs font-semibold text-[var(--accent)]" onClick={() => setAudienceD({ ...audience, exclude: [...(audience.exclude ?? []), { r: "tier", v: "Insiders+" }] })}>
            + Leave some out
          </button>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              Hold back
              <select className={input} value={holdout} onChange={(e) => edit(setHoldout)(Number(e.target.value))}>
                {[0, 5, 10, 20].map((n) => (
                  <option key={n} value={n}>
                    {n}%
                  </option>
                ))}
              </select>
              <span className="text-xs text-[var(--muted)]">a random slice that doesn&apos;t get it, to measure the honest lift</span>
            </label>
            {!isAutomation && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={audience.order === "trust"} onChange={(e) => setAudienceD({ ...audience, order: e.target.checked ? "trust" : undefined })} />
                Most trusted first (warm-up order)
              </label>
            )}
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Always left out: anyone with email off, this kind of email off, paused, gone quiet, on the never-mail list, or already at their limit (never two in 20 hours, at most 2 a week
            and 8 a month).
          </p>
          {count && Object.keys(count.excluded).length > 0 && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-[var(--muted)]">Not sending to ({Object.values(count.excluded).reduce((a, b) => (a ?? 0) + (b ?? 0), 0)} of {count.considered})</summary>
              <ul className="mt-1 grid gap-0.5 sm:grid-cols-2">
                {(Object.entries(count.excluded) as [Exclusion, number][])
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, n]) => (
                    <li key={k} className="flex justify-between gap-2">
                      <span>{EXCLUSION_LABEL[k]}</span>
                      <span className="tabular-nums">{n}</span>
                    </li>
                  ))}
              </ul>
            </details>
          )}
          <p className="mt-2 text-xs text-[var(--muted)]">{audience.include.map((r) => describeRule(r, (id) => options.campaigns.find((x) => x.id === id)?.name ?? null)).join(" · ")}</p>
        </Section>

        {/* ---------- content ---------- */}
        <Section title="What it says">
          <div className="grid gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-[var(--muted)]">Name (just for us)</span>
              <input className={`${input} w-full`} value={name} maxLength={120} onChange={(e) => edit(setName)(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-[var(--muted)]">Subject ({subject.length}/70). This year&apos;s titles only. {"{first name}"} works here.</span>
              <input className={`${input} w-full`} value={subject} maxLength={150} onChange={(e) => edit(setSubject)(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-[var(--muted)]">Preview text (the grey line after the subject)</span>
              <input className={`${input} w-full`} value={preheader} maxLength={200} onChange={(e) => edit(setPreheader)(e.target.value)} />
            </label>
            {c.kind === "announcement" && (
              <label className="text-sm">
                <span className="mb-1 block text-xs text-[var(--muted)]">Kind of email (people who turned this kind off won&apos;t get it)</span>
                <select className={input} value={category} onChange={(e) => edit(setCategory)(e.target.value as Category)}>
                  {PREF_CATEGORIES.map((k) => (
                    <option key={k} value={k}>
                      {CATEGORY_LABEL[k].label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {(lineup || showWindow) && (
            <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-[var(--border)] pt-3">
              <label className="text-sm">
                <span className="mb-1 block text-xs text-[var(--muted)]">Showtimes from</span>
                <input type="date" className={input} value={range.start} onChange={(e) => setRange(e.target.value, range.days)} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-[var(--muted)]">For</span>
                <select className={input} value={range.days} onChange={(e) => setRange(range.start, Number(e.target.value))}>
                  {DAY_CHOICES.map((d) => (
                    <option key={d} value={d}>
                      {d} {d === 1 ? "day" : "days"}
                    </option>
                  ))}
                </select>
              </label>
              <span className="pb-2 text-sm text-[var(--muted)]">{rangeLabel(data.range.start, data.range.days)}</span>
            </div>
          )}

          {lineup && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-[var(--muted)]">Films (untick to leave one out)</div>
                {data.films.length === 0 && <p className="text-sm text-[var(--muted)]">No showtimes in these dates.</p>}
                <ul className="space-y-1">
                  {data.films.map((f) => {
                    const skip = content.lineup?.skipMovieIds ?? [];
                    return (
                      <li key={f.movieId}>
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={!skip.includes(f.movieId)}
                            onChange={(e) =>
                              setContentD({
                                ...content,
                                lineup: { ...(content.lineup ?? { start: range.start, days: range.days, skipHappeningIds: [] }), skipMovieIds: e.target.checked ? skip.filter((x) => x !== f.movieId) : [...skip, f.movieId] },
                              })
                            }
                          />
                          <span>
                            {f.title} <span className="text-[var(--muted)]">· {f.showtimes.length}</span>
                            {f.archive && <span className="ml-1 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--muted)]">archive · members only</span>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <label className="mt-2 block text-sm">
                  <span className="mb-1 block text-xs text-[var(--muted)]">This week&apos;s pick (listed first)</span>
                  <select
                    className={input}
                    value={content.lineup?.featuredMovieId ?? ""}
                    onChange={(e) => setContentD({ ...content, lineup: { ...(content.lineup ?? { start: range.start, days: range.days, skipMovieIds: [], skipHappeningIds: [] }), featuredMovieId: e.target.value || null } })}
                  >
                    <option value="">None</option>
                    {data.films
                      .filter((f) => !f.archive)
                      .map((f) => (
                        <option key={f.movieId} value={f.movieId}>
                          {f.title}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div>
                <div className="mb-1 text-xs text-[var(--muted)]">Also at the Royale (house events only, never private bookings)</div>
                {data.happenings.length === 0 && <p className="text-sm text-[var(--muted)]">No house events in these dates.</p>}
                <ul className="space-y-1">
                  {data.happenings.map((h) => {
                    const skip = content.lineup?.skipHappeningIds ?? [];
                    return (
                      <li key={h.id}>
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={!skip.includes(h.id)}
                            onChange={(e) =>
                              setContentD({
                                ...content,
                                lineup: { ...(content.lineup ?? { start: range.start, days: range.days, skipMovieIds: [] }), skipHappeningIds: e.target.checked ? skip.filter((x) => x !== h.id) : [...skip, h.id] },
                              })
                            }
                          />
                          <span>
                            {h.title} <span className="text-[var(--muted)]">· {whenLabel(h.startsAt)}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}

          <div className="mt-4 border-t border-[var(--border)] pt-3">
            <div className="mb-2 text-xs text-[var(--muted)]">Blocks, top to bottom. The footer (address, why they get it, preferences and unsubscribe) is always added.</div>
            <ol className="space-y-2">
              {content.blocks.map((b, i) => (
                <li key={i} className="rounded border border-[var(--border)] p-2">
                  <div className="mb-1 flex items-center gap-2 text-xs">
                    <strong>{BLOCK_CHOICES.find((x) => x.t === b.t)?.label ?? b.t}</strong>
                    <span className="ml-auto flex gap-2 text-[var(--muted)]">
                      <button type="button" onClick={() => moveBlock(i, -1)} aria-label="Move up">
                        ▲
                      </button>
                      <button type="button" onClick={() => moveBlock(i, 1)} aria-label="Move down">
                        ▼
                      </button>
                      <button type="button" className="hover:text-[var(--danger-text)]" onClick={() => setContentD({ ...content, blocks: content.blocks.filter((_, j) => j !== i) })}>
                        Remove
                      </button>
                    </span>
                  </div>
                  <BlockEditor block={b} options={options} data={data} onChange={(n) => setContentD({ ...content, blocks: content.blocks.map((x, j) => (j === i ? n : x)) })} />
                </li>
              ))}
            </ol>
            <select
              className={`${input} mt-2`}
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                setContentD({ ...content, blocks: [...content.blocks, newBlock(e.target.value as BlockType)] });
              }}
            >
              <option value="">+ Add a block…</option>
              {BLOCK_CHOICES.map((b) => (
                <option key={b.t} value={b.t}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
        </Section>

        {/* ---------- checks ---------- */}
        {(lint.errors.length > 0 || lint.warnings.length > 0) && (
          <Section title="Before it can go">
            <ul className="space-y-1 text-sm">
              {lint.errors.map((e) => (
                <li key={e} className="text-[var(--danger-text)]">
                  ✕ {e}
                </li>
              ))}
              {lint.warnings.map((w) => (
                <li key={w} className="text-[var(--warn-text)]">
                  ! {w}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ---------- save, test, schedule ---------- */}
        <Section title={isAutomation ? "Save" : "Test and send"}>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-secondary !px-4 !py-2 text-sm" disabled={pending || !dirty} onClick={() => run("Saving", async () => (await save()) ?? { ok: true, text: "Saved." })}>
              {dirty ? "Save" : "Saved"}
            </button>
            <button
              type="button"
              className="btn-secondary !px-4 !py-2 text-sm"
              disabled={pending || !myEmail}
              onClick={() =>
                run("Sending the test", async () => {
                  const s = await save();
                  if (s) return s;
                  const r = await sendCampaignTest(c.id, seeds);
                  return r.ok ? { ok: true, text: `Test sent to ${r.sentTo === 1 ? myEmail : `${r.sentTo} inboxes`}.` } : { ok: false, text: r.error };
                })
              }
            >
              Send a test to me
            </button>
            {!gate.ok && <span className="text-xs text-[var(--muted)]">Test copies still go to your own inbox, even with sending off.</span>}
            {seedCount > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={seeds} onChange={(e) => setSeeds(e.target.checked)} /> and the {seedCount} seed inboxes
              </label>
            )}
          </div>
          {myEmail && <p className="mt-1 text-xs text-[var(--muted)]">Tests go to {myEmail}, rendered from the saved email.</p>}

          {!isAutomation && (
            <div className="mt-4 border-t border-[var(--border)] pt-3">
              {!canSend ? (
                <p className="text-sm text-[var(--muted)]">An admin or owner schedules and sends to the list. Save it and let them know it&apos;s ready.</p>
              ) : c.status === "scheduled" ? (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span>
                    Scheduled for <strong>{c.scheduled_for ? whenLabel(c.scheduled_for) : "the next run"}</strong>.
                  </span>
                  {c.recipients === null && (
                    <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" disabled={pending} onClick={() => run("Unscheduling", async () => {
                      const r = await unscheduleCampaign(c.id);
                      return r.ok ? { ok: true, text: "Back to a draft." } : { ok: false, text: r.error };
                    })}>
                      Unschedule
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-end gap-3 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={when === "at"} onChange={() => setWhen("at")} /> At
                    </label>
                    <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} disabled={when !== "at"} />
                    <input type="time" className={input} value={time} step={900} onChange={(e) => setTime(e.target.value)} disabled={when !== "at"} />
                    <span className="pb-2 text-xs text-[var(--muted)]">Central. Suggested: {suggested.label}</span>
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={when === "now"} onChange={() => setWhen("now")} /> Now
                    </label>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">Only 9 AM to 7 PM, Monday to Saturday. Anything outside moves to the next 10:30 AM.</p>
                  {lineup && (
                    <label className="mt-2 flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={sendAgain} onChange={(e) => setSendAgain(e.target.checked)} /> Send it again anyway, if this week&apos;s lineup already went
                    </label>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button type="button" className="btn-primary !px-4 !py-2 text-sm" disabled={pending || lint.errors.length > 0} onClick={() => setConfirm("schedule")}>
                      {when === "now" ? "Send now" : "Schedule it"}
                    </button>
                    {!gate.ok && <span className="text-xs text-[var(--warn-text)]">It can be scheduled, but won&apos;t go until: {gate.reason}</span>}
                  </div>
                </>
              )}
            </div>
          )}

          {canSend && !isAutomation && c.status !== "scheduled" && (
            <div className="mt-4 border-t border-[var(--border)] pt-3">
              <div className="text-sm font-semibold">Warm-up: send the next wave</div>
              <p className="text-xs text-[var(--muted)]">The next people who haven&apos;t had it, most trusted first. Sends now (within sending hours).</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <select className={input} value={waveSize} onChange={(e) => setWaveSize(Number(e.target.value))}>
                  {[50, 150, 300, 450, 500, 600].map((n) => (
                    <option key={n} value={n}>
                      {n} people
                    </option>
                  ))}
                </select>
                <button type="button" className="btn-secondary !px-4 !py-2 text-sm" disabled={pending || lint.errors.length > 0 || (!!lastWaveProblem && override.trim().length < 5)} onClick={() => setConfirm("wave")}>
                  Send next wave
                </button>
              </div>
              {lastWaveProblem && (
                <div className="mt-2 text-sm">
                  <p className="text-[var(--danger-text)]">{lastWaveProblem} Find out why before the next wave.</p>
                  <input className={`${input} mt-1 w-full`} placeholder="Or type what you checked, to send anyway" value={override} onChange={(e) => setOverride(e.target.value)} />
                </div>
              )}
            </div>
          )}
          {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"}`}>{msg.text}</p>}
          {!sender.ready && <p className="mt-2 text-xs text-[var(--muted)]">{sender.problem}</p>}
        </Section>
      </div>

      {/* ---------- preview ---------- */}
      <div className="space-y-3 xl:sticky xl:top-4 xl:self-start">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="text-xs text-[var(--muted)]">In the inbox</div>
          <div className="mt-1 flex items-baseline gap-2 text-sm">
            <strong className="shrink-0">{inboxFrom}</strong>
            <span className="min-w-0 truncate">
              <strong>{rendered.subject}</strong> <span className="text-[var(--muted)]">— {rendered.preheader || "(no preview text)"}</span>
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {(["desktop", "phone", "text"] as const).map((w) => (
            <button key={w} type="button" className={`chip !px-3 !py-1 !text-xs ${width === w ? "chip-selected" : ""}`} onClick={() => setWidth(w)}>
              {w === "desktop" ? "Desktop" : w === "phone" ? "Phone" : "Plain text"}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1 text-xs">
            As
            <input className={`${input} w-24`} value={sample} onChange={(e) => setSample(e.target.value)} />
          </label>
        </div>
        {width === "text" ? (
          <pre className="max-h-[1100px] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-white p-4 text-xs">{rendered.text}</pre>
        ) : (
          <iframe
            title="Email preview"
            srcDoc={rendered.html}
            sandbox=""
            className="mx-auto block h-[1100px] rounded-lg border border-[var(--border)] bg-white"
            style={{ width: width === "phone" ? 390 : "100%" }}
          />
        )}
        <p className="text-xs text-[var(--muted)]">
          {Math.round(new TextEncoder().encode(rendered.html).length / 1024)} KB (Gmail cuts off at 102 KB). Links in the real email are tracked through our own site.
        </p>
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm === "wave" ? `Send a wave of ${waveSize}?` : when === "now" ? `Send to ${count?.willSend ?? "?"} members now?` : `Schedule for ${count?.willSend ?? "?"} members?`}
          description={`"${rendered.subject}"${lint.warnings.length ? ` · ${lint.warnings.length} warning${lint.warnings.length === 1 ? "" : "s"} to check` : " · no warnings"}. ${
            confirm === "wave" || when === "now" ? "It goes out now and can't be taken back." : "Whoever qualifies at send time gets it; you can stop it until then."
          }`}
          confirmLabel={confirm === "wave" ? "Send the wave" : when === "now" ? "Send it" : "Schedule it"}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const what = confirm;
            setConfirm(null);
            run(what === "wave" ? "Sending the wave" : "Scheduling", async () => {
              const s = await save();
              if (s) return s;
              const check = await lintCampaignNow(c.id);
              if (check.ok && check.lint.errors.length) return { ok: false, text: check.lint.errors[0] };
              if (what === "wave") {
                const r = await sendNextWave(c.id, waveSize, override || null);
                return r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error };
              }
              const r = await scheduleCampaign(c.id, { when, date, time, sendKey, sendAgain });
              return r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error };
            });
          }}
        />
      )}
    </div>
  );
}

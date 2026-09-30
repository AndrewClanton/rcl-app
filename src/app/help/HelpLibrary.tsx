"use client";

import { useMemo, useState } from "react";
import TopicContent from "@/components/help/TopicContent";
import { helpTopicsByArea, type HelpArea, type HelpTopic } from "@/lib/help/topics";

// The Help & FAQ list: every entry, grouped by area, with a search box that
// filters as you type. Each entry is an anchor (/help#printers-add), so a
// bubble's "More in Help & FAQ" lands right on it.

const GROUPS = helpTopicsByArea();

const areaId = (area: HelpArea) => `area-${area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

// A training that isn't in the catalog (yet) isn't linked.
function withKnownTraining(t: HelpTopic, titles: Record<string, string>): HelpTopic {
  return t.trainingSlug && !titles[t.trainingSlug] ? { ...t, trainingSlug: undefined } : t;
}

function haystack(t: HelpTopic): string {
  return [t.title, t.area, t.body, ...(t.steps ?? []), ...(t.links ?? []).map((l) => l.label)].join(" ").toLowerCase();
}

export default function HelpLibrary({ trainingTitles }: { trainingTitles: Record<string, string> }) {
  const [query, setQuery] = useState("");
  const words = useMemo(
    () =>
      query
        .toLowerCase()
        .split(/\s+/)
        .map((w) => w.replace(/[^a-z0-9+&/-]/g, ""))
        .filter(Boolean),
    [query],
  );

  const groups = useMemo(() => {
    if (words.length === 0) return GROUPS;
    return GROUPS.map((g) => ({ ...g, topics: g.topics.filter(({ topic }) => words.every((w) => haystack(topic).includes(w))) })).filter((g) => g.topics.length > 0);
  }, [words]);
  const shown = groups.reduce((n, g) => n + g.topics.length, 0);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <label className="block">
          <span className="sr-only">Search help</span>
          <input
            type="search"
            className="input !py-3 !text-base"
            placeholder="Search: printer, tip, refund, par…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </label>
        {words.length > 0 ? (
          <p className="text-sm text-[var(--muted)]" aria-live="polite">
            {shown === 0 ? "Nothing matches that. Try one word, like \"printer\" or \"tab\"." : `${shown} ${shown === 1 ? "answer" : "answers"}`}
          </p>
        ) : (
          <nav aria-label="Help topics by area" className="flex flex-wrap gap-2">
            {GROUPS.map((g) => (
              <a key={g.area} href={`#${areaId(g.area)}`} className="chip !px-3 !py-1.5 !text-sm">
                {g.area}
              </a>
            ))}
          </nav>
        )}
      </div>

      {groups.map((g) => (
        <section key={g.area} id={areaId(g.area)} className="scroll-mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <h2 className="border-b border-[var(--border)] px-5 py-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">{g.area}</h2>
          <div className="divide-y divide-[var(--border)]">
            {g.topics.map(({ key, topic }) => (
              <article key={key} id={key} className="scroll-mt-4 px-5 py-4 target:bg-[var(--warn-bg)]">
                <h3 className="mb-2 flex items-baseline justify-between gap-3 text-[16px] font-semibold leading-snug">
                  <span>{topic.title}</span>
                  <a href={`#${key}`} className="shrink-0 text-xs font-normal text-[var(--muted)] hover:underline" aria-label={`Link to ${topic.title}`}>
                    #
                  </a>
                </h3>
                <TopicContent topicKey={key} topic={withKnownTraining(topic, trainingTitles)} trainingTitle={topic.trainingSlug ? trainingTitles[topic.trainingSlug] : null} helpLink={false} newTab={false} />
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

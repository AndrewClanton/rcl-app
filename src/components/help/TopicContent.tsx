import { helpHref, trainingHref, type HelpLink, type HelpTopic, type HelpTopicKey } from "@/lib/help/topics";

// One help entry's words, steps and "Learn more" links: inside a bubble's
// popover (InfoTip) and on the Help & FAQ page. No hooks, so both server
// and client pages can use it. Colors come from the app's CSS variables, so
// it fits the back office and the register alike.

export function topicLinks(key: HelpTopicKey, topic: HelpTopic, opts: { trainingTitle?: string | null; helpLink?: boolean } = {}): HelpLink[] {
  const links: HelpLink[] = [];
  if (topic.trainingSlug) links.push({ label: opts.trainingTitle ? `Training: ${opts.trainingTitle}` : "Step-by-step training", href: trainingHref(topic.trainingSlug) });
  links.push(...(topic.links ?? []));
  if (opts.helpLink) links.push({ label: "More in Help & FAQ", href: helpHref(key) });
  return links;
}

export default function TopicContent({
  topicKey,
  topic,
  trainingTitle,
  helpLink = true,
  newTab = true,
}: {
  topicKey: HelpTopicKey;
  topic: HelpTopic;
  trainingTitle?: string | null;
  // The "More in Help & FAQ" link (left off on the Help page itself).
  helpLink?: boolean;
  // From a bubble, links open in a new tab, so the register (or a form
  // half filled in, or a printer password shown once) stays put.
  newTab?: boolean;
}) {
  const links = topicLinks(topicKey, topic, { trainingTitle, helpLink });
  return (
    <div className="space-y-3 text-[14px] leading-[1.5]" style={{ color: "var(--foreground)" }}>
      <p>{topic.body}</p>
      {topic.steps && topic.steps.length > 0 && (
        <ol className="list-decimal space-y-1 pl-5 text-[13.5px]">
          {topic.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      {links.length > 0 && (
        <div className="border-t pt-2.5" style={{ borderColor: "var(--border)" }}>
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--muted)" }}>
            Learn more
          </div>
          <ul className="space-y-0.5">
            {links.map((l) => (
              <li key={l.href}>
                {/* Plain <a>: a new tab, or a jump to /help#topic, either way a full load. */}
                <a
                  href={l.href}
                  className="inline-flex min-h-[32px] items-center gap-1 text-[13.5px] font-semibold underline decoration-1 underline-offset-2 hover:no-underline"
                  style={{ color: "var(--accent)" }}
                  {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                >
                  {l.label}
                  {newTab && (
                    <>
                      <span aria-hidden="true">↗</span>
                      <span className="sr-only"> (opens in a new tab)</span>
                    </>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

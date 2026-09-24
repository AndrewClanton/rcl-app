import Link from "next/link";

// Shared frame for the privacy policy and data deletion pages: readable
// measure, a small table of contents, and a draft banner until published.
export default function LegalPage({
  title,
  intro,
  effectiveDate,
  draft,
  sections,
  children,
}: {
  title: string;
  intro: React.ReactNode;
  effectiveDate: string | null;
  draft: boolean;
  sections?: { id: string; title: string }[];
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-2xl">
      {draft && (
        <div className="notice notice-warn mb-8 text-sm">
          <strong>Draft for review.</strong> Only signed-in admins can see this page. It isn&apos;t linked anywhere and search engines are told to
          skip it. It goes public once it&apos;s approved.
        </div>
      )}
      <div className="eyebrow mb-2">Royale Cinema Lounge</div>
      <h1 className="font-display text-4xl leading-tight">{title}</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">Effective {effectiveDate ?? "[date of approval]"}</p>
      <div className="mt-6 text-lg leading-relaxed">{intro}</div>

      {sections && sections.length > 0 && (
        <nav aria-label="On this page" className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">On this page</div>
          <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="hover:text-[var(--accent)] hover:underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="legal mt-10 space-y-10 leading-relaxed [&_h2]:font-display [&_h2]:mb-3 [&_h2]:scroll-mt-28 [&_h2]:text-2xl [&_li]:ml-5 [&_li]:list-disc [&_li+li]:mt-1.5 [&_p+p]:mt-3 [&_p+ul]:mt-3 [&_ul+p]:mt-3">
        {children}
      </div>

      <footer className="mt-14 border-t border-[var(--border)] pt-6 text-sm text-[var(--muted)]">
        Royale Cinema Lounge · 715 E Broadway, Joplin, MO 64801 ·{" "}
        <a href="mailto:info@royalecinemajoplin.com" className="hover:text-[var(--accent)]">
          info@royalecinemajoplin.com
        </a>{" "}
        · 417-281-4172
        <div className="mt-2">
          <Link href="/privacy" className="hover:text-[var(--accent)]">
            Privacy policy
          </Link>
          {" · "}
          <Link href="/data-deletion" className="hover:text-[var(--accent)]">
            Deleting your data
          </Link>
        </div>
      </footer>
    </article>
  );
}

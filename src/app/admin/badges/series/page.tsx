import Link from "next/link";
import { requireManager } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { createAdminClient } from "@/lib/supabase/admin";
import { seriesTags } from "@/lib/badges/events";
import SeriesTagList from "./SeriesTagList";

export const dynamic = "force-dynamic";

// Back office -> Badges -> Series tags: the short list a showing or a
// house event can be tagged with on Showtimes (Trivia, Horror Month...),
// so an event badge can say "came to Trivia" or "came to 5 Trivia nights".
export default async function SeriesTagsPage() {
  await requireManager();
  const db = createAdminClient();
  const [tags, s, h] = await Promise.all([seriesTags(db), db.from("screenings").select("series").not("series", "is", null).limit(10000), db.from("house_events").select("series").not("series", "is", null).limit(10000)]);
  const count = new Map<string, number>();
  for (const r of [...(s.data ?? []), ...(h.data ?? [])]) count.set(r.series as string, (count.get(r.series as string) ?? 0) + 1);
  return (
    <div className="space-y-6">
      <PageHeader area="guests" title="Series tags" purpose="One optional tag on a showing or a house event, picked on Showtimes. Event badges can count them: came to Trivia, came to 5 Trivia nights.">
        <Link href="/admin/badges" className="mt-2 inline-block text-sm font-bold text-[var(--accent)] hover:underline">
          ← All badges
        </Link>
      </PageHeader>
      <SeriesTagList tags={tags.map((t) => ({ ...t, used: count.get(t.name) ?? 0 }))} />
    </div>
  );
}

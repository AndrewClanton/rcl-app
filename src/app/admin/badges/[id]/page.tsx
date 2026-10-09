import Link from "next/link";
import { notFound } from "next/navigation";
import { requireManager } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { defDetail } from "@/lib/badges/server";
import { RULE_INFO } from "@/lib/badges/rules";
import { describeRule } from "@/lib/badges/events";
import AwardForm from "./AwardForm";
import EventAward from "./EventAward";

export const dynamic = "force-dynamic";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

// One badge: its card (front and back of the newest copy), the copies
// minted and its rarity, every holder by serial, and Award by hand.
export default async function BadgeDetailPage({ params }: PageProps<"/admin/badges/[id]">) {
  await requireManager();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await defDetail(id);
  if (!d) notFound();
  const { entry, copies, sample, holders } = d;
  const live = copies.filter((c) => !c.revoked).length;
  const target = entry.def.ruleType === "event" ? await describeRule(entry.def.params) : null;
  return (
    <div className="space-y-6">
      <PageHeader area="guests" title={entry.def.name} purpose={entry.def.flavor || RULE_INFO[entry.def.ruleType].about}>
        <Link href="/admin/badges" className="mt-2 inline-block text-sm font-bold text-[var(--accent)] hover:underline">
          ← All badges
        </Link>
      </PageHeader>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="grid grid-cols-2 gap-3">
          <div className="badge-face badge-svg" dangerouslySetInnerHTML={{ __html: sample?.front ?? entry.front }} />
          {sample ? (
            <div className="badge-face badge-svg" dangerouslySetInnerHTML={{ __html: sample.back }} />
          ) : (
            <div className="grid place-items-center rounded-[8px] border-2 border-dashed border-[var(--border)] p-3 text-center text-sm text-[var(--muted)]">
              The back fills in with the first copy minted.
            </div>
          )}
        </div>

        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Fact k="Copies" v={live.toLocaleString("en-US")} />
            <Fact k="Rarity" v={entry.rarity ?? "None yet"} />
            <Fact k="Set" v={`Series ${entry.def.series} · #${String(entry.def.setNumber).padStart(2, "0")}`} />
            <Fact k="Points" v={`+${entry.def.points}${entry.def.reward ? ` · free ${entry.def.reward}` : ""}`} />
          </dl>
          <p className="text-sm text-[var(--muted)]">
            {RULE_INFO[entry.def.ruleType].label}: {RULE_INFO[entry.def.ruleType].about} Rarity is this badge&apos;s copies over everyone holding any badge ({holders.toLocaleString("en-US")}).
            Art {entry.def.generator}
            {entry.def.formLabel ? ` · ${entry.def.formLabel}` : ""}.
          </p>
          {target && <EventAward defId={entry.def.id} target={target} active={entry.def.active} />}
          <AwardForm defId={entry.def.id} name={entry.def.name} active={entry.def.active} />
        </div>
      </div>

      <section className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
        <h2 className="border-b border-[var(--border)] px-4 py-3 font-bold">Holders by serial</h2>
        {copies.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs tracking-wide text-[var(--muted)] uppercase">
                  <th className="px-4 py-2">Serial</th>
                  <th className="px-4 py-2">Holder</th>
                  <th className="px-4 py-2">Minted</th>
                  <th className="px-4 py-2">Certificate</th>
                </tr>
              </thead>
              <tbody>
                {copies.map((c) => (
                  <tr key={c.code} className={`border-t border-[var(--border)] ${c.revoked ? "text-[var(--muted)] line-through" : ""}`}>
                    <td className="px-4 py-2 font-bold tabular-nums">#{c.serial}</td>
                    <td className="px-4 py-2">
                      {c.memberId ? (
                        <Link href={`/admin/members/${c.memberId}`} className="hover:underline">
                          {c.holder}
                        </Link>
                      ) : (
                        c.holder
                      )}
                      {c.revoked ? " (taken back)" : ""}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{when(c.mintedAt)}</td>
                    <td className="px-4 py-2">
                      <Link href={`/b/${c.code}`} className="font-mono text-[var(--accent)] hover:underline" target="_blank">
                        {c.code}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-4 text-sm text-[var(--muted)]">No copies yet.</p>
        )}
      </section>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3">
      <dt className="text-xs tracking-wide text-[var(--muted)] uppercase">{k}</dt>
      <dd className="mt-0.5 font-bold">{v}</dd>
    </div>
  );
}

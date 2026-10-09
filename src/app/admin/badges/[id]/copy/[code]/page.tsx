import Link from "next/link";
import { notFound } from "next/navigation";
import { requireManager } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { copyDetail } from "@/lib/badges/server";
import VoidForm from "./VoidForm";

export const dynamic = "force-dynamic";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

// One copy of a badge: both sides of its card, who holds it, what's
// happened to it since it was minted, and Void (managers and up). Copies
// are permanent (lib/badges/server.ts, "The permanence rule"): a void
// marks it, never deletes it.
export default async function BadgeCopyPage({ params }: PageProps<"/admin/badges/[id]/copy/[code]">) {
  await requireManager();
  const { id, code } = await params;
  const c = await copyDetail(code);
  if (!c || c.defId !== id) notFound();
  return (
    <div className="space-y-6">
      <PageHeader area="guests" title={`${c.card.name} #${c.serial}`} purpose="One copy: its card, its holder, and its history.">
        <Link href={`/admin/badges/${id}`} className="mt-2 inline-block text-sm font-bold text-[var(--accent)] hover:underline">
          ← {c.card.name}
        </Link>
      </PageHeader>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="grid grid-cols-2 gap-3">
          <div className="badge-face badge-svg" dangerouslySetInnerHTML={{ __html: c.card.front }} />
          <div className="badge-face badge-svg" dangerouslySetInnerHTML={{ __html: c.card.back }} />
        </div>

        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Fact k="Holder" v={c.holder} href={c.memberId ? `/admin/members/${c.memberId}` : null} />
            <Fact k="Minted" v={when(c.mintedAt)} />
            <Fact k="Status" v={c.voided ? "Void" : c.revoked ? "Taken back" : "Live"} />
            <Fact k="Signature" v={c.verified ? "Verifies" : "Doesn't verify"} />
          </dl>
          <p className="text-sm">
            Certificate:{" "}
            <Link href={`/b/${c.code}`} className="font-mono text-[var(--accent)] hover:underline" target="_blank">
              /b/{c.code}
            </Link>
          </p>

          <section className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
            <h2 className="font-bold">History</h2>
            <ul className="mt-2 space-y-1">
              <li>Minted {when(c.mintedAt)}</li>
              {c.history.map((h, i) => (
                <li key={i}>
                  {h.kind === "transferred" ? `Transferred ${when(h.at)} (${h.note}); the earlier signature is kept with it` : `Voided ${when(h.at)}: ${h.reason}`}
                </li>
              ))}
            </ul>
          </section>

          {c.voided ? (
            <p className="rounded-[8px] border-2 border-[var(--danger,#c8141b)] p-3 text-sm">
              Voided {when(c.voided.at)}: {c.voided.reason}. The card stays, marked VOID, and its certificate page says so.
            </p>
          ) : (
            <VoidForm code={c.code} />
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ k, v, href }: { k: string; v: string; href?: string | null }) {
  return (
    <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3">
      <dt className="text-xs tracking-wide text-[var(--muted)] uppercase">{k}</dt>
      <dd className="mt-0.5 font-bold">
        {href ? (
          <Link href={href} className="hover:underline">
            {v}
          </Link>
        ) : (
          v
        )}
      </dd>
    </div>
  );
}

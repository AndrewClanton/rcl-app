import Link from "next/link";
import Form from "next/form";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import MemberAvatar from "@/components/MemberAvatar";
import { UUID, duplicatesOf, getMergeMember, getMergePreview, mergedInto, searchMergeCandidates, type MergeSideView } from "@/lib/data/member-merge";
import { mergeHref, mergeSentence, pointsText } from "@/lib/member-merge";
import { firstNameOf } from "@/lib/checkin";
import MergeConfirm from "./MergeConfirm";

export const dynamic = "force-dynamic";

// Merge a duplicate into this account: find the other account (search, or
// the suggestions), see side by side what each has and exactly what the
// merge will do, then confirm. Owner and admin only (the action checks
// again). The rules are in lib/member-merge.ts; the merge itself is the
// database's merge_members.

function day(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
}

function yesNo(v: boolean) {
  return v ? "Yes" : "No";
}

export default async function MergeMemberPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; drop?: string }> }) {
  const session = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const keep = await getMergeMember(id);
  if (!keep) notFound();
  const back = { href: `/admin/members/${id}`, label: keep.name };

  if (keep.erased_at) {
    return (
      <div className="space-y-4">
        <PageHeader area="guests" back={back} title="Merge a duplicate" />
        <p className="text-sm text-[var(--muted)]">This member&apos;s personal info was removed, so nothing can be merged into it.</p>
      </div>
    );
  }

  const dropId = sp.drop && UUID.test(sp.drop) && sp.drop !== id ? sp.drop : null;
  if (dropId) {
    const preview = await getMergePreview(id, dropId, session.role);
    // Gone: usually because it was just merged (here, or into another).
    const done = preview ? null : await mergedInto(dropId);
    return (
      <div className="space-y-5">
        <PageHeader
          area="guests"
          back={back}
          title="Merge a duplicate into this account"
          purpose="Check it's the same person, see exactly what moves and what's kept, then merge. The other account is deleted."
        />
        {!preview && done?.keepId === id ? (
          <div className="notice notice-success space-y-2 !p-5 text-sm" role="status">
            <p className="text-base font-semibold">Merged.</p>
            <p>{mergeSentence(keep.name, keep.points, done.visits, true)}</p>
            <Link href={`/admin/members/${id}`} className="inline-block font-semibold underline">
              Open {keep.name}&apos;s account →
            </Link>
          </div>
        ) : !preview ? (
          <div className="notice notice-warn">
            {done ? (
              <>
                That account was merged into{" "}
                <Link href={`/admin/members/${done.keepId}`} className="underline">
                  another account
                </Link>
                .
              </>
            ) : (
              "That account isn't there anymore."
            )}{" "}
            <Link href={`/admin/members/${id}/merge`} className="underline">
              Look for another
            </Link>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <SideCard side={preview.keep} label="Keep this account" tone="keep" />
              <SideCard side={preview.drop} label="Merge this one in (then it's deleted)" tone="drop" />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <Link href={mergeHref(preview.drop.id, preview.keep.id)} className="underline">
                Swap: keep the other account instead
              </Link>
              <Link href={`/admin/members/${id}/merge`} className="text-[var(--muted)] underline">
                Pick a different account
              </Link>
            </div>

            {preview.refusal ? (
              <div className="rounded-xl border-2 border-[var(--danger-text)] bg-[var(--surface)] p-4 text-sm">
                <p className="font-semibold text-[var(--danger-text)]">These two can&apos;t be merged.</p>
                <p className="mt-1">{preview.refusal}</p>
              </div>
            ) : (
              <>
                <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
                  <h2 className="text-lg font-semibold">What moves to {preview.keep.name}</h2>
                  {preview.moves.length ? (
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
                      {preview.moves.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                      {preview.drop.points !== 0 && <li>{pointsText(preview.drop.points)}, added to the balance</li>}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      Nothing but {pointsText(preview.drop.points)}: the other account has no visits, orders or tickets.
                    </p>
                  )}
                  {preview.overlaps.length > 0 && (
                    <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-[var(--warn-text)]">
                      {preview.overlaps.map((o) => (
                        <li key={o}>{o}</li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
                  <h2 className="text-lg font-semibold">What {firstNameOf(preview.result.name)}&apos;s account will have</h2>
                  <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    <Row label="Name" value={preview.result.name} />
                    <Row label="Tier" value={preview.result.tier} />
                    <Row label="Email" value={preview.result.email ?? "—"} />
                    <Row label="Phone" value={preview.result.phone ?? "—"} />
                    <Row label="Member since" value={day(preview.result.createdAt)} />
                    <Row label="Points" value={pointsText(preview.result.points)} />
                    <Row label="Visits" value={preview.result.visits.toLocaleString("en-US")} />
                    <Row label="Website login" value={yesNo(preview.result.hasLogin)} />
                    <Row label="Stripe billing" value={yesNo(preview.result.hasBilling)} />
                    <Row label="Our emails" value={!preview.result.emailOptIn ? "No" : preview.result.email ? "Yes" : "Yes, once there's an email"} />
                  </dl>
                  {preview.carried.length > 0 && (
                    <p className="mt-3 text-sm">
                      <span className="font-semibold">From the other account:</span> {preview.carried.join(", ")}.
                    </p>
                  )}
                  {preview.notKept.length > 0 && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-[var(--muted)]">
                      {preview.notKept.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  )}
                </section>

                <MergeConfirm keepId={preview.keep.id} dropId={preview.drop.id} keepName={preview.keep.name} dropName={preview.drop.name} sentence={preview.sentence} />
              </>
            )}
          </>
        )}
      </div>
    );
  }

  // ---------- picking the other account ----------
  const q = (sp.q ?? "").slice(0, 100);
  const [suggestions, results] = await Promise.all([duplicatesOf(id), q.trim() ? searchMergeCandidates(id, q, session.role) : Promise.resolve([])]);

  return (
    <div className="space-y-5">
      <PageHeader
        area="guests"
        back={back}
        title="Merge a duplicate into this account"
        purpose={`Find the other account for ${keep.name}. Its visits, points, orders and tickets come over to this one, and it's deleted. You'll see exactly what happens before anything changes.`}
      />

      {suggestions.length > 0 && (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-lg font-semibold">Possibly the same person</h2>
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {suggestions.map((p) => {
              const other = p.older.id === id ? p.newer : p.older;
              const why = [p.sameName && "same name", p.sameEmail && "same email", p.samePhone && "same phone"].filter(Boolean).join(", ");
              return (
                <li key={other.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="font-semibold">{other.name}</span>
                  <span className="text-[var(--muted)]">
                    {why} · {other.tier} · since {day(other.createdAt)} · {pointsText(other.points)}
                    {other.tabletMade ? " · made at the tablet" : ""}
                    {other.oldSite ? " · old site" : ""}
                    {!other.phoneUsable ? " · no usable phone" : ""}
                  </span>
                  <Link href={mergeHref(id, other.id)} className="ml-auto rounded border border-[var(--border)] px-2 py-1 text-xs hover:border-[var(--foreground)]">
                    Preview merge
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-lg font-semibold">Find the other account</h2>
        <Form action={`/admin/members/${id}/merge`} className="mt-2 flex flex-wrap gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="Name, email or phone"
            className="min-w-0 flex-1 rounded border border-[var(--border)] px-3 py-2 text-sm"
            autoComplete="off"
          />
          <button type="submit" className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
            Search
          </button>
        </Form>
        {q.trim() && (
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {results.length === 0 && <li className="py-2 text-sm text-[var(--muted)]">No other member matches that.</li>}
            {results.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="font-semibold">{m.name}</span>
                <span className="text-[var(--muted)]">
                  {[m.email, m.phone].filter(Boolean).join(" · ") || "no contact details"} · {m.tier} · since {day(m.createdAt)} · {pointsText(m.points)}
                  {m.hasLogin ? " · has a login" : ""}
                  {m.oldSite ? " · old site" : ""}
                </span>
                <Link href={mergeHref(id, m.id)} className="ml-auto rounded border border-[var(--border)] px-2 py-1 text-xs hover:border-[var(--foreground)]">
                  Preview merge
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[var(--border)] pb-1">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function SideCard({ side, label, tone }: { side: MergeSideView; label: string; tone: "keep" | "drop" }) {
  return (
    <section
      className={`rounded-xl border-2 bg-[var(--surface)] p-5 ${tone === "keep" ? "border-[var(--success-border)]" : "border-[var(--warn-border)]"}`}
      aria-label={label}
    >
      <p className={`text-xs font-semibold uppercase tracking-wide ${tone === "keep" ? "text-[var(--success-text)]" : "text-[var(--warn-text)]"}`}>{label}</p>
      <div className="mt-2 flex items-center gap-3">
        <MemberAvatar name={side.name} url={side.avatarUrl} size={48} plus={side.tier === "Insiders+"} />
        <div className="min-w-0">
          <Link href={`/admin/members/${side.id}`} className="block truncate text-lg font-semibold hover:underline">
            {side.name}
          </Link>
          <p className="text-xs text-[var(--muted)]">
            {side.tier}
            {side.oldSite ? " · from the old site" : ""}
            {side.tabletMade ? " · made at the tablet lately" : ""}
          </p>
        </div>
      </div>
      <dl className="mt-3 space-y-1 text-sm">
        <Row label="Member since" value={day(side.createdAt)} />
        <Row label="Points" value={pointsText(side.points)} />
        <Row label="Visits" value={side.visits.toLocaleString("en-US")} />
        <Row label="Orders" value={side.orders.toLocaleString("en-US")} />
        <Row label="Online tickets" value={side.tickets.toLocaleString("en-US")} />
        <Row label="Website login" value={yesNo(side.hasLogin)} />
        <Row label="Stripe billing" value={side.hasBilling ? `Yes${side.subscriptionStatus ? ` (${side.subscriptionStatus})` : ""}` : "No"} />
        <Row label="Email" value={side.email ?? "—"} />
        <Row label="Phone" value={side.phone ? `${side.phone}${side.phoneUsable ? "" : " (not a usable number)"}` : "—"} />
      </dl>
    </section>
  );
}

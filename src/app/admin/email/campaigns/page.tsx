import { hasAdminAccess, requireManager } from "@/lib/auth";
import { summarize, type CampaignSummary } from "@/lib/email/reports";
import { firstWaveSize, getSendPlan, getWaveMode } from "@/lib/email/send-plan";
import EmailHeader from "../_studio/EmailHeader";
import { StatusLine } from "../_studio/Sending";
import { CardGrid } from "../_studio/Cards";
import { NewEmailButtons } from "../OverviewControls";
import { campaignCard, designCard, designStates, sendingState, writtenCampaigns } from "../_studio/data";
import { testLog } from "../_studio/tests-log";

export const dynamic = "force-dynamic";

// Back office -> Email -> Campaigns: every email as a card. The three
// ready-made ones (each opens on Ready to send), then everything written
// here, newest first: drafts (the Monday lineup draft among them),
// scheduled, going, paused and sent. Each card opens its own screen.

export default async function CampaignsPage() {
  const staff = await requireManager();
  const now = new Date();
  const [plan, mode, tests, written, state] = await Promise.all([getSendPlan(), getWaveMode(), testLog(), writtenCampaigns(80).catch(() => []), sendingState()]);
  const auto = mode === "auto";
  const designs = await designStates({ now, firstWave: firstWaveSize(plan), tests, me: staff.employeeId });
  // How the latest ones that went out did (one line each).
  const gone = written.filter((c) => c.status === "sent").slice(0, 12);
  const summaries = new Map<string, CampaignSummary>((await Promise.all(gone.map((c) => summarize(c).catch(() => null)))).filter((s): s is CampaignSummary => !!s).map((s) => [s.campaign.id, s]));
  const needs = written.filter((c) => ["draft", "scheduled", "sending", "paused"].includes(c.status));
  const done = written.filter((c) => !["draft", "scheduled", "sending", "paused"].includes(c.status));

  return (
    <div className="space-y-7">
      <EmailHeader tab="campaigns" isAdmin={hasAdminAccess(staff.role)} />
      <StatusLine s={state} />

      <section aria-labelledby="ready-h" className="space-y-3.5">
        <div className="es-head">
          <h2 id="ready-h" className="font-display text-2xl">
            Ready-made
          </h2>
          <span className="text-sm text-[var(--muted)]">Finished emails: look, test, then send a few at a time</span>
        </div>
        <CardGrid cards={designs.map((d) => designCard(d, { auto, now }))} />
      </section>

      <section aria-labelledby="open-h" className="space-y-3.5">
        <div className="es-head">
          <h2 id="open-h" className="font-display text-2xl">
            Drafts and on the way
          </h2>
        </div>
        {needs.length ? <CardGrid cards={needs.map((c) => campaignCard(c, null))} /> : <p className="text-sm text-[var(--muted)]">No drafts, and nothing scheduled.</p>}
      </section>

      <section aria-labelledby="sent-h" className="space-y-3.5">
        <div className="es-head">
          <h2 id="sent-h" className="font-display text-2xl">
            Sent
          </h2>
        </div>
        {done.length ? <CardGrid cards={done.map((c) => campaignCard(c, summaries.get(c.id) ?? null))} /> : <p className="text-sm text-[var(--muted)]">Nothing sent from here yet.</p>}
      </section>

      <section aria-labelledby="start-h" className="space-y-3.5">
        <div className="es-head">
          <h2 id="start-h" className="font-display text-2xl">
            Start a new email
          </h2>
        </div>
        <NewEmailButtons />
      </section>
    </div>
  );
}

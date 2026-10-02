import Link from "next/link";
import { notFound } from "next/navigation";
import { designOf } from "@/lib/email/render";
import { hasAdminAccess, requireManager } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { getCampaign, guardrailPause, sendingGate, seedList, senderStatus } from "@/lib/email/campaign-send";
import { composerOptions, loadRenderData } from "@/lib/email/render-data";
import { getCampaignDetail, waveProblem } from "@/lib/email/reports";
import { centralParts, suggestedSlot } from "@/lib/email/timing";
import { firstNameOf } from "@/lib/email/format";
import { AUTOMATION_LABEL, KIND_LABEL } from "@/lib/email/types";
import Composer from "./Composer";
import Results from "./Results";

export const dynamic = "force-dynamic";
// "Send now" hands the first batches to Resend inside the action.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireManager();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const c = await getCampaign(id);
  if (!c) notFound();

  const editable = ["draft", "paused", "scheduled", "active", "off"].includes(c.status);
  const hasSends = (c.recipients ?? 0) > 0 || c.kind === "automation" || ["sending", "sent", "paused", "cancelled"].includes(c.status);
  const [options, data, detail, pause] = await Promise.all([
    composerOptions(),
    loadRenderData(c.content ?? { blocks: [] }).catch(() => ({ range: { start: "", days: 7 }, films: [], happenings: [], menuItems: [] })),
    hasSends ? getCampaignDetail(c) : Promise.resolve(null),
    guardrailPause(),
  ]);

  const slot = suggestedSlot(c.kind);
  const sp = centralParts(slot);
  const lastWave = detail?.waves[detail.waves.length - 1];
  const title = c.automation ? AUTOMATION_LABEL[c.automation].label : c.name;

  return (
    <div className="space-y-6">
      <PageHeader area="guests" back={{ href: c.automation ? "/admin/email/automations" : "/admin/email", label: c.automation ? "Automations" : "Email" }} title={title} purpose={`${KIND_LABEL[c.kind]} · ${c.status}`} />
      {c.error && <p className="notice notice-warn text-sm">{c.error}</p>}
      {pause && (
        <p className="notice notice-warn text-sm">
          {pause.by === "Stopped" ? "Sending is stopped" : "Sending is paused by a guardrail"}: {pause.reason.replace(/[.!?]?\s*$/, ".")} Resume sending on the Email page first.
        </p>
      )}
      {designOf(c.content) && (
        <p className="notice text-sm">
          One of the ready-made emails. Preview it, test it and send it (or pause it) from{" "}
          <Link href={`/admin/email/ready#${designOf(c.content)}`} className="font-semibold underline">
            Email &rarr; Ready to send
          </Link>
          . Its words and pictures come from the design, so they can&apos;t be edited here.
        </p>
      )}
      {editable && !designOf(c.content) && (
        <Composer
          // A fresh key each time the page loads: a double click on Send reuses it.
          sendKey={crypto.randomUUID()}
          campaign={c}
          initialData={data}
          options={options}
          canSend={hasAdminAccess(staff.role)}
          gate={await sendingGate()}
          sender={senderStatus()}
          myEmail={staff.email}
          myFirstName={firstNameOf(staff.name)}
          seedCount={seedList().length}
          suggested={{ date: sp.date, time: `${String(Math.floor(sp.minutes / 60)).padStart(2, "0")}:${String(sp.minutes % 60).padStart(2, "0")}`, label: slot.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) }}
          lastWaveProblem={waveProblem(lastWave)}
        />
      )}
      {detail && <Results detail={detail} canSend={hasAdminAccess(staff.role)} campaignId={c.id} status={c.status} kind={c.kind} />}
    </div>
  );
}

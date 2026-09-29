import { notFound } from "next/navigation";
import { requireMember } from "@/lib/member-auth";
import { getReceipt, showingStillOn } from "@/lib/data/member-account";
import ReceiptView from "./ReceiptView";

export const metadata = { title: "Receipt" };

export default async function ReceiptPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (kind !== "order" && kind !== "ticket" && kind !== "booth") notFound();
  const member = await requireMember();
  const r = await getReceipt(member, kind, id);
  if (!r) notFound();
  // Tickets for a showing still ahead (or just started) link to their code
  // for the door.
  const ticketHref = r.kind === "ticket" && r.status === "completed" && r.screening && showingStillOn(r.screening.startsAt) ? `/account/movies/${r.id}` : null;
  return <ReceiptView r={r} ticketHref={ticketHref} />;
}

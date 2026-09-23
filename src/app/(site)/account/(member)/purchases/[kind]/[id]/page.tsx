import { notFound } from "next/navigation";
import { requireMember } from "@/lib/member-auth";
import { getReceipt } from "@/lib/data/member-account";
import ReceiptView from "./ReceiptView";

export const metadata = { title: "Receipt" };

export default async function ReceiptPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (kind !== "order" && kind !== "ticket") notFound();
  const member = await requireMember();
  const r = await getReceipt(member, kind, id);
  if (!r) notFound();
  return <ReceiptView r={r} />;
}

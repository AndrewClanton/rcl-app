import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/member-auth";
import { getMemberTicket } from "@/lib/data/member-account";
import TicketCard from "@/components/TicketCard";

export const metadata = { title: "Your tickets" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One booking's tickets, with the QR code to show at the door. Under Movies
// so that tab stays lit.
export default async function TicketPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  if (!UUID.test(bookingId)) notFound();
  const member = await requireMember();
  const ticket = await getMemberTicket(member.id, bookingId.toLowerCase());
  if (!ticket) notFound();

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/account/movies" className="-my-3 inline-block py-3 text-sm font-bold text-[var(--muted)] hover:text-[var(--foreground)]">
          ← All movies
        </Link>
        {!ticket.atRegister && (
          <Link href={`/account/purchases/ticket/${ticket.bookingId}`} className="-my-3 inline-block py-3 text-sm font-bold text-[var(--accent)] hover:underline">
            Receipt →
          </Link>
        )}
      </div>
      <TicketCard t={ticket} priority />
    </div>
  );
}

import Image from "next/image";
import type { TabletTicket } from "@/lib/door-tickets";
import k from "./kiosk.module.css";

// Someone's online tickets for today, shown after they check in (the
// register sends "checkin-tickets", see RegisterCheckins.tsx).
export interface TicketsShown {
  key: number;
  firstName: string;
  tickets: TabletTicket[];
}

// "Maya, your tickets for today": poster, time, room and whether they
// still need printing. Nothing here that isn't on their own ticket.
export default function TicketsCard({ shown }: { shown: TicketsShown }) {
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
  const toPrint = shown.tickets.some((t) => t.status === "to_print");
  return (
    <div className={k.ticketsCard} aria-live="polite">
      <div className={k.ticketsHead}>🎟 {shown.firstName}, your tickets for today</div>
      <div className={k.ticketRows}>
        {shown.tickets.map((t, i) => (
          <div key={i} className={k.ticketRow}>
            <div className={k.ticketPoster}>{t.posterUrl ? <Image src={t.posterUrl} alt="" fill sizes="56px" className="object-cover" /> : null}</div>
            <div>
              <div className={k.ticketTitle}>{t.title}</div>
              <div className={k.ticketMeta}>
                {time(t.startsAt)}
                {t.room ? ` · ${t.room}` : ""} · {t.quantity} ticket{t.quantity === 1 ? "" : "s"}
              </div>
            </div>
            <span className={t.status === "printed" ? k.ticketDone : k.ticketTodo}>{t.status === "printed" ? "Printed ✓" : "Ready"}</span>
          </div>
        ))}
      </div>
      {toPrint && <div className={k.ticketMeta}>The box office will print them for you.</div>}
    </div>
  );
}

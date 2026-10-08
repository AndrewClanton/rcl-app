import QRCode from "qrcode";
import { requireManager } from "@/lib/auth";
import Link from "next/link";
import PageHeader from "@/components/admin/PageHeader";
import { listSpots } from "@/lib/seat-ordering-server";
import { SITE_URL } from "@/lib/site";
import PrintCardsButton from "./PrintCardsButton";

export const dynamic = "force-dynamic";

// The QR cards for the spots, 4 × 5.2 in each, centered inside a printer-safe
// margin. By default each card gets its own page (for small frames);
// ?layout=sheet fits four to a page to cut and stand in card holders.
// ?sides=2 lays them out for double-sided printing: each card's back page
// follows its front (mirrored left-right on a four-up sheet, so a flip on
// the long edge lines the backs up). ?id= prints one spot's.
// The QR always points at the live site, wherever this is printed from.
export default async function SeatCardsPage({ searchParams }: { searchParams: Promise<{ id?: string | string[]; layout?: string | string[]; sides?: string | string[] }> }) {
  await requireManager();
  const [{ id, layout, sides }, spots] = await Promise.all([searchParams, listSpots()]);
  const chosen = typeof id === "string" ? spots.filter((s) => s.id === id) : spots.filter((s) => s.active);
  const sheet = layout === "sheet";
  const double = sides === "2";
  const query = (o: { sheet: boolean; double: boolean }) => {
    const q = new URLSearchParams({ ...(typeof id === "string" ? { id } : {}), ...(o.sheet ? { layout: "sheet" } : {}), ...(o.double ? { sides: "2" } : {}) }).toString();
    return `/admin/seat-ordering/cards${q ? `?${q}` : ""}`;
  };
  const cards = await Promise.all(
    chosen.map(async (s) => ({
      spot: s,
      url: `${SITE_URL}/order/${s.code}`,
      qr: await QRCode.toDataURL(`${SITE_URL}/order/${s.code}`, { margin: 0, width: 600, errorCorrectionLevel: "M", color: { dark: "#14110c", light: "#ffffff" } }),
    })),
  );

  // The order cards print in: one-sided, each once; double-sided, each
  // card's back right after its front. On a sheet the back page mirrors the
  // front left-right, with blanks keeping each back behind its own front.
  type Slot = (typeof cards)[number] | null;
  const slots: { key: string; card: Slot }[] = [];
  if (!double) cards.forEach((c) => slots.push({ key: c.spot.id, card: c }));
  else if (!sheet) cards.forEach((c) => slots.push({ key: c.spot.id, card: c }, { key: `${c.spot.id}-back`, card: c }));
  else
    for (let i = 0; i < cards.length; i += 4) {
      const page: Slot[] = [0, 1, 2, 3].map((j) => cards[i + j] ?? null);
      page.forEach((c, j) => slots.push({ key: `f${i + j}`, card: c }));
      [page[1], page[0], page[3], page[2]].forEach((c, j) => slots.push({ key: `b${i + j}`, card: c }));
    }

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          area="stock"
          title={chosen.length === 1 ? `QR card: ${chosen[0].name}` : "QR cards"}
          back={{ href: "/admin/seat-ordering", label: "Seat ordering" }}
          purpose={
            (sheet ? "Four to a page: print on card stock and cut along the lines." : "One card per page, centered.") +
            (double ? " Double-sided: in the print dialog choose two-sided (or the printer's manual two-sided option, which tells you when to put the pages back in), flip on the long edge." : "") +
            " Each one only works at its own spot."
          }
          actions={
            <>
              {cards.length > 1 && (
                <Link href={query({ sheet: !sheet, double })} className="btn-secondary min-h-11">
                  {sheet ? "One per page" : "Four to a page"}
                </Link>
              )}
              <Link href={query({ sheet, double: !double })} className="btn-secondary min-h-11" aria-pressed={double}>
                {double ? "Double-sided: on" : "Double-sided: off"}
              </Link>
              <PrintCardsButton />
            </>
          }
        />
      </div>
      {cards.length === 0 ? (
        <p>No spots to print.</p>
      ) : (
        <div className={sheet ? "seat-cards seat-cards-sheet" : "seat-cards"}>
          {slots.map(({ key, card }) => (
            <div key={key} className="seat-page">
            {!card ? (
              <div className="seat-card seat-card-blank" aria-hidden="true" />
            ) : (
            <article className="seat-card">
              <div className="seat-card-eyebrow">Royale Cinema</div>
              <h2 className="seat-card-title">Order from your seat</h2>
              {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
              <img src={card.qr} alt={`QR code for ${card.spot.name}`} className="seat-card-qr" />
              <div className="seat-card-spot">{card.spot.name}</div>
              <p className="seat-card-how">Scan with your phone camera. Order, pay, and we bring it to you.</p>
              <p className="seat-card-fine">21+ drinks: ID checked on delivery · {card.url.replace(/^https?:\/\//, "")}</p>
            </article>
            )}
            </div>
          ))}
        </div>
      )}
      <style>{`
        .seat-cards { display: grid; grid-template-columns: repeat(auto-fill, 4.25in); gap: 16px; }
        .seat-card {
          width: 4.25in; height: 5.5in; box-sizing: border-box; padding: 0.3in 0.3in 0.25in;
          background: #f8f5ec; color: #14110c; border: 3px solid #14110c;
          display: flex; flex-direction: column; align-items: center; text-align: center;
          break-inside: avoid; page-break-inside: avoid; overflow: hidden;
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
        }
        .seat-card-eyebrow { font-family: var(--font-space-mono), monospace; font-weight: 700; font-size: 11pt; letter-spacing: 0.2em; text-transform: uppercase; color: #ed1c24; }
        .seat-card-title { font-family: var(--font-archivo-black), "Arial Black", sans-serif; font-size: 25pt; line-height: 1.05; margin-top: 4pt; }
        .seat-card-qr { width: 2in; height: 2in; margin-top: 10pt; padding: 8pt; background: #fff; border: 3px solid #14110c; box-shadow: 5px 5px 0 #14110c; image-rendering: pixelated; }
        .seat-card-spot { margin-top: 16pt; padding: 4pt 14pt; background: #ffc72c; border: 3px solid #14110c; font-family: var(--font-archivo-black), "Arial Black", sans-serif; font-size: 20pt; line-height: 1.15; }
        .seat-card-how { margin-top: auto; font-size: 10.5pt; font-weight: 700; line-height: 1.3; }
        .seat-card-blank { visibility: hidden; }
        .seat-card-fine { margin-top: 4pt; font-family: var(--font-space-mono), monospace; font-size: 7pt; color: #6b6455; }
        @media print {
          /* A quarter-inch margin keeps every border inside what a printer can reach
             (8 x 10.5 in left). One per page: each card centered on its own page.
             Sheet: four to a page, centered. */
          @page { size: letter; margin: 0.25in; }
          .seat-cards { display: block; }
          .seat-page { height: 10.4in; display: flex; align-items: center; justify-content: center; break-after: page; page-break-after: always; }
          .seat-page:last-child { break-after: auto; page-break-after: auto; }
          .seat-cards-sheet { display: grid; width: 8in; grid-template-columns: 4in 4in; justify-content: center; gap: 0; }
          .seat-cards-sheet .seat-page { display: contents; }
          .seat-card { width: 4in; height: 5.2in; padding: 0.28in 0.25in 0.22in; }
          .seat-card-title { font-size: 22pt; }
          .seat-card-qr { width: 1.85in; height: 1.85in; margin-top: 8pt; }
          .seat-card-spot { margin-top: 14pt; font-size: 18pt; }
        }
      `}</style>
    </div>
  );
}

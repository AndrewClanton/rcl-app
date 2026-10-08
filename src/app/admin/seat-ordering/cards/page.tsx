import QRCode from "qrcode";
import { requireManager } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { listSpots } from "@/lib/seat-ordering-server";
import { SITE_URL } from "@/lib/site";
import PrintCardsButton from "./PrintCardsButton";

export const dynamic = "force-dynamic";

// The QR cards for the spots: four to a letter page (each a quarter page,
// 4¼ × 5½ in, to cut and stand in a card holder). ?id= prints one spot's.
// The QR always points at the live site, wherever this is printed from.
export default async function SeatCardsPage({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  await requireManager();
  const [{ id }, spots] = await Promise.all([searchParams, listSpots()]);
  const chosen = typeof id === "string" ? spots.filter((s) => s.id === id) : spots.filter((s) => s.active);
  const cards = await Promise.all(
    chosen.map(async (s) => ({
      spot: s,
      url: `${SITE_URL}/order/${s.code}`,
      qr: await QRCode.toDataURL(`${SITE_URL}/order/${s.code}`, { margin: 0, width: 600, errorCorrectionLevel: "M", color: { dark: "#14110c", light: "#ffffff" } }),
    })),
  );

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          area="stock"
          title={chosen.length === 1 ? `QR card: ${chosen[0].name}` : "QR cards"}
          back={{ href: "/admin/seat-ordering", label: "Seat ordering" }}
          purpose="Print on card stock, four to a page, and cut along the lines. Each one only works at its own spot."
          actions={<PrintCardsButton />}
        />
      </div>
      {cards.length === 0 ? (
        <p>No spots to print.</p>
      ) : (
        <div className="seat-cards">
          {cards.map(({ spot, url, qr }) => (
            <article key={spot.id} className="seat-card">
              <div className="seat-card-eyebrow">Royale Cinema</div>
              <h2 className="seat-card-title">Order from your seat</h2>
              {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
              <img src={qr} alt={`QR code for ${spot.name}`} className="seat-card-qr" />
              <div className="seat-card-spot">{spot.name}</div>
              <p className="seat-card-how">Scan with your phone camera. Order, pay, and we bring it to you.</p>
              <p className="seat-card-fine">21+ drinks: ID checked on delivery · {url.replace(/^https?:\/\//, "")}</p>
            </article>
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
        .seat-card-qr { width: 2.3in; height: 2.3in; margin-top: 12pt; padding: 8pt; background: #fff; border: 3px solid #14110c; box-shadow: 5px 5px 0 #14110c; image-rendering: pixelated; }
        .seat-card-spot { margin-top: 16pt; padding: 4pt 14pt; background: #ffc72c; border: 3px solid #14110c; font-family: var(--font-archivo-black), "Arial Black", sans-serif; font-size: 20pt; line-height: 1.15; }
        .seat-card-how { margin-top: auto; font-size: 10.5pt; font-weight: 700; line-height: 1.3; }
        .seat-card-fine { margin-top: 4pt; font-family: var(--font-space-mono), monospace; font-size: 7pt; color: #6b6455; }
        @media print {
          @page { size: letter; margin: 0; }
          .seat-cards { grid-template-columns: 4.25in 4.25in; gap: 0; }
        }
      `}</style>
    </div>
  );
}

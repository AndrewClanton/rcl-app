import { requireManager } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import InfoTip from "@/components/help/InfoTip";
import { getSeatSettings, listSpots } from "@/lib/seat-ordering-server";
import { openStateLabel, seatOrderingOpen } from "@/lib/seat-ordering";
import SeatOrderingAdmin from "./SeatOrderingAdmin";

export const dynamic = "force-dynamic";

// Back office → Seat ordering: guests order from their phone at a booth, in
// the cinema, on the patio or at a table (lib/seat-ordering.ts).
export default async function SeatOrderingPage() {
  await requireManager();
  const [settings, spots] = await Promise.all([getSeatSettings(), listSpots()]);
  return (
    <div>
      <PageHeader
        area="stock"
        title="Seat ordering"
        titleAside={<InfoTip topic="seat-ordering" />}
        purpose="Guests scan the card at their seat, order and pay on their phone, and it shows up on the bar and kitchen screens with where to bring it."
      />
      <SeatOrderingAdmin settings={settings} state={openStateLabel(settings, seatOrderingOpen(settings))} spots={spots} />
    </div>
  );
}

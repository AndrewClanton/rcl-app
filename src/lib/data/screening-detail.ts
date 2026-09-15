import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Screening } from "@/lib/types";

export interface ScreeningDetail extends Screening {
  booked_quantity: number;
}

export async function getScreeningById(id: string): Promise<ScreeningDetail | null> {
  const supabase = await createClient();
  const { data: screening, error } = await supabase
    .from("screenings")
    .select("*, movie:movies(*), room:rooms(*, addons:room_addons(*))")
    .eq("id", id)
    .single();
  if (error || !screening) return null;

  // bookings has no public-read RLS policy (organizer/customer contact
  // info), so the seats-remaining count goes through the service-role
  // client even though this page itself is public.
  const admin = createAdminClient();
  const { data: bookings } = await admin.from("bookings").select("quantity").eq("screening_id", id).in("status", ["pending", "confirmed"]);
  const booked = (bookings ?? []).reduce((s, b) => s + b.quantity, 0);

  return { ...(screening as unknown as Screening), booked_quantity: booked };
}

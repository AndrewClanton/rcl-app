"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export async function reserveTickets(fields: { screeningId: string; quantity: number; customerName: string; customerEmail: string }): Promise<void> {
  const name = fields.customerName.trim();
  const email = fields.customerEmail.trim();
  if (!name) throw new Error("Enter your name.");
  if (!email || !email.includes("@")) throw new Error("Enter a valid email.");
  if (!(fields.quantity > 0)) throw new Error("Select at least one ticket.");

  const supabase = createAdminClient();

  const { data: screening, error: screeningErr } = await supabase.from("screenings").select("id, ticket_price, capacity").eq("id", fields.screeningId).single();
  if (screeningErr || !screening) throw new Error("Screening not found.");

  const { data: existingBookings, error: bookingsErr } = await supabase
    .from("bookings")
    .select("quantity")
    .eq("screening_id", fields.screeningId)
    .in("status", ["pending", "confirmed"]);
  if (bookingsErr) throw bookingsErr;

  const booked = (existingBookings ?? []).reduce((s, b) => s + b.quantity, 0);
  if (booked + fields.quantity > screening.capacity) {
    throw new Error(`Only ${Math.max(0, screening.capacity - booked)} seat(s) left for this screening.`);
  }

  const { error } = await supabase.from("bookings").insert({
    screening_id: fields.screeningId,
    customer_name: name,
    customer_email: email,
    quantity: fields.quantity,
    unit_price: screening.ticket_price,
    status: "pending",
  });
  if (error) throw error;

  revalidatePath(`/showtimes/${fields.screeningId}`);
}

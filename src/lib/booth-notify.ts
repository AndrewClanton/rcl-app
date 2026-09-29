import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import { reportRecipients } from "@/lib/daily-report";
import { boothDate, boothWindow } from "@/lib/booth-time";
import { SITE_URL } from "@/lib/site";
import { boothAlertHtml, boothAlertSubject, boothConfirmationHtml, boothConfirmationSubject, type BoothEmailData } from "@/lib/email/booth-emails";

const REPLY_TO = "info@royalecinemajoplin.com";

// A booth booking was confirmed (paid through Stripe, or free with
// Insiders+): email the guest their confirmation and the owner/admins an
// alert. Each email is claimed in the database before it's sent, so a
// re-delivered Stripe event can't send it twice; a failed send gives the
// claim back. Never throws -- a mail problem must not undo a booking.
export async function notifyBoothConfirmed(reservationId: string): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { data: r } = await supabase
      .from("booth_reservations")
      .select("id, status, reservation_date, start_time, hours, customer_name, customer_email, customer_phone, party_size, fee_amount, tax_amount, booth:booths(label)")
      .eq("id", reservationId)
      .maybeSingle();
    if (!r || r.status !== "confirmed") return;

    const data: BoothEmailData = {
      booth: (r.booth as unknown as { label: string } | null)?.label ?? "Your booth",
      dateLong: boothDate(r.reservation_date as string),
      window: boothWindow(r.start_time as string, Number(r.hours)),
      name: r.customer_name as string,
      email: r.customer_email as string,
      phone: (r.customer_phone as string | null) ?? null,
      party: r.party_size as number,
      fee: Number(r.fee_amount),
      tax: Number(r.tax_amount ?? 0),
    };

    const claim = async (column: "confirmation_sent_at" | "staff_alerted_at") => {
      const { data: won } = await supabase.from("booth_reservations").update({ [column]: new Date().toISOString() }).eq("id", reservationId).is(column, null).select("id");
      return !!won?.length;
    };
    const release = (column: "confirmation_sent_at" | "staff_alerted_at") => supabase.from("booth_reservations").update({ [column]: null }).eq("id", reservationId);

    if (data.email && (await claim("confirmation_sent_at"))) {
      const sent = await sendEmail(data.email, boothConfirmationSubject(data), boothConfirmationHtml(data), { replyTo: REPLY_TO });
      if (!sent.ok) await release("confirmation_sent_at");
    }

    if (await claim("staff_alerted_at")) {
      const to = await reportRecipients();
      let any = false;
      for (const addr of to) {
        const sent = await sendEmail(addr, boothAlertSubject(data), boothAlertHtml(data, `${SITE_URL}/admin/booths`), { replyTo: data.email || REPLY_TO });
        any = any || sent.ok;
      }
      if (!any) await release("staff_alerted_at");
    }
  } catch {
    // Mail is best-effort; the booking stands either way.
  }
}

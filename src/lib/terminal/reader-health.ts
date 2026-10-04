import "server-only";
import type Stripe from "stripe";
import { getQuickStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay, businessDayWindow } from "@/lib/ops/time";
import type { ReaderHealth } from "./reader-status";

// How the register knows its card reader is up (reader-status.ts has the
// why). One read-only Stripe call per reader every ~45 s at most, shared by
// every register on any server through the card_reader_status row; a charge
// asks again if the shared answer is more than a few seconds old.
//
// Works without the table too (before its migration, or if the database
// hiccups): it just asks Stripe every time and counts nothing.

export const POLL_MAX_AGE_MS = 45_000;

const MODELS: Record<string, string> = {
  bbpos_wisepos_e: "BBPOS WisePOS E",
  simulated_wisepos_e: "Simulated WisePOS E",
  stripe_s700: "Stripe Reader S700",
  stripe_s710: "Stripe Reader S710",
  simulated_stripe_s700: "Simulated Stripe S700",
  simulated_stripe_s710: "Simulated Stripe S710",
  stripe_m2: "Stripe Reader M2",
  bbpos_wisepad3: "BBPOS WisePad 3",
  verifone_P400: "Verifone P400",
};

const DOING: Record<string, string> = {
  process_payment_intent: "Collecting a payment",
  collect_payment_method: "Collecting a payment",
  confirm_payment_intent: "Finishing a payment",
  collect_inputs: "Asking the guest (tip)",
  set_reader_display: "Showing the order",
  refund_payment: "Refunding a card",
  process_setup_intent: "Saving a card",
  print_content: "Printing",
};

type Info = Pick<ReaderHealth, "label" | "model" | "serialLast4" | "software" | "ip" | "location" | "doing">;
type Fresh = { online: boolean | null; lastSeenAt: number | null; info: Info };

function fromReader(r: Stripe.Terminal.Reader): Fresh {
  const action = r.action && r.action.status === "in_progress" ? (DOING[r.action.type] ?? "Busy") : "Idle";
  const location = r.location && typeof r.location === "object" ? r.location.display_name : null;
  return {
    online: r.status === "online" ? true : r.status === "offline" ? false : null,
    lastSeenAt: r.last_seen_at ?? null, // Stripe gives milliseconds here
    info: {
      label: r.label || null,
      model: MODELS[r.device_type] ?? r.device_type.replace(/_/g, " "),
      serialLast4: r.serial_number ? r.serial_number.slice(-4) : null,
      software: r.device_sw_version || null,
      ip: r.ip_address || null,
      location,
      doing: action,
    },
  };
}

const EMPTY_INFO: Info = { label: null, model: null, serialLast4: null, software: null, ip: null, location: null, doing: null };

export async function readerHealth(readerId: string, maxAgeMs: number): Promise<ReaderHealth> {
  const db = createAdminClient();
  let cached: (Fresh & { checkedAt: number }) | null = null;
  try {
    const { data } = await db.from("card_reader_status").select("online, last_seen_at, info, checked_at").eq("reader_id", readerId).maybeSingle();
    if (data) {
      cached = {
        online: data.online,
        lastSeenAt: data.last_seen_at ? Date.parse(data.last_seen_at) : null,
        info: { ...EMPTY_INFO, ...(data.info as Partial<Info>) },
        checkedAt: Date.parse(data.checked_at),
      };
    }
  } catch {
    cached = null;
  }

  let current = cached;
  let found = true;
  let stripeError = false;
  if (!cached || Date.now() - cached.checkedAt > maxAgeMs) {
    try {
      const reader = await getQuickStripe().terminal.readers.retrieve(readerId, { expand: ["location"] });
      if ("deleted" in reader && reader.deleted) found = false;
      else {
        const fresh = fromReader(reader as Stripe.Terminal.Reader);
        current = { ...fresh, checkedAt: Date.now() };
        await db
          .rpc("record_card_reader_check", {
            p_reader_id: readerId,
            p_online: fresh.online,
            p_last_seen_at: fresh.lastSeenAt ? new Date(fresh.lastSeenAt).toISOString() : null,
            p_info: fresh.info,
          })
          .then(
            () => {},
            () => {},
          );
      }
    } catch (e) {
      if (e && typeof e === "object" && (e as { code?: string }).code === "resource_missing") found = false;
      else stripeError = true;
    }
  }

  let offlineToday = 0;
  try {
    const { start } = businessDayWindow(businessDay().date);
    const { count } = await db.from("card_reader_events").select("id", { count: "exact", head: true }).eq("reader_id", readerId).eq("online", false).gte("at", start);
    offlineToday = count ?? 0;
  } catch {
    offlineToday = 0;
  }

  return {
    readerId,
    found,
    online: current?.online ?? null,
    lastSeenAt: current?.lastSeenAt ?? null,
    checkedAt: current?.checkedAt ?? null,
    ...(current?.info ?? EMPTY_INFO),
    offlineToday,
    stripeError,
  };
}

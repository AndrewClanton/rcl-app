import "server-only";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

// Takes a tab's card off file once the tab is paid or cancelled: Stripe
// forgets the saved card and the tab forgets which one it was. Best-effort --
// never blocks closing the tab.
export async function releaseTabCard(orderId: string): Promise<void> {
  const supabase = createAdminClient();
  const { data: tab } = await supabase.from("orders").select("tab_card_payment_method_id").eq("id", orderId).maybeSingle();
  if (!tab?.tab_card_payment_method_id) return;
  await getStripe()
    .paymentMethods.detach(tab.tab_card_payment_method_id)
    .catch(() => {});
  await supabase.from("orders").update({ tab_card_payment_method_id: null, tab_card_label: null }).eq("id", orderId);
}

// In-memory stand-ins for scripts/check-owner-tab.mjs: the email marketing
// fakes (scripts/check-email-marketing-fakes.mjs: the Supabase service-role
// client, next/server, next/cache and a signed-in staff login), plus the
// register's tables and its order-number function. No database, no
// network, no Stripe.
import { createAdminClient as baseClient, db } from "./check-email-marketing-fakes.mjs";

export * from "./check-email-marketing-fakes.mjs";

for (const t of [
  "menu_modifier_groups",
  "recipes",
  "ingredients",
  "screenings",
  "order_items",
  "pin_attempts",
  "dev_notes",
  "owner_tab_payments",
  "register_sale_flags",
  "points_ledger",
  "order_ticket_state",
  "printers",
  "print_jobs",
]) {
  db[t] ??= [];
}

let orderNumber = 9000;

// The email fakes' client, with the register's next_order_number.
export function createAdminClient() {
  const c = baseClient();
  return {
    ...c,
    rpc: async (name, args) => (name === "next_order_number" ? { data: ++orderNumber, error: null } : c.rpc(name, args)),
  };
}

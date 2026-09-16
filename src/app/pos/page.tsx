import { getMenuTree } from "@/lib/data/menu";
import { getActiveEmployees } from "@/lib/data/employees";
import { getMembers } from "@/lib/data/members";
import { getRecipesByItem } from "@/lib/data/recipes";
import { requireStaff } from "@/lib/auth";
import { getDraftOrders } from "./actions";
import { terminalConfigured } from "./terminal-config";
import PosApp from "./PosApp";

export const dynamic = "force-dynamic";

export default async function PosPage() {
  await requireStaff();

  const [categories, employees, members, heldOrders, openTabs, recipesByItem] = await Promise.all([
    getMenuTree(),
    getActiveEmployees(),
    getMembers(),
    getDraftOrders("held"),
    getDraftOrders("tab"),
    getRecipesByItem(),
  ]);

  // Tickets/events aren't ready for POS ordering yet (event booking flow,
  // per-showtime ticket linkage) -- hide that category here for now.
  const orderableCategories = categories.filter((c) => c.key !== "tickets");

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="font-display text-2xl" style={{ color: "var(--foreground)" }}>
          Royale Cinema Lounge <span style={{ color: "var(--accent)" }}>· Point of Sale</span>
        </h1>
        <span className="eyebrow">
          {new Date().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" })}
        </span>
      </div>
      <PosApp
        categories={orderableCategories}
        employees={employees}
        members={members}
        heldOrders={heldOrders}
        openTabs={openTabs}
        recipesByItem={recipesByItem}
        readerAvailable={terminalConfigured()}
      />
    </div>
  );
}

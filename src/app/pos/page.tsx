import type { Metadata, Viewport } from "next";
import { getMenuTree } from "@/lib/data/menu";
import { getActiveEmployees } from "@/lib/data/employees";
import { getRecipesByItem } from "@/lib/data/recipes";
import { requireStaff } from "@/lib/auth";
import { getDraftOrders } from "./actions";
import { defaultReaderId } from "./terminal-config";
import PosApp from "./PosApp";
import ShiftBar from "./shift/ShiftBar";
import UpdateBanner from "./UpdateBanner";
import { deploymentId } from "@/lib/deployment";

export const dynamic = "force-dynamic";

// "Add to Home Screen" on the register iPad opens this full-screen, without
// Safari's bars.
export const metadata: Metadata = {
  title: "Register",
  appleWebApp: { capable: true, title: "RCL Register" },
};

// No zooming: iPad Safari zooms in when a small text box gets focus, which
// shoves the register off the screen until someone pinches back out.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default async function PosPage() {
  await requireStaff();

  const [categories, employees, heldOrders, openTabs, recipesByItem] = await Promise.all([
    getMenuTree(),
    getActiveEmployees(),
    getDraftOrders("held"),
    getDraftOrders("tab"),
    getRecipesByItem(),
  ]);

  // Tickets/events aren't ready for POS ordering yet (event booking flow,
  // per-showtime ticket linkage) -- hide that category here for now.
  const orderableCategories = categories.filter((c) => c.key !== "tickets");

  return (
    // On a tablet or bigger the register is locked to the screen: this fills
    // exactly one screen height and the panels inside scroll on their own.
    <div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-3 md:h-dvh md:overflow-hidden md:overscroll-none">
      <div className="mb-2 flex shrink-0 items-baseline justify-between">
        <h1 className="font-display text-xl" style={{ color: "var(--foreground)" }}>
          Royale Cinema Lounge <span style={{ color: "var(--accent)" }}>· Point of Sale</span>
        </h1>
        <span className="eyebrow">
          {new Date().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" })}
        </span>
      </div>
      <div className="shrink-0">
        <UpdateBanner current={deploymentId()} />
        <ShiftBar staff={employees.map((e) => ({ id: e.id, name: e.name }))} />
      </div>
      <PosApp
        categories={orderableCategories}
        employees={employees}
        heldOrders={heldOrders}
        openTabs={openTabs}
        recipesByItem={recipesByItem}
        defaultReaderId={defaultReaderId()}
      />
    </div>
  );
}

import type { Metadata, Viewport } from "next";
import { getMenuTree, withoutHiddenItems } from "@/lib/data/menu";
import { getActiveEmployees } from "@/lib/data/employees";
import { getRecipesByItem } from "@/lib/data/recipes";
import { getDoubleSettings } from "@/lib/data/barBook";
import { hasAdminAccess, requireStaff } from "@/lib/auth";
import { getDraftOrders } from "./actions";
import { defaultReaderId } from "./terminal-config";
import { getRegisterScreenings } from "./ticket-actions";
import PosApp from "./PosApp";
import { HeaderSignal } from "./MemberSignal";
import { ItemSettingsProvider } from "./item-settings/ItemSettings";
import { registerTopic } from "@/lib/register-topic";
import StaffTools from "./shift/StaffTools";
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
  // Signing in again comes back here, not to the back office.
  const session = await requireStaff("/pos");

  const [categories, employees, heldOrders, openTabs, recipesByItem, showings, doubleSettings] = await Promise.all([
    getMenuTree(),
    getActiveEmployees(),
    getDraftOrders("held"),
    getDraftOrders("tab"),
    getRecipesByItem(),
    getRegisterScreenings(),
    getDoubleSettings(),
  ]);

  // Tickets are sold from the Movies tab (per showing, with seats counted),
  // so the menu's tickets category stays off the register's item buttons.
  // Items a manager hid ("Hide from register" on the Menu page) stay off.
  const orderableCategories = withoutHiddenItems(categories).filter((c) => c.key !== "tickets");

  return (
    // On a tablet or bigger the register is locked to the screen: this fills
    // exactly one screen height and the panels inside scroll on their own.
    <div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-3 md:h-dvh md:overflow-hidden md:overscroll-none md:py-2">
      {/* The iPad already shows the date; its height goes to the order instead. */}
      <div className="mb-2 flex shrink-0 items-baseline gap-2 md:hidden">
        <h1 className="font-display text-xl" style={{ color: "var(--foreground)" }}>
          Royale Cinema Lounge <span style={{ color: "var(--accent)" }}>· Point of Sale</span>
        </h1>
        {/* Gold "+" for a paying Insiders+ member on the order; NOT ACTIVE
            for a former unlimited member who isn't paying. */}
        <HeaderSignal />
        <span className="eyebrow ml-auto">
          {new Date().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" })}
        </span>
      </div>
      <div className="shrink-0">
        <UpdateBanner current={deploymentId()} />
        {/* The shift tools behind the register's Staff button, and any
            reminder that's due. Roles, so the managers' to-dos and Ran out
            details show only while a manager is signed in or on shift at
            this iPad. */}
        <StaffTools staff={employees.map((e) => ({ id: e.id, name: e.name, role: e.role }))} signedInRole={session.role} />
      </div>
      {/* Press and hold a menu button for its settings (manager PIN). */}
      <ItemSettingsProvider>
        <PosApp
          categories={orderableCategories}
          employees={employees}
          heldOrders={heldOrders}
          openTabs={openTabs}
          recipesByItem={recipesByItem}
          defaultReaderId={defaultReaderId()}
          initialScreenings={showings.ok ? showings.screenings : []}
          registerTopic={registerTopic()}
          // Dev note only while an admin is signed in (submitting checks again).
          canNote={hasAdminAccess(session.role)}
          // How a double is priced (Back office → Bar Book).
          doubleSettings={doubleSettings}
        />
      </ItemSettingsProvider>
    </div>
  );
}

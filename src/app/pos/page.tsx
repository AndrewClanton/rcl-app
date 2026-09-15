import { getMenuTree } from "@/lib/data/menu";
import { getActiveEmployees } from "@/lib/data/employees";
import { getMembers } from "@/lib/data/members";
import PosApp from "./PosApp";

export const dynamic = "force-dynamic";

export default async function PosPage() {
  const [categories, employees, members] = await Promise.all([getMenuTree(), getActiveEmployees(), getMembers()]);

  // Tickets/events aren't ready for POS ordering yet (event booking flow,
  // per-showtime ticket linkage) -- hide that category here for now.
  const orderableCategories = categories.filter((c) => c.key !== "tickets");

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Royale Cinema Lounge — POS</h1>
        <span className="text-sm text-neutral-500">{new Date().toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
      </div>
      <PosApp categories={orderableCategories} employees={employees} members={members} />
    </div>
  );
}

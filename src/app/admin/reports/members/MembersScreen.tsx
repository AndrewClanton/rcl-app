import type { MembershipAnalytics } from "@/lib/data/reports";
import { BarList, Card, Rows, Stat, num } from "../ui";

// Reports -> Members, as drawn: the page (./page.tsx) checks the sign-in
// and gets the figures.
export default function MembersScreen({ m }: { m: MembershipAnalytics }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat hero className="col-span-2" label="All members" value={num(m.total)} sub={`${num(m.newThisMonth)} joined this month`} />
        <Stat label="Insiders+ paying" value={num(m.payingInsidersPlus)} />
        <Stat label="Free through a program" value={num(m.compedMembers)} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Membership mix">
          <Rows
            rows={[
              { label: "Insiders (free)", value: num(m.insiders) },
              { label: "Insiders+ paying", value: num(m.payingInsidersPlus) },
              { label: "Insiders+ not billed", value: num(m.insidersPlus - m.payingInsidersPlus) },
              { label: "Free through a community program", value: num(m.compedMembers) },
              { label: "Joined this month", value: num(m.newThisMonth) },
              { label: "All members", value: num(m.total), strong: true },
            ]}
          />
        </Card>
        <Card title="Free members by community program" subtitle="For grant and impact reporting.">
          {m.byProgram.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No community-program members yet.</p>
          ) : (
            <BarList rows={m.byProgram.map(({ program, count }) => ({ label: program, value: count }))} format={num} />
          )}
        </Card>
      </div>
    </div>
  );
}

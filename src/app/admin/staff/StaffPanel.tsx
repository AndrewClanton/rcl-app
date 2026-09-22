"use client";

import type { EmployeeRole } from "@/lib/types";
import type { EmployeeWithEmail } from "@/lib/data/employees";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { updateEmployeeRole, setEmployeeActive } from "./actions";

const ROLE_LABEL: Record<EmployeeRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  cashier: "Cashier",
};

const ROW_GRID = "grid grid-cols-[1.3fr_1.6fr_140px_100px] items-center gap-3";

export default function StaffPanel({ employees }: { employees: EmployeeWithEmail[] }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className={`${ROW_GRID} border-b border-[var(--border)] pb-1.5 text-xs font-medium text-[var(--muted)]`}>
        <span>Name</span>
        <span>Email</span>
        <span>Role</span>
        <span>Status</span>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {employees.map((e) => (
          <EmployeeRow key={e.id} employee={e} />
        ))}
      </div>
    </div>
  );
}

function EmployeeRow({ employee }: { employee: EmployeeWithEmail }) {
  const [pending, run] = useRefreshingAction();
  const isOwner = employee.role === "owner";

  return (
    <div className={`${ROW_GRID} py-2.5 text-sm`}>
      <span className="truncate font-medium">{employee.name}</span>
      <span className="truncate text-[var(--muted)]" title={employee.email ?? undefined}>
        {employee.email ?? "—"}
      </span>
      {isOwner ? (
        <span className="stamp-tag stamp-tag-gold w-fit">Owner</span>
      ) : (
        <select
          className="rounded border border-[var(--border)] px-2 py-1 text-xs"
          value={employee.role}
          disabled={pending}
          onChange={(e) => run(() => updateEmployeeRole(employee.id, e.target.value as EmployeeRole))}
        >
          {(["cashier", "manager", "admin"] as const).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      )}
      {isOwner ? (
        <span className="text-xs text-[var(--muted)]">Active</span>
      ) : (
        <button
          disabled={pending}
          onClick={() => run(() => setEmployeeActive(employee.id, !employee.active))}
          className={`justify-self-start rounded border px-2 py-1 text-xs disabled:opacity-50 ${
            employee.active ? "border-[var(--border)] text-[var(--muted)]" : "border-[var(--danger-text)] text-[var(--danger-text)]"
          }`}
        >
          {employee.active ? "Deactivate" : "Reactivate"}
        </button>
      )}
    </div>
  );
}

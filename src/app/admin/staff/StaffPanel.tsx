"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EmployeeRole } from "@/lib/types";
import type { EmployeeWithEmail } from "@/lib/data/employees";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { createEmployee, updateEmployeeRole, setEmployeeActive } from "./actions";

const ROLE_LABEL: Record<EmployeeRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  cashier: "Cashier",
  display: "Display screen",
};

const ASSIGNABLE = ["cashier", "manager", "admin", "display"] as const;

const ROW_GRID = "grid grid-cols-[1.3fr_1.6fr_140px_100px] items-center gap-3";

export default function StaffPanel({ employees }: { employees: EmployeeWithEmail[] }) {
  return (
    <div className="space-y-6">
      <AddEmployeeForm />
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
    </div>
  );
}

function AddEmployeeForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<EmployeeRole>("cashier");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<{ name: string; email: string; password: string; role: EmployeeRole } | null>(null);

  async function submit() {
    setError(null);
    setJustAdded(null);
    setPending(true);
    try {
      await createEmployee({ name, email, password, role });
      setJustAdded({ name, email, password, role });
      setName("");
      setEmail("");
      setPassword("");
      setRole("cashier");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that person");
    } finally {
      setPending(false);
    }
  }

  const canSubmit = name.trim() && email.trim() && password.length >= 6;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="mb-3 text-sm font-semibold">Add a staff login</h2>
      {justAdded && (
        <div className="notice notice-success mb-3 !p-3 text-sm">
          Added {justAdded.name} ({justAdded.email}) as {ROLE_LABEL[justAdded.role]}. Their password is{" "}
          <span className="font-mono font-semibold select-all">{justAdded.password}</span> -- share it with them
          directly; there&apos;s no self-service way for them to change it yet, so pick something you&apos;re both fine with
          long-term.
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-[var(--muted)]">Name</label>
          <input className="rounded border border-[var(--border)] px-2 py-1 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-[var(--muted)]">Email</label>
          <input type="email" className="rounded border border-[var(--border)] px-2 py-1 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-[var(--muted)]">Password</label>
          <input
            type="text"
            placeholder="6+ characters"
            className="rounded border border-[var(--border)] px-2 py-1 text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-[var(--muted)]">Role</label>
          <select className="rounded border border-[var(--border)] px-2 py-1 text-sm" value={role} onChange={(e) => setRole(e.target.value as EmployeeRole)}>
            {ASSIGNABLE.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <button disabled={pending || !canSubmit} onClick={submit} className="btn-primary !px-4 !py-1.5 text-sm">
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      {role === "display" && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          For a TV or other unattended screen. It can only open the display screens (like the ramp countdown) -- no back office, no
          register, no member data -- so a tampered-with screen can&apos;t reach anything else. The email just has to be unique; a
          Gmail alias like you+ramptv@gmail.com works.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-[var(--danger-text)]">{error}</p>}
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
          {ASSIGNABLE.map((r) => (
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

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EmployeeRole } from "@/lib/types";
import type { EmployeeWithEmail } from "@/lib/data/employees";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { createEmployee, updateEmployeeRole, setEmployeeActive, findAccounts, makeStaff, type AccountMatch } from "./actions";

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
      <FindAccount />
      <details className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-3">
        <summary className="cursor-pointer text-sm text-[var(--muted)]">Someone with no website login, or a TV screen? Create a new login instead</summary>
        <div className="mt-3">
          <AddEmployeeForm />
        </div>
      </details>
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

// Search the people who already sign in to the website and give one of
// them a staff role. No new account, no password to make up.
function FindAccount() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AccountMatch[] | null>(null);
  const [roles, setRoles] = useState<Record<string, EmployeeRole>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; role: EmployeeRole } | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    const ticket = ++latest.current;
    if (q.length < 2) return;
    const timer = setTimeout(async () => {
      const found = await findAccounts(q).catch(() => null);
      if (ticket !== latest.current) return;
      if (!found) setError("Couldn't search right now. Try again.");
      else {
        setError(null);
        setResults(found);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  async function promote(m: AccountMatch) {
    const role = roles[m.memberId] ?? "cashier";
    setBusy(m.memberId);
    setError(null);
    setDone(null);
    const r = await makeStaff(m.memberId, role).catch(() => ({ ok: false as const, error: "Couldn't save that. Try again." }));
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setDone({ name: m.name, role });
    setResults((prev) => prev?.map((x) => (x.memberId === m.memberId ? { ...x, staffRole: role, staffActive: true } : x)) ?? null);
    router.refresh();
  }

  const shown = query.trim().length >= 2 ? results : null;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-sm font-semibold">Give someone staff access</h2>
      <p className="mb-3 text-xs text-[var(--muted)]">
        Find anyone who already signs in to the website (Google or email). They keep their own login, so there&apos;s no new account or password to make.
      </p>
      <input
        className="w-full max-w-md rounded border border-[var(--border)] px-3 py-1.5 text-sm"
        placeholder="Name or email"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setDone(null);
        }}
      />
      {done && (
        <div className="notice notice-success mt-3 !p-3 text-sm">
          {done.name} is now {ROLE_LABEL[done.role] === "Admin" ? "an" : "a"} {ROLE_LABEL[done.role]}. They sign in at <strong>/login</strong> with the same Google or email login they
          already use. Their register PIN starts as 9999.
        </div>
      )}
      {error && <p className="mt-2 text-sm text-[var(--danger-text)]">{error}</p>}
      {shown && (
        <div className="mt-3 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {shown.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-[var(--muted)]">
              No one with a website login matches. If they&apos;ve never signed in, ask them to sign in once at the website (My Account), then search again.
            </p>
          ) : (
            shown.map((m) => (
              <div key={m.memberId} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{m.name}</div>
                  <div className="truncate text-xs text-[var(--muted)]">{m.email ?? "no email"}</div>
                </div>
                {m.staffRole && m.staffActive ? (
                  <span className="text-xs text-[var(--muted)]">Already {ROLE_LABEL[m.staffRole]}</span>
                ) : (
                  <>
                    <select
                      className="rounded border border-[var(--border)] px-2 py-1 text-xs"
                      value={roles[m.memberId] ?? "cashier"}
                      onChange={(e) => setRoles((r) => ({ ...r, [m.memberId]: e.target.value as EmployeeRole }))}
                    >
                      {(["cashier", "manager", "admin"] as const).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                    <button className="btn-primary !px-3 !py-1 text-xs" disabled={busy === m.memberId} onClick={() => promote(m)}>
                      {busy === m.memberId ? "Saving…" : m.staffRole ? "Restore access" : "Make staff"}
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}
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

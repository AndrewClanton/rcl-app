"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EmployeeRole } from "@/lib/types";
import type { EmployeeWithEmail } from "@/lib/data/employees";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { TEMP_PIN_DAYS } from "@/lib/pin-rules";
import InfoTip from "@/components/help/InfoTip";
import ConfirmModal from "@/components/ConfirmModal";
import { createEmployee, updateEmployeeRole, setEmployeeActive, findAccounts, makeStaff, resetEmployeePin, createRecoveryLink, type AccountMatch } from "./actions";

const ROLE_LABEL: Record<EmployeeRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  cashier: "Cashier",
  display: "Display screen",
};

const ASSIGNABLE = ["cashier", "manager", "admin", "display"] as const;

const ROW_GRID = "grid grid-cols-[1.3fr_1.6fr_140px_100px_120px_90px] items-center gap-3";

const MANAGER_ROLES: EmployeeRole[] = ["manager", "admin", "owner"];

// The date 9999 and old temporary PINs stop approving (MANAGER_PIN_CUTOVER,
// src/lib/manager-pin.ts), and whether it's here yet. Null: not set.
export type PinCutover = { date: string; reached: boolean } | null;

// A question before a save, answered in a ConfirmModal.
type Ask = { title: string; description?: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void };

function AskModal({ ask, onClose }: { ask: Ask | null; onClose: () => void }) {
  if (!ask) return null;
  return (
    <ConfirmModal
      title={ask.title}
      description={ask.description}
      confirmLabel={ask.confirmLabel}
      danger={ask.danger}
      onCancel={onClose}
      onConfirm={() => {
        onClose();
        ask.onConfirm();
      }}
    />
  );
}

function longDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

export default function StaffPanel({ employees, pinCutover }: { employees: EmployeeWithEmail[]; pinCutover: PinCutover }) {
  // Until the cutover, 9999 still approves refunds for anyone on it.
  const stillDefault = employees.filter((e) => e.active && e.pin === "default");
  const managersOnDefault = stillDefault.filter((e) => MANAGER_ROLES.includes(e.role));
  const names = managersOnDefault.map((e) => e.name).join(", ");

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
        {managersOnDefault.length > 0 ? (
          <div className="notice notice-warn mb-3">
            {pinCutover?.reached ? (
              <>Still on PIN 9999: {names}. 9999 no longer approves anything, so they can&apos;t approve refunds until they set their own PIN (My PIN, at the top of the back office).</>
            ) : pinCutover ? (
              <>
                Still on PIN 9999: {names}. From {longDate(pinCutover.date)}, 9999 stops approving anything, so they need their own PIN (My PIN, at the top of the back office)
                before then. Until that day, anyone who knows 9999 can approve refunds.
              </>
            ) : (
              <>
                Still on PIN 9999: {names}. Until every manager picks their own PIN (My PIN, at the top of the back office), anyone who knows 9999 can approve refunds.
              </>
            )}
          </div>
        ) : stillDefault.length > 0 ? (
          <p className="mb-3 text-xs text-[var(--muted)]">
            Every manager has their own PIN, so 9999 no longer approves anything. Still on 9999 (not a manager, so it doesn&apos;t approve anything): {stillDefault.map((e) => e.name).join(", ")}.
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className={`${ROW_GRID} border-b border-[var(--border)] pb-1.5 text-xs font-medium text-[var(--muted)]`}>
              <span>Name</span>
              <span>Email</span>
              <span>
                Role
                <InfoTip topic="staff-roles" />
              </span>
              <span>Status</span>
              <span>PIN</span>
              <span>Password</span>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {employees.map((e) => (
                <EmployeeRow key={e.id} employee={e} pinCutover={pinCutover} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// A new temporary PIN, shown once for the owner to pass on in person.
function TempPin({ pin }: { pin: string }) {
  return <strong className="font-mono tracking-widest select-all">{pin}</strong>;
}

// What the owner is asked before giving staff access to a login that never
// proved its email is theirs.
function emailCheck(m: AccountMatch): Omit<Ask, "onConfirm"> {
  const first = m.name.split(" ")[0];
  return {
    title: `Check that this is ${first}'s email`,
    description: `${m.email ?? "This login"} never proved it belongs to them, so anyone could have made it with ${first}'s address, and staff access would go to whoever did.\n\nOnly go on if you checked with ${first} in person that this is their email.`,
    confirmLabel: "I checked in person",
  };
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
  const [done, setDone] = useState<{ name: string; role: EmployeeRole; pin: string | null } | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
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

  // An unproven email is checked first, then a manager or admin role.
  function promote(m: AccountMatch) {
    const role = roles[m.memberId] ?? "cashier";
    const askRole = (checked: boolean) =>
      role === "cashier" ? save(m, role, checked) : setAsk({ ...roleChangePrompt(m.name, role), confirmLabel: `Make ${ROLE_LABEL[role].toLowerCase()}`, onConfirm: () => save(m, role, checked) });
    if (m.verified) askRole(false);
    else setAsk({ ...emailCheck(m), onConfirm: () => askRole(true) });
  }

  async function save(m: AccountMatch, role: EmployeeRole, checked: boolean) {
    setBusy(m.memberId);
    setError(null);
    setDone(null);
    const r = await makeStaff(m.memberId, role, checked).catch(() => ({ ok: false as const, error: "Couldn't save that. Try again.", needsCheck: undefined }));
    setBusy(null);
    if (!r.ok) {
      // The list said proven but the server disagrees: ask next time.
      if (r.needsCheck) setResults((prev) => prev?.map((x) => (x.memberId === m.memberId ? { ...x, verified: false } : x)) ?? null);
      return setError(r.error);
    }
    setDone({ name: m.name, role, pin: r.pin });
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
          already use.{" "}
          {done.pin ? (
            <>
              Their temporary PIN is <TempPin pin={done.pin} />. Tell them in person; it isn&apos;t shown again. The back office asks them to pick their own under My PIN.
            </>
          ) : (
            <>They keep the PIN they had before.</>
          )}
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
                  {!m.verified && !m.staffActive && (
                    <div className="text-xs text-[var(--danger-text)]">This login never proved the email is theirs. Check with them in person that this is really their account.</div>
                  )}
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
      <AskModal ask={ask} onClose={() => setAsk(null)} />
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
  const [justAdded, setJustAdded] = useState<{ name: string; email: string; password: string; role: EmployeeRole; reused: boolean; pin: string | null } | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);

  function submit() {
    if (role === "admin" || role === "manager") setAsk({ ...roleChangePrompt(name.trim() || "this person", role), confirmLabel: "Add", onConfirm: save });
    else save();
  }

  async function save() {
    setError(null);
    setJustAdded(null);
    setPending(true);
    try {
      const r = await createEmployee({ name, email, password, role });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setJustAdded({ name, email, password, role, reused: r.reused, pin: r.pin });
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
          Added {justAdded.name} ({justAdded.email}) as {ROLE_LABEL[justAdded.role]}.{" "}
          {justAdded.reused ? (
            <>They already had a login with that email, so they sign in with it as usual. The password you typed wasn&apos;t used.</>
          ) : (
            <>
              Their password is <span className="font-mono font-semibold select-all">{justAdded.password}</span> -- share it with them
              directly; there&apos;s no self-service way for them to change it yet, so pick something you&apos;re both fine with
              long-term.
            </>
          )}
          {justAdded.pin && (
            <>
              {" "}
              Their temporary PIN is <TempPin pin={justAdded.pin} />. Tell them in person; it isn&apos;t shown again. The back office asks them to pick their own under My PIN.
            </>
          )}
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
          <div className="mb-1 text-xs text-[var(--muted)]">
            <label>Role</label>
            <InfoTip topic="staff-roles" />
          </div>
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
          For a TV or other unattended screen. It can only open the display screens (like the Now Playing screen) -- no back office, no
          register, no member data -- so a tampered-with screen can&apos;t reach anything else. The email just has to be unique; a
          Gmail alias like you+nowplaying@gmail.com works.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-[var(--danger-text)]">{error}</p>}
      <AskModal ask={ask} onClose={() => setAsk(null)} />
    </div>
  );
}

// What the owner is asked before giving someone a role. Admin gets the
// strongest warning: it's the whole back office short of this page.
function roleChangePrompt(name: string, to: EmployeeRole, from?: EmployeeRole): Omit<Ask, "onConfirm"> {
  switch (to) {
    case "admin":
      return {
        title: `Make ${name} an ADMIN?`,
        description: `Admins get everything in the back office except this Staff page: every report and refund, member records, the menu, the team schedule, and the admin-only tools. Their PIN approves refunds.\n\nOnly give this to someone you'd trust with the whole business.`,
      };
    case "manager":
      return { title: `Make ${name} a manager?`, description: "Managers change the menu, run the team schedule and training, and their PIN approves refunds and cancelled tabs." };
    case "display":
      return {
        title: `Turn ${name}'s login into a display-screen login?`,
        description: `It will only open the signage screens.${from ? " They lose the back office and the register." : ""}`,
        danger: !!from,
      };
    default:
      return from && from !== "cashier"
        ? { title: `Change ${name} to cashier?`, description: `They lose the ${ROLE_LABEL[from].toLowerCase()} tools, and their PIN stops approving refunds.`, danger: true }
        : { title: `Change ${name} to cashier?` };
  }
}

function EmployeeRow({ employee, pinCutover }: { employee: EmployeeWithEmail; pinCutover: PinCutover }) {
  const [pending, run] = useRefreshingAction();
  const [ask, setAsk] = useState<Ask | null>(null);
  const isOwner = employee.role === "owner";

  return (
    <div className={`${ROW_GRID} py-2.5 text-sm`}>
      <span className="truncate font-medium">{employee.name}</span>
      <span className="truncate text-[var(--muted)]" title={employee.email ?? undefined}>
        {employee.email ?? "—"}
      </span>
      {isOwner ? (
        // The owner's own role is never a dropdown: no accidental self-demotion.
        <span className="stamp-tag stamp-tag-gold w-fit">Owner</span>
      ) : (
        <select
          className="rounded border border-[var(--border)] px-2 py-1 text-xs"
          value={employee.role}
          disabled={pending}
          onChange={(e) => {
            const to = e.target.value as EmployeeRole;
            // Cancelling leaves the dropdown on their current role (it shows the saved value).
            setAsk({ ...roleChangePrompt(employee.name, to, employee.role), confirmLabel: "Change role", onConfirm: () => run(() => updateEmployeeRole(employee.id, to)) });
          }}
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
          onClick={() => {
            if (!employee.active) return run(() => setEmployeeActive(employee.id, true));
            setAsk({
              title: `Deactivate ${employee.name}?`,
              description: "They can't sign in to the back office or use their PIN until you reactivate them.",
              confirmLabel: "Deactivate",
              danger: true,
              onConfirm: () => run(() => setEmployeeActive(employee.id, false)),
            });
          }}
          className={`justify-self-start rounded border px-2 py-1 text-xs disabled:opacity-50 ${
            employee.active ? "border-[var(--border)] text-[var(--muted)]" : "border-[var(--danger-text)] text-[var(--danger-text)]"
          }`}
        >
          {employee.active ? "Deactivate" : "Reactivate"}
        </button>
      )}
      <PinCell employee={employee} pinCutover={pinCutover} />
      <PasswordCell employee={employee} />
      <AskModal ask={ask} onClose={() => setAsk(null)} />
    </div>
  );
}

// A one-time link to set a new password, for someone locked out of their
// login while email isn't set up. Shown once, here, for the owner to hand
// over; anyone with it can get into that login, so the panel says so.
function PasswordCell({ employee }: { employee: EmployeeWithEmail }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ link: string; email: string; passwordLogin: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  const firstName = employee.name.split(" ")[0];

  async function make() {
    setBusy(true);
    setError(null);
    setCopied(false);
    const r = await createRecoveryLink(employee.id).catch(() => ({ ok: false as const, error: "Couldn't make a reset link. Try again." }));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setResult({ link: r.link, email: r.email, passwordLogin: r.passwordLogin });
  }

  if (!employee.email) return <span className="col-start-6 row-start-1 text-xs text-[var(--muted)]">—</span>;

  return (
    <>
      {/* Pinned to the first row's last column, so the PIN panel opening below doesn't push it down. */}
      <span className="col-start-6 row-start-1">
        <button className="text-xs text-[var(--muted)] underline hover:text-[var(--foreground)] disabled:opacity-50" disabled={busy} onClick={() => setAsking(true)}>
          {busy ? "Making…" : "Reset link"}
        </button>
      </span>
      {asking && (
        <ConfirmModal
          title={`Make a password reset link for ${employee.name}?`}
          description={`Anyone who opens it can set a new password and sign in as ${firstName}. Give it only to ${firstName}.`}
          confirmLabel="Make link"
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            make();
          }}
        />
      )}
      {error && <p className="col-span-full text-xs text-[var(--danger-text)]">{error}</p>}
      {result && (
        <div className="notice notice-warn col-span-full !p-3 text-sm">
          <div className="mb-1.5 font-semibold">Password reset link for {employee.name}</div>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly className="input min-w-0 flex-1 !py-1 font-mono text-xs" value={result.link} onFocus={(e) => e.currentTarget.select()} />
            <button
              className="btn-primary !px-3 !py-1 text-xs"
              onClick={() => {
                navigator.clipboard?.writeText(result.link).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              className="text-xs text-[var(--muted)] underline"
              onClick={() => {
                setResult(null);
                setCopied(false);
              }}
            >
              Done
            </button>
          </div>
          <p className="mt-2 text-xs">
            Give this only to {firstName}: text it to them, or open it on their phone. It opens a page where they pick a new password for {result.email}, then they sign in at
            /login as usual. Anyone who has this link can get into {firstName}&apos;s login, so don&apos;t post it anywhere others can see. It works once and runs out after about
            an hour; make another if it does. It isn&apos;t shown again after you close this.
          </p>
          {!result.passwordLogin && (
            <p className="mt-1 text-xs">
              {firstName} signs in with Google, which doesn&apos;t use a password. If Google sign-in still works for them, they don&apos;t need this; setting a password just adds
              email-and-password sign-in alongside it.
            </p>
          )}
        </div>
      )}
    </>
  );
}

const PIN_LABEL: Record<EmployeeWithEmail["pin"], string> = {
  default: "Still 9999",
  temporary: "Temporary",
  own: "Their own",
  none: "—",
};

// Where they stand on their PIN, and a reset for someone who forgot theirs:
// a new random temporary PIN, shown here once for the owner to tell them,
// and the back office asks them to change it.
function PinCell({ employee, pinCutover }: { employee: EmployeeWithEmail; pinCutover: PinCutover }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPin, setNewPin] = useState<string | null>(null);
  const firstName = employee.name.split(" ")[0];

  async function reset() {
    setBusy(true);
    setError(null);
    setNewPin(null);
    const r = await resetEmployeePin(employee.id).catch(() => ({ ok: false as const, error: "Couldn't save that. Try again." }));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setNewPin(r.pin);
    router.refresh();
  }

  if (employee.pin === "none") return <span className="text-xs text-[var(--muted)]">—</span>;

  return (
    <>
      <span className="flex items-center gap-2 text-xs">
        <span className={employee.pin === "default" ? "text-[var(--warn-text)]" : "text-[var(--muted)]"}>{PIN_LABEL[employee.pin]}</span>
        <button className="text-[var(--muted)] underline hover:text-[var(--foreground)] disabled:opacity-50" disabled={busy} onClick={() => setAsking(true)}>
          {busy ? "Making…" : "Reset"}
        </button>
      </span>
      {asking && (
        <ConfirmModal
          title={`New temporary PIN for ${employee.name}?`}
          description={`For someone who forgot theirs. Their current PIN stops working straight away, and the new one is shown here once for you to tell ${firstName} in person.`}
          confirmLabel="Make a new PIN"
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            reset();
          }}
        />
      )}
      {error && <p className="col-span-full text-xs text-[var(--danger-text)]">{error}</p>}
      {newPin && (
        <div className="notice notice-success col-span-full flex flex-wrap items-center gap-x-3 gap-y-1 !p-2.5 text-xs">
          <span className="min-w-0 flex-1">
            {firstName}&apos;s temporary PIN is <TempPin pin={newPin} />. Tell them in person; it isn&apos;t shown again after you close this. Next time they open the back
            office, it asks them to pick their own under My PIN.
            {pinCutover && MANAGER_ROLES.includes(employee.role) && <> A temporary PIN stops approving refunds after {TEMP_PIN_DAYS} days, so they should do it soon.</>}
          </span>
          <button className="text-[var(--muted)] underline" onClick={() => setNewPin(null)}>
            Done
          </button>
        </div>
      )}
    </>
  );
}

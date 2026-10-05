"use client";

import { useEffect, useState } from "react";
import { ORG_ROLES, roleLabel, type OrgRole } from "@/lib/orgs";
import { getMemberOrgChoice, setMemberOrg, type MemberOrgChoice } from "./org-actions";

// "Add to organization" in the press-and-hold member panel (MemberGlance),
// beside the Organization label: pick an organization account (Back office
// → Organizations) and a role. Any cashier, no PIN. onChanged: the
// register looks up the member's comps again.
export default function OrgAccountPicker({ memberId, onChanged }: { memberId: string; onChanged?: () => void }) {
  const [choice, setChoice] = useState<MemberOrgChoice | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [orgId, setOrgId] = useState("");
  const [role, setRole] = useState<OrgRole>("supported");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getMemberOrgChoice(memberId).then(
      (c) => live && setChoice(c),
      () => live && setChoice(null),
    );
    return () => {
      live = false;
    };
  }, [memberId]);

  if (!choice) return null;

  async function save(next: string | null) {
    setSaving(true);
    setError(null);
    const r = await setMemberOrg(memberId, next, next ? role : null).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
    setSaving(false);
    if (!r.ok) return setError(r.error);
    const org = next ? choice?.orgs.find((o) => o.id === next) : null;
    setChoice((c) => (c ? { ...c, current: org ? { orgId: org.id, orgName: org.name, role } : null } : c));
    setOpen(false);
    onChanged?.();
  }

  const current = choice.current;
  return (
    <div className="mt-2 text-sm">
      {!open ? (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate" style={{ color: current ? "var(--foreground)" : "var(--muted)" }}>
            {current ? (
              <>
                <strong>{current.orgName}</strong> · {roleLabel(current.role)}
              </>
            ) : (
              "No organization account"
            )}
          </span>
          <button
            className="btn-secondary shrink-0 !px-2.5 !py-1.5 !text-xs"
            onClick={() => {
              setOrgId(current?.orgId ?? choice.orgs[0]?.id ?? "");
              setRole(current?.role ?? "supported");
              setOpen(true);
            }}
            disabled={!choice.orgs.length && !current}
            title={!choice.orgs.length ? "Make one in Back office → Organizations first" : undefined}
          >
            {current ? "Change" : "Add to organization"}
          </button>
        </div>
      ) : (
        <div className="space-y-2 rounded-md border p-2" style={{ borderColor: "var(--border)" }}>
          <select className="input w-full" value={orgId} onChange={(e) => setOrgId(e.target.value)} aria-label="Organization">
            {choice.orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            {ORG_ROLES.map((r) => (
              <label key={r.value} className="flex flex-1 items-center gap-1.5 text-xs" title={r.hint}>
                <input type="radio" name={`org-role-${memberId}`} checked={role === r.value} onChange={() => setRole(r.value)} />
                {r.label}
              </label>
            ))}
          </div>
          {error && (
            <p className="text-xs" style={{ color: "var(--danger-text)" }} role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button className="btn-primary flex-1 !py-1.5 text-xs" disabled={saving || !orgId} onClick={() => save(orgId)}>
              Save
            </button>
            {current && (
              <button className="btn-secondary !py-1.5 text-xs" disabled={saving} onClick={() => save(null)}>
                Take out
              </button>
            )}
            <button className="btn-secondary !py-1.5 text-xs" disabled={saving} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import type { MemberStaffInfo } from "@/lib/data/employees";

const ROLE_LABEL = { owner: "Owner", admin: "Admin", manager: "Manager", cashier: "Staff", display: "Display" } as const;

export default function StaffBadge({ info }: { info: MemberStaffInfo | undefined }) {
  if (!info) return null;
  const elevated = info.role === "owner" || info.role === "admin";
  return (
    <>
      <span
        className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
          elevated ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]" : "border-[var(--foreground)] text-[var(--foreground)]"
        }`}
        title="This member account is also a staff login"
      >
        {ROLE_LABEL[info.role]}
      </span>
      {info.isViewer && <span className="rounded-full border border-[var(--accent)] bg-[var(--accent)] px-2 py-0.5 text-xs font-semibold text-white">You</span>}
    </>
  );
}

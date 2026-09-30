import { requireStaff, hasManagerAccess } from "@/lib/auth";
import { getPinStatus } from "@/lib/data/employees";
import PageHeader from "@/components/admin/PageHeader";
import MyPinForm from "./MyPinForm";

export const dynamic = "force-dynamic";

// Anyone signed in to the back office sets their own PIN here. Linked from
// the top of every back-office page (and from the "still 9999" banner).
export default async function MyPinPage() {
  const staff = await requireStaff();
  const status = await getPinStatus(staff.employeeId);

  return (
    <div className="max-w-md">
      <PageHeader
        eyebrow="You"
        title="My PIN"
        purpose={
          hasManagerAccess(staff.role)
            ? "You type this on the register to approve refunds and cancelled tabs, and in the back office to cancel a booth booking. Each approval shows whose PIN it was, so keep it to yourself."
            : "Your own PIN, 4 to 6 digits. Keep it to yourself."
        }
        className="!mb-4"
      />
      {/* The layout's banner already says when it's still 9999 or temporary. */}
      {status === "temporary" && <p className="mb-3 text-sm">For your current PIN, type the temporary one the owner gave you.</p>}
      {/* Unreadable status: ask for the current PIN anyway; the server decides. */}
      <MyPinForm needsCurrent={status !== "default"} />
      {status !== "default" && <p className="mt-3 text-xs text-[var(--muted)]">Forgot your current PIN? Ask the owner to set you a temporary one on the Staff page.</p>}
    </div>
  );
}

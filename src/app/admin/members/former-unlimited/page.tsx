import { requireManager } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { getFormerUnlimited } from "@/lib/data/legacy-unlimited";
import FormerUnlimitedList, { SHOW, type FormerUnlimitedShow } from "./FormerUnlimitedList";

export const dynamic = "force-dynamic";

// Former unlimited members (lib/legacy-plus.ts): who paid for unlimited on
// the old website, and whether their Insiders+ is set up here yet. They're
// set up in person: the register flags them ("No payment on file for
// unlimited membership") with their card on the reader or a link for their
// phone. Read-only, and nothing here sends email. Managers and up.
export default async function FormerUnlimitedPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireManager();
  const { show: raw } = await searchParams;
  const show: FormerUnlimitedShow = SHOW.find((s) => s.key === raw)?.key ?? "all";
  const result = await getFormerUnlimited();

  return (
    <div className="space-y-4">
      <PageHeader
        area="guests"
        back={{ href: "/admin/members", label: "Members" }}
        title="Former unlimited members"
        purpose="Paid for unlimited on the old website, whose billing never charged them. They're set up in person: the register flags them when they check in or go on an order. Nothing here sends email."
      />
      {result.ok ? <FormerUnlimitedList report={result.report} show={show} /> : <div className="notice notice-warn">{result.error}</div>}
    </div>
  );
}

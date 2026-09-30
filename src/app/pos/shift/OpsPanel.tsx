"use client";

import { useEffect, useState } from "react";
import type { OnShift, ShiftStatus } from "@/lib/ops/shared";
import ChecklistTab from "./ChecklistTab";
import ParCountTab from "./ParCountTab";
import ShoppingListTab from "./ShoppingListTab";
import HistoryTab from "./HistoryTab";
import RemindersTab, { type SnoozedReminder } from "./RemindersTab";

export type OpsTab = "checklist" | "par" | "shopping" | "history" | "reminders";

const TABS: { id: OpsTab; label: string }[] = [
  { id: "checklist", label: "Checklist" },
  { id: "par", label: "Par count" },
  { id: "shopping", label: "Shopping list" },
  { id: "history", label: "History" },
  { id: "reminders", label: "Reminders" },
];

// Full-screen panel over the register for the shift tools.
export default function OpsPanel({
  tab,
  closing,
  manager,
  me,
  status,
  staff,
  snoozed,
  onUnsnooze,
  onTab,
  onChanged,
  onClose,
  onFinishClosing,
}: {
  tab: OpsTab;
  closing: boolean;
  // A manager's using the register: the shopping list shows what ran out.
  manager: boolean;
  me: OnShift | null;
  status: ShiftStatus | null;
  staff: { id: string; name: string }[];
  // Reminders put off with "Remind me later" on this iPad, listed on the
  // Reminders tab until they come back.
  snoozed: SnoozedReminder[];
  onUnsnooze: (key: string) => void;
  onTab: (t: OpsTab) => void;
  onChanged: () => void;
  onClose: () => void;
  onFinishClosing: () => void;
}) {
  // Just saved a par count: the Shopping list tab opens on "Since the last
  // count" first.
  const [justCounted, setJustCounted] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ background: "var(--background)" }} role="dialog" aria-modal="true" aria-label="Shift tools">
      <div className="flex flex-wrap items-center gap-2 border-b-2 px-4 py-3" style={{ borderColor: "var(--foreground)", background: "var(--surface)" }}>
        <nav className="flex flex-wrap gap-1.5" aria-label="Shift tools">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`min-h-11 rounded-full border-2 px-4 py-2 text-sm font-bold transition-colors ${t.id === tab ? "text-[var(--background)]" : ""}`}
              style={{ borderColor: "var(--foreground)", background: t.id === tab ? "var(--foreground)" : "transparent" }}
              aria-current={t.id === tab ? "page" : undefined}
              onClick={() => {
                setJustCounted(false);
                onTab(t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span style={{ color: "var(--muted)" }}>{me ? `You: ${me.name}` : "Nobody on shift at this register"}</span>
          <button className="btn-secondary min-h-11 !px-4 !py-2" onClick={onClose}>
            Back to register
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-6">
          {tab === "checklist" && <ChecklistTab status={status} me={me} staff={staff} onChanged={onChanged} />}
          {tab === "par" && (
            <ParCountTab
              me={me}
              closing={closing}
              onSubmitted={() => {
                onChanged();
                setJustCounted(true);
                onTab("shopping");
              }}
            />
          )}
          {tab === "shopping" && (
            <ShoppingListTab me={me} manager={manager} closing={closing} justCounted={justCounted} onFinishClosing={onFinishClosing} onChanged={onChanged} />
          )}
          {tab === "history" && <HistoryTab />}
          {tab === "reminders" && <RemindersTab me={me} staff={staff} snoozed={snoozed} onUnsnooze={onUnsnooze} onChanged={onChanged} />}
        </div>
      </div>
    </div>
  );
}

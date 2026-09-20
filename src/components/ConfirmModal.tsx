"use client";

// A native window.confirm() replacement, for the same reason as
// PromptModal: unreliable in embedded/kiosk webviews.
export default function ConfirmModal({
  title,
  description,
  confirmLabel = "Confirm",
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-xs text-center shadow-2xl">
        <h3 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          {title}
        </h3>
        {description && (
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {description}
          </p>
        )}
        <div className="mt-4 flex justify-center gap-2">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors"
            style={{ background: danger ? "var(--foreground)" : "var(--accent)", color: danger ? "var(--background)" : "var(--accent-foreground)" }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

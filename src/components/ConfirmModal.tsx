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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-xl dark:bg-neutral-900">
        <h3 className="text-lg font-semibold">{title}</h3>
        {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
        <div className="mt-4 flex justify-center gap-2">
          <button className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`rounded px-3 py-1.5 text-sm text-white ${danger ? "bg-red-600" : "bg-neutral-900 dark:bg-neutral-100 dark:text-neutral-900"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

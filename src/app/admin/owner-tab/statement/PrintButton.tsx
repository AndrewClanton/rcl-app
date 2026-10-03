"use client";

// The statement's Print button (the back office's menus stay off paper).
export default function PrintButton() {
  return (
    <button className="btn-primary min-h-11 print:hidden" onClick={() => window.print()}>
      Print statement
    </button>
  );
}

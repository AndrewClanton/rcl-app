"use client";

export default function PrintCardsButton() {
  return (
    <button className="btn-primary min-h-11" onClick={() => window.print()}>
      Print
    </button>
  );
}

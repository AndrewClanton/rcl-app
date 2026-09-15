import MembershipForm from "./MembershipForm";

export default function MembershipPage() {
  return (
    <div>
      <h1 className="font-display mb-2 text-3xl font-semibold">Join Insiders</h1>
      <p className="mb-8 max-w-2xl text-[var(--muted)]">Free to join. Earn points on every order and get a discount every visit.</p>

      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        <div className="card">
          <div className="font-medium text-[var(--accent)]">Insiders</div>
          <div className="mt-1 text-sm text-[var(--muted)]">5% off every order, plus loyalty points (100 pts = $5 off).</div>
        </div>
        <div className="card">
          <div className="font-medium text-[var(--accent)]">Insiders+</div>
          <div className="mt-1 text-sm text-[var(--muted)]">10% off every order and faster point accrual. Ask staff in person to upgrade.</div>
        </div>
      </div>

      <MembershipForm />
    </div>
  );
}

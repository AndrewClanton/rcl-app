import MembershipForm from "./MembershipForm";

export default function MembershipPage() {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Join Insiders</h1>
      <p className="mb-6 max-w-2xl text-neutral-600 dark:text-neutral-400">
        Free to join. Earn points on every order and get a discount every visit.
      </p>

      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="font-medium">Insiders</div>
          <div className="mt-1 text-sm text-neutral-500">5% off every order, plus loyalty points (100 pts = $5 off).</div>
        </div>
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="font-medium">Insiders+</div>
          <div className="mt-1 text-sm text-neutral-500">10% off every order and faster point accrual. Ask staff in person to upgrade.</div>
        </div>
      </div>

      <MembershipForm />
    </div>
  );
}

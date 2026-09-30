import ReportsNav from "./ReportsNav";

// Every report shares the tabs: Day, Week, Month, Box office, Sales tax,
// Bar usage, Members. Each page checks the staff sign-in itself as well as
// the back office's layout (a layout alone doesn't guard a page's data).
export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between gap-3 print:hidden">
        <h1 className="text-2xl font-bold">Reports</h1>
      </div>
      <ReportsNav />
      {children}
    </div>
  );
}

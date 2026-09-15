import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h1 className="text-xl font-semibold">Royale Cinema Lounge — Back office</h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/admin" className="hover:underline">
            Dashboard
          </Link>
          <Link href="/admin/menu" className="hover:underline">
            Menu
          </Link>
          <Link href="/admin/screenings" className="hover:underline">
            Showtimes
          </Link>
          <Link href="/" className="text-neutral-500 hover:underline">
            View site
          </Link>
        </nav>
      </div>
      {children}
    </div>
  );
}

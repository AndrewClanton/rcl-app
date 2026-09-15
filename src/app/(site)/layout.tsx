import Link from "next/link";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link href="/" className="text-lg font-semibold">
            Royale Cinema Lounge
          </Link>
          <nav className="flex gap-5 text-sm">
            <Link href="/showtimes" className="hover:underline">
              Showtimes
            </Link>
            <Link href="/menu" className="hover:underline">
              Menu
            </Link>
            <Link href="/events" className="hover:underline">
              Private events
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t border-neutral-200 px-4 py-6 text-center text-xs text-neutral-500 dark:border-neutral-800">
        Royale Cinema Lounge — Joplin, MO
      </footer>
    </div>
  );
}

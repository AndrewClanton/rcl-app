import Image from "next/image";
import Link from "next/link";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-0">
          <Link href="/" className="flex shrink-0 items-center">
            <Image src="/photos/logo.png" alt="Royale Cinema Lounge" width={1434} height={505} priority className="h-8 w-auto sm:h-9" />
          </Link>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--muted)]">
            <Link href="/showtimes" className="transition-colors hover:text-[var(--accent)]">
              Showtimes
            </Link>
            <Link href="/menu" className="transition-colors hover:text-[var(--accent)]">
              Menu
            </Link>
            <Link href="/events" className="transition-colors hover:text-[var(--accent)]">
              Private events
            </Link>
            <Link href="/membership" className="transition-colors hover:text-[var(--accent)]">
              Insiders
            </Link>
            <Link href="/about" className="transition-colors hover:text-[var(--accent)]">
              About
            </Link>
            <Link href="/account" className="transition-colors hover:text-[var(--accent)]">
              My Account
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{children}</main>
      <footer className="border-t border-[var(--border)] px-4 py-8 text-center text-xs text-[var(--muted)]">
        <div>Royale Cinema Lounge — 715 E Broadway, Joplin, MO 64801</div>
        <div className="mt-1">
          <a href="tel:+14172814172" className="hover:text-[var(--accent)]">
            417-281-4172
          </a>
          {" · "}
          <a href="mailto:info@royalecinemajoplin.com" className="hover:text-[var(--accent)]">
            info@royalecinemajoplin.com
          </a>
        </div>
      </footer>
    </div>
  );
}

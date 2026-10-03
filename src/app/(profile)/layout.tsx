import Link from "next/link";
import { ColorBar, Sprockets } from "@/components/print";

// Members' shared profile pages (/m/<handle>, lib/member-profile.ts). The
// public site's look, but a frame of their own rather than the (site)
// layout: no main navigation (someone opening a friend's link sees the
// friend first), and none of the theater's search-engine data on a page
// that's kept out of search engines anyway. Nothing here reads a login.
export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site flex min-h-full flex-col bg-[var(--background)]">
      <header className="border-b-[3px] border-[var(--foreground)] bg-[var(--background)]">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="font-display text-base leading-tight sm:text-xl">
            ROYALE CINEMA LOUNGE
          </Link>
          <Link href="/showtimes" className="shrink-0 text-sm font-bold text-[var(--accent)] hover:underline">
            Showtimes →
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:py-10">{children}</main>
      <footer className="mt-6 border-t-[3px] border-[var(--foreground)]">
        <Sprockets className="mx-4 mt-3" />
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm">
          <div>
            <div className="font-display text-base">Royale Cinema Lounge</div>
            <div className="text-[var(--muted)]">Dine-in cinema and bar · 715 E Broadway, Joplin, MO</div>
            <div className="mt-1 text-[var(--muted)]">
              <Link href="/privacy" className="hover:text-[var(--accent)]">
                Privacy policy
              </Link>
            </div>
          </div>
          <ColorBar size={12} />
        </div>
      </footer>
    </div>
  );
}

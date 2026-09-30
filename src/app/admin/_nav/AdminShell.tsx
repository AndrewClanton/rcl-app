"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { signOut } from "@/app/login/actions";
import type { NavBadges } from "@/lib/data/backoffice";
import type { AreaKey } from "./areas";
import type { BackOfficeNav, NavGroup, NavLink } from "./map";
import { activeHref } from "./active";
import Badge from "./Badge";
import FindAnything from "./FindAnything";
import { FIND_EVENT } from "./FindButton";
import { ChevronIcon, CloseIcon, MenuIcon, SearchIcon } from "./icons";

// The back office's frame: a sidebar on an iPad or computer, a Menu button
// and drawer on a phone, and Find anything on top of both. The pages go in
// the middle. What's on the menu comes from ./map.ts, already cut down to
// what this person's role can open.

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", manager: "Manager", cashier: "Staff" };

// Which sections of the menu someone folded away, remembered on this
// device only. Setup starts folded (it's the rarely-needed stuff); the
// section with the page you're on is always open.
const FOLD_KEY = "rcl.backoffice.folded";
const DEFAULT_FOLDED = ["setup"];
const foldListeners = new Set<() => void>();

function readFolded(): string {
  try {
    return window.localStorage.getItem(FOLD_KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribeFolded(cb: () => void) {
  foldListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    foldListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function parseFolded(raw: string | null): string[] {
  if (!raw) return DEFAULT_FOLDED;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : DEFAULT_FOLDED;
  } catch {
    return DEFAULT_FOLDED;
  }
}

function setFolded(list: string[]) {
  try {
    window.localStorage.setItem(FOLD_KEY, JSON.stringify(list));
  } catch {
    // Private browsing: it just won't be remembered.
  }
  foldListeners.forEach((l) => l());
}

function useFolded() {
  const raw = useSyncExternalStore(subscribeFolded, readFolded, () => null);
  const folded = parseFolded(raw);
  const toggle = (key: string) => setFolded(folded.includes(key) ? folded.filter((k) => k !== key) : [...folded, key]);
  return { folded, toggle };
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export default function AdminShell({
  nav,
  badges,
  me,
  children,
}: {
  nav: BackOfficeNav;
  badges: NavBadges;
  me: { name: string; role: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [drawer, setDrawer] = useState(false);
  const [finding, setFinding] = useState(false);

  const allLinks = [nav.home, ...nav.groups.flatMap((g) => g.links), ...nav.you];
  const active = activeHref(
    allLinks.map((l) => l.href),
    pathname,
    search
  );
  const here = allLinks.find((l) => l.href === active) ?? null;
  const hereArea = nav.groups.find((g) => g.links.some((l) => l.href === active))?.area ?? null;
  // Anything amber or red anywhere on the menu, for the phone's Menu button.
  const tones = Object.values(badges).map((b) => b?.tone);
  const alert = tones.includes("danger") ? "var(--danger-text)" : tones.includes("warn") ? "#d99a1e" : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setFinding(true);
      } else if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        setFinding(true);
      }
    };
    const onFind = () => {
      setDrawer(false);
      setFinding(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(FIND_EVENT, onFind);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(FIND_EVENT, onFind);
    };
  }, []);

  const menu = (onNavigate?: () => void) => (
    <SideNav
      nav={nav}
      badges={badges}
      me={me}
      active={active}
      activeArea={hereArea}
      onFind={() => {
        setDrawer(false);
        setFinding(true);
      }}
      onNavigate={onNavigate}
    />
  );

  return (
    <div className="flex w-full flex-1 flex-col md:flex-row">
      {/* Phone: a slim bar with the Menu button, where you are, and Find. */}
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--surface)] px-2 md:hidden print:hidden">
        <button
          type="button"
          onClick={() => setDrawer(true)}
          aria-expanded={drawer}
          aria-controls="bo-drawer"
          className="relative inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold hover:bg-[var(--surface-hover)]"
        >
          <MenuIcon />
          Menu
          {alert && (
            <>
              <span className="absolute right-1.5 top-2 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--surface)]" style={{ background: alert }} aria-hidden />
              <span className="sr-only">(something needs a look)</span>
            </>
          )}
        </button>
        <div className={`flex min-w-0 flex-1 items-center justify-center gap-2 text-sm font-semibold ${hereArea ? `bo-area-${hereArea}` : ""}`}>
          {hereArea && <span className="bo-dot" />}
          <span className="truncate">{here?.label ?? "Back office"}</span>
        </div>
        <button
          type="button"
          onClick={() => setFinding(true)}
          aria-label="Find anything"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-[var(--surface-hover)]"
        >
          <SearchIcon />
        </button>
      </header>

      {/* iPad and up: the sidebar, pinned while the page scrolls. */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 self-start border-r border-[var(--border)] bg-[var(--surface)] md:block lg:w-64 print:hidden">
        {menu()}
      </aside>

      {drawer && <Drawer onClose={() => setDrawer(false)}>{menu(() => setDrawer(false))}</Drawer>}

      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 print:max-w-none print:p-0">{children}</div>
      </main>

      {finding && <FindAnything entries={nav.find} badges={badges} onClose={() => setFinding(false)} />}
    </div>
  );
}

function Drawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div id="bo-drawer" className="fixed inset-0 z-50 md:hidden print:hidden" role="dialog" aria-modal="true" aria-label="Back office menu">
      <button type="button" aria-label="Close the menu" tabIndex={-1} className="absolute inset-0 cursor-default bg-black/40" onClick={onClose} />
      <div className="absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col bg-[var(--surface)] shadow-2xl">
        <button
          type="button"
          autoFocus
          onClick={onClose}
          aria-label="Close the menu"
          className="absolute right-2 top-2 z-10 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-hover)]"
        >
          <CloseIcon />
        </button>
        {children}
      </div>
    </div>
  );
}

function SideNav({
  nav,
  badges,
  me,
  active,
  activeArea,
  onFind,
  onNavigate,
}: {
  nav: BackOfficeNav;
  badges: NavBadges;
  me: { name: string; role: string };
  active: string | null;
  activeArea: AreaKey | null;
  onFind: () => void;
  onNavigate?: () => void;
}) {
  const { folded, toggle } = useFolded();
  const list = useRef<HTMLElement>(null);
  const youActive = nav.you.some((l) => l.href === active);

  // Keep the page you're on in view when the menu is longer than the screen.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[aria-current=page]")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // You (hours, PIN, help) stays tucked away unless opened or you're on one of its pages.
  const [youShown, setYouShown] = useState(false);
  const youOpen = youShown || youActive;
  const pinBadge = badges.pin;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 p-3 pb-2">
        <Link href="/admin" onClick={onNavigate} className="block rounded-lg px-2 py-1.5">
          <span className="font-display block text-lg leading-tight">Royale</span>
          <span className="block text-xs text-[var(--muted)]">Back office</span>
        </Link>
        <button
          type="button"
          onClick={onFind}
          title="Find anything (Ctrl K)"
          className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--muted)] hover:border-[var(--foreground)] hover:text-[var(--foreground)]"
        >
          <SearchIcon size={16} />
          Find anything
        </button>
        <Link href={nav.register.href} onClick={onNavigate} className="btn-primary flex min-h-11 items-center gap-2 !px-3">
          <span className="flex-1">{nav.register.label}</span>
          {/* On the red button a plain count reads best in white. */}
          <Badge badge={badges.tabs} className={badges.tabs?.tone === "count" ? "!bg-white !text-[var(--foreground)]" : ""} />
        </Link>
      </div>

      <nav ref={list} aria-label="Back office" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        <Link href={nav.home.href} onClick={onNavigate} aria-current={active === nav.home.href ? "page" : undefined} className="bo-link">
          {nav.home.label}
        </Link>
        {nav.groups.map((g) => (
          <Group key={g.area} group={g} badges={badges} active={active} open={g.area === activeArea || !folded.includes(g.area)} onToggle={() => toggle(g.area)} onNavigate={onNavigate} />
        ))}
      </nav>

      {/* You: your hours, PIN, training, help. Pinned to the bottom. */}
      <div className="shrink-0 border-t border-[var(--border)] p-3 pt-2">
        {youOpen && (
          <ul className="mb-1">
            {nav.you.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={onNavigate} aria-current={active === l.href ? "page" : undefined} className="bo-link">
                  <span className="flex-1">{l.label}</span>
                  {l.badge && <Badge badge={badges[l.badge]} />}
                </Link>
              </li>
            ))}
            <li>
              <form action={signOut}>
                <button type="submit" className="bo-link w-full text-[var(--muted)]">
                  Sign out
                </button>
              </form>
            </li>
          </ul>
        )}
        <button type="button" onClick={() => setYouShown(!youOpen)} aria-expanded={youOpen} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-[var(--surface-hover)]">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--foreground)] text-sm font-bold text-[var(--surface)]" aria-hidden>
            {me.name.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{me.name}</span>
            <span className="block text-xs text-[var(--muted)]">{ROLE_LABEL[me.role] ?? me.role} · hours, PIN, help</span>
          </span>
          {!youOpen && pinBadge && <Badge badge={pinBadge} />}
          <ChevronIcon open={!youOpen} />
        </button>
      </div>
    </div>
  );
}

function Group({
  group,
  badges,
  active,
  open,
  onToggle,
  onNavigate,
}: {
  group: NavGroup;
  badges: NavBadges;
  active: string | null;
  open: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  // A folded section still shows its warnings on the heading.
  const folded = open ? [] : group.links.map((l) => (l.badge ? badges[l.badge] : undefined)).filter((b) => b && b.tone !== "count");
  return (
    <section className={`bo-area-${group.area} mt-3`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="bo-eyebrow min-h-11 w-full rounded-lg px-3 hover:bg-[var(--surface-hover)]">
        <span className="bo-dot" />
        <span className="flex-1 text-left">{group.label}</span>
        {folded.map((b, i) => (
          <Badge key={i} badge={b} />
        ))}
        <span className="text-[var(--muted)]">
          <ChevronIcon open={open} />
        </span>
      </button>
      {open && (
        <ul>
          {group.links.map((l) => (
            <li key={l.href}>
              <NavRow link={l} badges={badges} active={active} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NavRow({ link, badges, active, onNavigate }: { link: NavLink; badges: NavBadges; active: string | null; onNavigate?: () => void }) {
  return (
    <Link href={link.href} onClick={onNavigate} aria-current={active === link.href ? "page" : undefined} className="bo-link">
      <span className="flex-1">{link.label}</span>
      {link.badge && <Badge badge={badges[link.badge]} />}
    </Link>
  );
}

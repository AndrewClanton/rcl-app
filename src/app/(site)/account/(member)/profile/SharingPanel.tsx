"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SITE_URL } from "@/lib/site";
import {
  DISPLAY_NAME_MAX,
  HANDLE_HOLD_DAYS,
  HANDLE_MAX,
  defaultDisplayName,
  handleInput,
  handleProblem,
  handleSuffix,
  normalizeHandle,
  profilePath,
  suggestHandle,
  tidyText,
} from "@/lib/member-profile";
import { updateSharing } from "../../actions";

const HOST = new URL(SITE_URL).host;

// Their shared profile page (lib/member-profile.ts): off until they turn it
// on, a link name they pick, and the name it shows. What's on it and what
// never is, spelled out beside the form.
export default function SharingPanel({
  ready,
  share: savedShare,
  handle: savedHandle,
  displayName: savedName,
  name,
  blocked,
  lineHidden,
  hasPhoto,
}: {
  ready: boolean;
  share: boolean;
  handle: string;
  displayName: string;
  name: string;
  blocked: boolean; // staff turned it off
  lineHidden: boolean;
  hasPhoto: boolean;
}) {
  const router = useRouter();
  const [share, setShare] = useState(savedShare && !blocked);
  const [handle, setHandle] = useState(savedHandle);
  const [displayName, setDisplayName] = useState(savedName);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const clean = normalizeHandle(handle);
  const problem = share || clean ? handleProblem(clean) : null;
  const dirty = share !== (savedShare && !blocked) || clean !== savedHandle || tidyText(displayName) !== savedName;
  const live = savedShare && !blocked && !!savedHandle;
  const url = `${SITE_URL}${profilePath(savedHandle)}`;
  const fallbackName = defaultDisplayName(name);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !dirty) return;
    if (problem) return setMsg({ ok: false, text: problem });
    setBusy(true);
    setMsg(null);
    const r = await updateSharing({ share, handle: clean, displayName }).catch(() => ({ ok: false as const, error: "Something went wrong." }));
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setHandle(r.handle ?? "");
    setDisplayName(r.displayName ?? "");
    setMsg({ ok: true, text: share ? "Saved. Your page is up." : "Saved. Your page is off." });
    router.refresh();
  }

  async function shareLink() {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share === "function") {
      await nav.share({ title: "My RCL profile", url }).catch(() => {});
      return;
    }
    await navigator.clipboard.writeText(url).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }

  return (
    <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <form onSubmit={save} className="min-w-0 space-y-4">
        <p className="text-[15px] text-[var(--muted)]">
          A page with your badges and the movies you&apos;ve seen, to send to friends. It&apos;s off until you turn it on. It isn&apos;t listed anywhere and
          stays out of search engines, so people find it through your link.
        </p>

        {!ready && <p className="notice notice-warn text-sm">Profile pages are almost ready. Check back soon to turn yours on.</p>}
        {blocked && (
          <p className="notice notice-warn text-sm">
            Our staff turned off your profile page. If you think that&apos;s a mistake, email info@royalecinemajoplin.com.
          </p>
        )}

        <label className={`flex items-center gap-3 ${ready && !blocked ? "cursor-pointer" : "opacity-60"}`}>
          <input
            id="share-profile"
            type="checkbox"
            className="peer sr-only"
            checked={share}
            disabled={!ready || blocked || busy}
            onChange={(e) => {
              const on = e.target.checked;
              setShare(on);
              setMsg(null);
              if (on && !normalizeHandle(handle)) setHandle(suggestHandle(name, handleSuffix()));
            }}
          />
          <span
            aria-hidden="true"
            className="relative h-7 w-12 shrink-0 rounded-full border-2 border-[var(--foreground)] bg-[var(--surface-hover)] transition-colors peer-checked:bg-[var(--gold)] peer-focus-visible:shadow-[3px_3px_0_var(--accent)] after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:border-2 after:border-[var(--foreground)] after:bg-[var(--surface)] after:transition-transform peer-checked:after:translate-x-5"
          />
          <span className="font-display text-lg leading-tight">Share my profile page</span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <div className="label-xs">Your link</div>
            <div className="flex min-w-0 items-stretch">
              <span className="spec-code flex shrink-0 items-center rounded-l-[4px] border-2 border-r-0 border-[var(--foreground)] bg-[var(--surface-hover)] px-2.5 !text-[12px] !text-[var(--foreground)]">
                /m/
              </span>
              <input
                id="profile-handle"
                className="input min-w-0 flex-1 !rounded-l-none"
                value={handle}
                maxLength={HANDLE_MAX}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="maya-r-7k"
                disabled={!ready || busy}
                onChange={(e) => {
                  setHandle(handleInput(e.target.value));
                  setMsg(null);
                }}
              />
            </div>
            <div className="mt-1 truncate font-mono text-xs text-[var(--foreground)]">
              {HOST}/m/{clean || "your-link"}
            </div>
            <div className={`mt-0.5 text-xs ${problem && clean ? "font-bold text-[var(--danger-text)]" : "text-[var(--muted)]"}`}>
              {problem && clean ? problem : `Letters, numbers and hyphens. Change it any time: the old link stops working, and stays yours for ${HANDLE_HOLD_DAYS} days in case you want it back.`}
            </div>
          </label>
          <label className="block sm:col-span-2">
            <div className="label-xs">Name on your page</div>
            <input
              id="profile-display-name"
              className="input"
              value={displayName}
              maxLength={DISPLAY_NAME_MAX}
              placeholder={fallbackName}
              disabled={!ready || busy}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setMsg(null);
              }}
            />
            <div className="mt-1 text-xs text-[var(--muted)]">Leave it blank to use &ldquo;{fallbackName}&rdquo;. Your full name only shows if you type it here.</div>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary min-h-11 !px-5 !py-2 text-sm" disabled={!ready || busy || !dirty}>
            {busy ? "Saving…" : "Save"}
          </button>
          {msg && (
            <span className={`text-sm ${msg.ok ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"}`} role={msg.ok ? "status" : "alert"}>
              {msg.text}
            </span>
          )}
        </div>

        {live && !dirty && (
          // On a phone the link gets its own line and the buttons share the
          // one under it; from a tablet up, all in a row.
          <div className="flex flex-wrap items-center gap-2 rounded-[6px] border-2 border-[var(--foreground)] bg-[var(--gold)] p-3">
            <span className="min-w-0 basis-full font-mono text-sm font-bold break-all sm:basis-0 sm:flex-1 sm:truncate" title={url}>
              {HOST}
              {profilePath(savedHandle)}
            </span>
            <button type="button" className="btn-secondary min-h-11 flex-1 !px-3 !py-1.5 text-sm sm:flex-none" onClick={() => void shareLink()}>
              {copied ? "Copied!" : "Share link"}
            </button>
            <a href={profilePath(savedHandle)} target="_blank" rel="noopener" className="btn-secondary inline-flex min-h-11 flex-1 items-center justify-center !px-3 !py-1.5 text-sm sm:flex-none">
              Open ↗
            </a>
          </div>
        )}
      </form>

      <aside className="space-y-4 text-sm">
        <div>
          <div className="label-xs">On your page</div>
          <ul className="space-y-1">
            <Item on>The name you pick here{hasPhoto ? ", and your photo" : " (and your photo, if you add one)"}</Item>
            <Item on>Your profile line{lineHidden ? " (hidden by our staff right now)" : ""}</Item>
            <Item on>Your badges and the date you earned each</Item>
            <Item on>Weeks in a row, visits, and when you joined</Item>
            <Item on>Movies you&apos;ve seen here. Older films are counted but not named.</Item>
          </ul>
          <p className="mt-2 text-xs text-[var(--muted)]">It catches up each morning, so today&apos;s visit shows tomorrow.</p>
        </div>
        <div>
          <div className="label-xs">Never on it</div>
          <ul className="space-y-1">
            <Item>Your email, phone, or full name</Item>
            <Item>Your points, purchases or spending</Item>
            <Item>That you&apos;re here today, or what time you come in</Item>
            <Item>Tickets you&apos;ve bought for later</Item>
          </ul>
        </div>
      </aside>
    </div>
  );
}

function Item({ on = false, children }: { on?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className={`font-display mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] border-2 border-[var(--foreground)] text-[10px] leading-none ${on ? "bg-[var(--gold)]" : "bg-[var(--surface)]"}`}
      >
        {on ? "✓" : "×"}
      </span>
      <span>{children}</span>
    </li>
  );
}

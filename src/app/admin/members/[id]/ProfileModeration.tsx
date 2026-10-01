"use client";

import { useRefreshingAction } from "@/lib/useRefreshingAction";
import type { Member } from "@/lib/types";
import { displayNameFor, profilePath } from "@/lib/member-profile";
import { setProfileLineHidden, setSharedPageBlocked } from "../actions";

function day(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
}

// Words a member wrote for others to see (lib/member-profile.ts): their
// profile line (the check-in screen and their shared page) and, if they
// share one, their profile page's name and link. Any staff member can take
// either down: a hidden line shows nowhere, and a page turned off stays off
// until staff allow it again.
export default function ProfileModeration({ member }: { member: Member }) {
  const [pending, run] = useRefreshingAction();
  const line = member.tagline?.trim() || null;
  const lineHidden = !!member.tagline_hidden_at;
  const handle = member.profile_handle ?? null;
  const blocked = !!member.profile_hidden_at;
  const sharing = member.share_profile === true && !!handle && !blocked;
  if (!line && !sharing && !blocked) return null;

  return (
    <div className="basis-full space-y-1 text-sm">
      {line && (
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={`italic ${lineHidden ? "text-[var(--muted)] line-through" : ""}`}>“{line}”</span>
          <span className="text-xs text-[var(--muted)]">
            {lineHidden
              ? `(their profile line: hidden by staff${member.tagline_hidden_at ? ` on ${day(member.tagline_hidden_at)}` : ""})`
              : "(their profile line: on the check-in screen and their shared page)"}
          </span>
          <button
            type="button"
            className="text-xs text-[var(--muted)] underline hover:text-[var(--foreground)]"
            disabled={pending}
            onClick={() => {
              if (lineHidden || confirm("Hide this line? It stops showing on the check-in screen, the register and their shared page until someone shows it again.")) {
                run(() => setProfileLineHidden(member.id, !lineHidden));
              }
            }}
          >
            {lineHidden ? "Show line" : "Hide line"}
          </button>
        </div>
      )}
      {(sharing || blocked) && (
        <div className="flex flex-wrap items-baseline gap-x-2">
          {blocked ? (
            <span className="text-xs text-[var(--muted)]">
              Shared profile page turned off by staff{member.profile_hidden_at ? ` on ${day(member.profile_hidden_at)}` : ""}.
            </span>
          ) : (
            <span className="text-xs">
              Shared profile page:{" "}
              <a href={profilePath(handle as string)} target="_blank" rel="noopener" className="font-semibold text-[var(--accent)] hover:underline">
                /m/{handle}
              </a>{" "}
              as “{displayNameFor(member)}”
            </span>
          )}
          <button
            type="button"
            className="text-xs text-[var(--muted)] underline hover:text-[var(--foreground)]"
            disabled={pending}
            onClick={() => {
              if (blocked || confirm("Turn off their shared profile page? The link stops working, and they can't turn it back on until staff allow it.")) {
                run(() => setSharedPageBlocked(member.id, !blocked));
              }
            }}
          >
            {blocked ? "Let them share again" : "Turn off shared page"}
          </button>
        </div>
      )}
    </div>
  );
}

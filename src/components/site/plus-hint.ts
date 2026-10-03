// The Insiders+ look on the public site, without the pages reading the login
// cookie (which would make every page uncacheable):
//
// - Pages render both versions of anything that differs for Insiders+
//   members, marked .plus-show (the badge) or .plus-hide (the "Get
//   Insiders+" pitches). globals.css shows one or the other depending on a
//   data-plus attribute on the .site wrapper.
// - SiteHeaderSync (in the header) asks /api/member-state after the page
//   loads, sets or clears data-plus, and remembers the answer here.
// - So a returning member doesn't see the pitches flash up first, this tiny
//   script runs before the page paints: it puts data-plus back from that
//   memory, but only while they still have a login cookie. The fetch then
//   corrects it either way.

export const PLUS_HINT_KEY = "rcl-plus-hint";

// Supabase's login cookie ("sb-<project>-auth-token", sometimes split into
// ".0", ".1"...). Not the "-code-verifier" cookie from a sign-in in progress.
export const AUTH_COOKIE_SOURCE = "(?:^|;\\s*)sb-[^=;]+-auth-token(?:\\.\\d+)?=";

export const PLUS_HINT_SCRIPT = `try{var s=document.currentScript&&document.currentScript.parentElement,h=JSON.parse(localStorage.getItem(${JSON.stringify(PLUS_HINT_KEY)})||"null");if(s&&h&&h.plus&&new RegExp(${JSON.stringify(AUTH_COOKIE_SOURCE)}).test(document.cookie))s.setAttribute("data-plus","")}catch(e){}`;

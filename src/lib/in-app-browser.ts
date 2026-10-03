// Apps like Facebook and Instagram open links in their own built-in
// browser, and Google refuses to sign anyone in from inside one ("Error 403:
// disallowed_useragent"). The sign-in page uses this to swap the Google
// button for a note on opening the page in Safari or Chrome instead.

const APPS: [RegExp, string][] = [
  [/Instagram/i, "Instagram"],
  [/MessengerFor|FB_IAB\/MESSENGER|\bOrca-Android\b/i, "Messenger"],
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i, "Facebook"],
  [/musical_ly|BytedanceWebview|TikTok/i, "TikTok"],
  [/Snapchat/i, "Snapchat"],
  [/LinkedInApp/i, "LinkedIn"],
  [/Pinterest/i, "Pinterest"],
  [/\bLine\//i, "LINE"],
];

// The app's name ("Facebook"), "this app" for an unnamed Android web view,
// or null in a regular browser.
export function inAppBrowserName(userAgent: string): string | null {
  for (const [re, name] of APPS) if (re.test(userAgent)) return name;
  if (/Android/i.test(userAgent) && /; wv\)/.test(userAgent)) return "this app";
  return null;
}

// On Android, an intent link opens the same page in Chrome. iPhones have no
// reliable equivalent, so they get the menu instructions only.
export function openInChromeHref(href: string, userAgent: string): string | null {
  if (!/Android/i.test(userAgent)) return null;
  const url = new URL(href);
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
}

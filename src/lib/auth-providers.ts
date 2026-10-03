import "server-only";

export interface SignInProviders {
  google: boolean;
  facebook: boolean;
}

// Which social sign-in buttons to show: asks Supabase which providers are
// switched on, so a button appears on its own once it's configured in the
// Supabase dashboard (and never shows as a dead end before then). Cached
// for five minutes.
//
// Facebook also waits on Meta: until the Royale Cinema Lounge app (Meta app
// 1524635143044323) passes App Review and is published, only the app's own
// admins can sign in with it and everyone else gets an error. Flip this to
// true once Meta for Developers shows the app as Published.
const FACEBOOK_APP_PUBLISHED = false;

// Meta's reviewer (and the owner, for the review's screen recording) opens
// /account/login?fb=1 to see the Facebook button before then.

export async function getSignInProviders(opts: { facebookPreview?: boolean } = {}): Promise<SignInProviders> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      next: { revalidate: 300 },
    });
    if (!res.ok) return { google: false, facebook: false };
    const settings = (await res.json()) as { external?: Record<string, boolean> };
    return { google: !!settings.external?.google, facebook: (FACEBOOK_APP_PUBLISHED || !!opts.facebookPreview) && !!settings.external?.facebook };
  } catch {
    return { google: false, facebook: false };
  }
}

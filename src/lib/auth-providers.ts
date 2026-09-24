import "server-only";

export interface SignInProviders {
  google: boolean;
  facebook: boolean;
}

// Which social sign-in buttons to show: asks Supabase which providers are
// switched on, so a button appears on its own once it's configured in the
// Supabase dashboard (and never shows as a dead end before then). Cached
// for five minutes.
export async function getSignInProviders(): Promise<SignInProviders> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      next: { revalidate: 300 },
    });
    if (!res.ok) return { google: false, facebook: false };
    const settings = (await res.json()) as { external?: Record<string, boolean> };
    return { google: !!settings.external?.google, facebook: !!settings.external?.facebook };
  } catch {
    return { google: false, facebook: false };
  }
}

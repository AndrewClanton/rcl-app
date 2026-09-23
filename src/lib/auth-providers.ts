import "server-only";

// Whether "Continue with Google" should show: asks Supabase which sign-in
// providers are switched on, so the button appears on its own once Google
// is configured in the Supabase dashboard (and never shows as a dead end
// before then). Cached for five minutes.
export async function isGoogleSignInEnabled(): Promise<boolean> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      next: { revalidate: 300 },
    });
    if (!res.ok) return false;
    const settings = (await res.json()) as { external?: Record<string, boolean> };
    return !!settings.external?.google;
  } catch {
    return false;
  }
}

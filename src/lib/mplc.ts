// Our MPLC umbrella license covers public performance of anything, but only
// lets us *advertise* the current year's releases -- an older title (like a
// library/catalog screening) can be shown, but only people we've told about
// it privately (the members' email list) are supposed to find out it's
// playing. So it must never appear on a page anyone can just browse to.
// A movie with no confirmed release year (not yet matched to OMDb/TMDb) is
// treated as restricted too -- fail closed, not open.
//
// Its own module (no server imports) so client components that refetch
// screenings live -- like the lobby box-office TV -- can apply it too.
export function isRestrictedRelease(movie: { release_year: number | null }, now = new Date()): boolean {
  return movie.release_year !== centralYear(now);
}

// "This year" is the theater's year in Joplin, not the server's. The servers
// run on UTC, which turns over at 6 PM Central on Dec 31: with a plain
// getFullYear() every current-year film dropped off the listings for New
// Year's Eve evening. Same America/Chicago calendar as centralDate() in
// lib/ops/time.ts (that module is server-only, so this one can't import it).
export function centralYear(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric" }).format(now));
}

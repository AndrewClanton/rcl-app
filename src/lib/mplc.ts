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
export function isRestrictedRelease(movie: { release_year: number | null }): boolean {
  return movie.release_year !== new Date().getFullYear();
}

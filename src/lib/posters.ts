// Poster sources hand out small renditions by default (OMDb ~300-380px,
// the TMDb picker's 342px thumbnails). The ramp TV shows a poster ~560px
// wide, 2x that on high-DPI screens, so we store a bigger rendition --
// but not the originals (up to 8100px / 7.5MB), since the weekly flyer
// embeds ~10 posters at full size when it renders.
const TMDB_SIZE = "w780"; // 780px wide
const AMAZON_WIDTH = 1000; // OMDb posters are Amazon-hosted IMDb images

// Only these hosts are ever downloaded from. setMoviePoster takes a URL
// from the browser, and the server re-hosts whatever it fetches publicly,
// so an arbitrary URL must not get through.
const POSTER_HOSTS = new Set(["image.tmdb.org", "m.media-amazon.com", "ia.media-imdb.com"]);

export function isAllowedPosterSource(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && POSTER_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

// Same image, bigger rendition. Unknown URL shapes come back unchanged.
export function highResPosterUrl(url: string): string {
  if (!isAllowedPosterSource(url)) return url;
  const { hostname } = new URL(url);
  if (hostname === "image.tmdb.org") return url.replace(/\/t\/p\/[^/]+\//, `/t/p/${TMDB_SIZE}/`);
  // ".../MV5B...@._V1_QL75_UX380_CR0,0,380,562_.jpg" -> ".../MV5B...@._V1_SX1000.jpg"
  return url.replace(/\._V1_[^/]*\.(jpe?g|png)$/i, `._V1_SX${AMAZON_WIDTH}.$1`);
}

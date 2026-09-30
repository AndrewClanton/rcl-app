// Which menu link is the page you're on: the one whose address matches
// most closely. /admin/members/regulars beats /admin/members, and
// /admin/team?view=timesheets beats /admin/team when the view says so.
export function activeHref(hrefs: string[], pathname: string, search: URLSearchParams | null): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const href of hrefs) {
    const [path, query] = href.split("?");
    const onPath = path === "/admin" || path === "/" ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);
    if (!onPath) continue;
    let score = path.length * 10;
    if (query) {
      const want = new URLSearchParams(query);
      let ok = true;
      want.forEach((value, key) => {
        if (search?.get(key) !== value) ok = false;
      });
      if (!ok) continue;
      score += Array.from(want.keys()).length;
    }
    if (score > bestScore) {
      best = href;
      bestScore = score;
    }
  }
  return best;
}

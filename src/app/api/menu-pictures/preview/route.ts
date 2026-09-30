import { getStaffSession } from "@/lib/auth";
import { findCandidates } from "@/lib/menu-pictures/sources";
import { downloadFound } from "@/lib/menu-pictures/found";
import { PictureError, PREVIEW_SIZE, squareJpeg } from "@/lib/menu-pictures/images";
import { cleanQuery } from "@/lib/menu-pictures/query";

export const dynamic = "force-dynamic";

// The ◀ ▶ preview of a found picture, for the register's item settings and
// Back office → Menu. The screens never load a picture from another site:
// they ask for "result i of search q" here, and the server downloads it
// (only from the picture hosts in lib/menu-pictures/sources.ts, 12 MB at
// most), squares it to a small JPEG and sends that. Staff only. It takes a
// search and a position, never an address, so it can't be pointed anywhere
// else.

export async function GET(request: Request) {
  if (!(await getStaffSession())) return new Response("Not signed in", { status: 401 });
  const params = new URL(request.url).searchParams;
  const query = cleanQuery(params.get("q"));
  const index = Number(params.get("i"));
  if (!query || !Number.isInteger(index) || index < 0 || index > 100) return new Response("Bad request", { status: 400 });

  const { candidates } = await findCandidates(query);
  const c = candidates[index];
  if (!c) return new Response("Not found", { status: 404 });
  try {
    const jpeg = await squareJpeg(await downloadFound(c, query, "thumb"), PREVIEW_SIZE, c.source === "off" ? "contain" : "cover");
    return new Response(new Uint8Array(jpeg), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(jpeg.length),
        // Only this browser keeps it, and only for a while.
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (!(e instanceof PictureError)) console.warn("menu pictures: preview failed", query, index, e);
    return new Response("Couldn't load that picture", { status: 502 });
  }
}

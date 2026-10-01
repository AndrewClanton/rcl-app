import { ImageResponse } from "next/og";
import { loadShareAssets } from "@/lib/seo/share-card";

// The logo for structured data (schema.org "logo" in lib/seo/theater.ts).
// The wordmark file is pale grey on transparent, made for dark grounds, so
// on its own it would all but vanish on Google's white. This sets it on an
// ink square with a gold rule. Drawn once at build time.
export const dynamic = "force-static";

const INK = "#14110c";
const GOLD = "#ffc72c";

export async function GET() {
  const { logo } = await loadShareAssets();
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", background: INK, border: `16px solid ${GOLD}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws plain <img> */}
        <img src={logo} width={480} height={169} style={{ width: 480, height: 169 }} alt="" />
      </div>
    ),
    { width: 600, height: 600 },
  );
}

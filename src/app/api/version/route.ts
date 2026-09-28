import { deploymentId } from "@/lib/deployment";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ id: deploymentId() }, { headers: { "Cache-Control": "no-store" } });
}

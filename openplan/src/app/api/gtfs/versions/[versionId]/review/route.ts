import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { authorizeGtfsHumanRoute } from "@/lib/gtfs/managed-human-route";
import { readGtfsAdoptionReview } from "@/lib/gtfs/managed-human-command";

export const runtime = "nodejs";
export const maxDuration = 60;
const id = z.string().uuid().transform(value => value.toLowerCase());

/** Read completed parser counts and the exact current predecessor. Reading
 * supplies a review basis; it does not adopt or validate actual service.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ versionId: string }> }) {
 const audit = createApiAuditLogger("gtfs.version.review", request);
 try {
  const params = z.object({ versionId: id }).strict().safeParse(await context.params), query = z.object({ workspaceId: id }).strict().safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!params.success || !query.success) return NextResponse.json({ error: "Invalid transit review scope" }, { status: 400 });
  const authorized = await authorizeGtfsHumanRoute(request, query.data.workspaceId, false);
  if ("response" in authorized) return authorized.response;
  const review = await readGtfsAdoptionReview(authorized.service, { workspaceId: query.data.workspaceId, versionId: params.data.versionId, actorId: authorized.actorId }, request.signal);
  return NextResponse.json({ managed: true, review, detail: "Counts come from this completed feed. Review changes before adopting it. Scheduled service does not establish observed service." });
 } catch (error) {
  audit.error("gtfs_adoption_review_unavailable", { error });
  return NextResponse.json({ error: "Transit version review is unavailable", detail: "Check processing status and retry after completion." }, { status: 503 });
 }
}

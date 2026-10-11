import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeGtfsHumanRoute } from "@/lib/gtfs/managed-human-route";
import { readGtfsStatus } from "@/lib/gtfs/managed-worker-service";
import { readGtfsRequestCancellation } from "@/lib/gtfs/managed-request-cancellation";
import { createApiAuditLogger } from "@/lib/observability/audit";

export const runtime = "nodejs";
const id = z.string().uuid().transform(value => value.toLowerCase());

/** Workspace members can open managed progress without the original actor's
 * browser history. This read does not impersonate that actor or recover input.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ versionId: string }> }) {
 const audit = createApiAuditLogger("gtfs.version.status", request);
 try {
  const params = z.object({ versionId: id }).strict().safeParse(await context.params);
  const query = z.object({ workspaceId: id }).strict().safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!params.success || !query.success) return NextResponse.json({ error: "Invalid transit version scope" }, { status: 400 });
  const authorized = await authorizeGtfsHumanRoute(request, query.data.workspaceId, false);
  if ("response" in authorized) return authorized.response;
  const status = await readGtfsStatus(authorized.service, { workspaceId: query.data.workspaceId, versionId: params.data.versionId, actorId: authorized.actorId }, request.signal);
  const cancellation = await readGtfsRequestCancellation(authorized.service, { workspaceId: query.data.workspaceId, requestId: status.requestId, actorId: authorized.actorId }, request.signal);
  return NextResponse.json({ managed: true, requestId: status.requestId, status, cancellation });
 } catch (error) {
  audit.error("gtfs_version_status_unavailable", { error });
  return NextResponse.json({ error: "Managed transit progress is unavailable", detail: "This version may predate managed imports, or its progress could not be read. The feed history remains separate evidence." }, { status: 503 });
 }
}

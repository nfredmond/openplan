import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { authorizeGtfsHumanRoute, managedGtfsHumanDirectory } from "@/lib/gtfs/managed-human-route";
import { cancelGtfsRequest } from "@/lib/gtfs/managed-request-cancellation";

export const runtime = "nodejs";
export const maxDuration = 60;
const id = z.string().uuid().transform(value => value.toLowerCase());
const payloadSchema = z.object({ workspaceId: id, commandId: id, reason: z.string().trim().min(1).max(2000) }).strict();

/** Reserve cancellation for the exact request even when admission has no
 * version yet. Unknown replies retain the command identity for recovery.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ requestId: string }> }) {
 const audit = createApiAuditLogger("gtfs.submission.cancel", request);
 try {
  const params = z.object({ requestId: id }).strict().safeParse(await context.params), body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
  if (!body.ok) return body.response;
  const payload = payloadSchema.safeParse(body.data);
  if (!params.success || !payload.success) return NextResponse.json({ error: "Invalid transit cancellation command" }, { status: 400 });
  const authorized = await authorizeGtfsHumanRoute(request, payload.data.workspaceId, true);
  if ("response" in authorized) return authorized.response;
  const cancellation = await cancelGtfsRequest({ ...managedGtfsHumanDirectory(payload.data.commandId), service: authorized.service, signal: request.signal,
   scope: { workspaceId: payload.data.workspaceId, requestId: params.data.requestId, actorId: authorized.actorId },
   command: { commandId: payload.data.commandId, reason: payload.data.reason } });
  return NextResponse.json({ managed: true, requestId: params.data.requestId, cancellation,
   detail: "Request cancellation is recorded. A known unfinished version is closed; archive cleanup can remain pending." });
 } catch (error) {
  audit.error("gtfs_request_cancellation_unconfirmed", { error });
  return NextResponse.json({ error: "Transit cancellation is unconfirmed", detail: "Retain the same command UUID, check request status and retry that command." }, { status: 503 });
 }
}

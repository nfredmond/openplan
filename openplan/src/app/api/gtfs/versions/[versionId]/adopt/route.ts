import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { authorizeGtfsHumanRoute, managedGtfsHumanDirectory } from "@/lib/gtfs/managed-human-route";
import { executeGtfsHumanCommand, gtfsHumanCommandSchema } from "@/lib/gtfs/managed-human-command";

export const runtime = "nodejs";
export const maxDuration = 60;
const id = z.string().uuid().transform(value => value.toLowerCase());
const payloadSchema = z.object({ workspaceId: id, command: gtfsHumanCommandSchema }).strict();

/** A manual command adopts only the exact completed counts and predecessor
 * the planner reviewed. Stale reviews cannot silently approve a different feed.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ versionId: string }> }) {
 const audit = createApiAuditLogger("gtfs.version.adopt", request);
 try {
  const params = z.object({ versionId: id }).strict().safeParse(await context.params), body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
  if (!body.ok) return body.response;
  const payload = payloadSchema.safeParse(body.data);
  if (!params.success || !payload.success || payload.data.command.operation !== "adopt") return NextResponse.json({ error: "Invalid reviewed transit adoption command" }, { status: 400 });
  const authorized = await authorizeGtfsHumanRoute(request, payload.data.workspaceId, true);
  if ("response" in authorized) return authorized.response;
  const adoption = await executeGtfsHumanCommand({ ...managedGtfsHumanDirectory(payload.data.command.commandId), service: authorized.service, signal: request.signal,
   scope: { workspaceId: payload.data.workspaceId, versionId: params.data.versionId, actorId: authorized.actorId }, command: payload.data.command });
  return NextResponse.json({ managed: true, adoption, detail: "The exact adoption command is recorded. Check current feed status; a historical receipt does not reapply an earlier adoption." });
 } catch (error) {
  audit.error("gtfs_reviewed_adoption_unconfirmed", { error });
  return NextResponse.json({ error: "Transit adoption is unconfirmed", detail: "Retain the same command UUID and review basis. Check current feed status before retrying." }, { status: 503 });
 }
}

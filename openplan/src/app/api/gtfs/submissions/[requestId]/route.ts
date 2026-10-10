import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { checkWorkspaceMembership } from "@/lib/workspaces/membership";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { GTFS_REQUEST_ID_HEADER, managedGtfsEnabled, managedGtfsRequestDirectory, managedGtfsRouteSubmission } from "@/lib/gtfs/managed-route";
import { readGtfsSavedSubmission } from "@/lib/gtfs/managed-admission";
import { readGtfsSubmissionStatus } from "@/lib/gtfs/managed-worker-service";
import { resolveManagedGtfsSubmission } from "@/lib/gtfs/managed-source";

export const runtime = "nodejs";
export const maxDuration = 60;
const paramsSchema = z.object({ requestId: z.string().uuid().transform(value => value.toLowerCase()) }).strict();
const workspaceSchema = z.object({ workspaceId: z.string().uuid().transform(value => value.toLowerCase()) }).strict();
function membershipResponse(kind: "schema_pending" | "not_member" | "error") {
  return NextResponse.json({ error: kind === "not_member" ? "Workspace not found" : "Workspace membership is unavailable" }, { status: kind === "not_member" ? 404 : 503 });
}

/** Read committed progress with the session actor. A null lookup leaves an
 * uncertain request unconfirmed; it does not report an empty transit result.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ requestId: string }> }) {
  const audit = createApiAuditLogger("gtfs.submission.status", request);
  try {
    const params = paramsSchema.safeParse(await context.params), query = workspaceSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!params.success || !query.success) return NextResponse.json({ error: "Invalid transit submission scope" }, { status: 400 });
    const supabase = await createClient(), { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const membership = await checkWorkspaceMembership(supabase, user.id, query.data.workspaceId);
    if (!membership.ok) return membershipResponse(membership.kind);
    const status = await readGtfsSubmissionStatus(createServiceRoleClient(), { ...query.data, ...params.data, actorId: user.id }, request.signal);
    return NextResponse.json({ managed: true, requestId: params.data.requestId, status,
      ...(status === null ? { detail: "Submission is unconfirmed. Recover the same request or retain its original input." } : {}) });
  } catch (error) {
    audit.error("gtfs_submission_status_unavailable", { error });
    return NextResponse.json({ error: "Transit submission status is unavailable", detail: "Retain this request identity and retry." }, { status: 503 });
  }
}

/** Recover the server's retained exact intent under its original session actor.
 * SQL checks current write permission again. A new request ID is not a retry.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ requestId: string }> }) {
  const audit = createApiAuditLogger("gtfs.submission.recover", request);
  try {
    const params = paramsSchema.safeParse(await context.params), body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    const payload = workspaceSchema.safeParse(body.data);
    if (!params.success || !payload.success) return NextResponse.json({ error: "Invalid transit recovery scope" }, { status: 400 });
    if (request.headers.get(GTFS_REQUEST_ID_HEADER)?.toLowerCase() !== params.data.requestId) return NextResponse.json({ error: "Recovery must retain the same request UUID" }, { status: 400 });
    const supabase = await createClient(), { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const membership = await checkWorkspaceMembership(supabase, user.id, payload.data.workspaceId);
    if (!membership.ok) return membershipResponse(membership.kind);
    if (isReadOnlyWorkspaceRole(membership.role)) return NextResponse.json({ error: "Viewers have read-only access to this workspace" }, { status: 403 });
    if (!managedGtfsEnabled()) return NextResponse.json({ error: "Managed transit ingestion is not enabled on this installation" }, { status: 409 });
    const configuration = managedGtfsRequestDirectory(params.data.requestId), saved = await readGtfsSavedSubmission(configuration.directory);
    if (saved.binding.requestId !== params.data.requestId || saved.binding.workspaceId !== payload.data.workspaceId || saved.binding.actorId !== user.id
      || saved.binding.installationId !== configuration.installationId || saved.binding.target !== configuration.target) return NextResponse.json({ error: "Retained transit submission is unavailable for this actor and installation" }, { status: 404 });
    const service = createServiceRoleClient();
    return managedGtfsRouteSubmission(request, { service, workspaceId: payload.data.workspaceId, actorId: user.id, intent: saved.binding.intent,
      resolve: archive => resolveManagedGtfsSubmission(service, saved.binding.intent, archive) });
  } catch (error) {
    audit.error("gtfs_submission_recovery_unconfirmed", { error });
    return NextResponse.json({ error: "Transit submission recovery is unconfirmed", detail: "Retain the same request identity and original ZIP. Check status before retrying." }, { status: 503 });
  }
}

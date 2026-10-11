import { NextRequest } from "next/server";
import { z } from "zod";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { ProviderRequestError, providerBody, providerError, providerJson, providerUser, requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { MAP_PACKAGE_DELIVERABLES, mapPackageRunnerFor } from "@/lib/map-packages/catalog";
import { MAP_PACKAGE_REQUEST_MAX_CHARS, mapPackageZipMaxBytes } from "@/lib/map-packages/contracts";
import { MAP_PACKAGE_SKILL } from "@/lib/map-packages/skill";
import { loadMapPackageBrief, mapPackageObjectPath, mapPackageRpcError, signedMapPackageUpload } from "@/lib/map-packages/server";

export const runtime = "nodejs";

const listSchema = z.object({ workspaceId: z.string().uuid(), projectId: z.string().uuid().optional() }).strict();
const common = {
  requestId: z.string().uuid(), workspaceId: z.string().uuid(), projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(200), deliverable: z.enum(MAP_PACKAGE_DELIVERABLES),
  fundingOpportunityId: z.string().uuid().nullable(),
};
const createSchema = z.discriminatedUnion("source", [
  z.object({ ...common, source: z.literal("agent"), connectionId: z.string().uuid(),
    client: z.string().trim().min(1).max(200), request: z.string().max(MAP_PACKAGE_REQUEST_MAX_CHARS), practice: z.boolean() }).strict(),
  z.object({ ...common, source: z.literal("upload"), fileName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,155}\.zip$/), bytes: z.number().int().positive() }).strict(),
]);

/** Every map package in one workspace, or in one of its projects. RLS limits rows to members. */
export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("map_packages.get", request);
  try {
    const { client } = await providerUser();
    const scope = listSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    let query = client.from("project_map_packages").select("id, request_id, workspace_id, project_id, requested_by, title, source, deliverable, funding_opportunity_id, connection_id, provider, auth_mode, model_id, effort, brief_hash, skill_tree_hash, state, attempt_id, lease_expires_at, last_heartbeat_at, progress, receipt, failure_code, upload_file_name, created_at, started_at, finished_at, project:projects(id, name)")
      .eq("workspace_id", scope.workspaceId).order("created_at", { ascending: false }).limit(200);
    if (scope.projectId) query = query.eq("project_id", scope.projectId);
    const { data, error } = await query;
    mapPackageRpcError(error);
    audit.info("map_packages_read", { count: data?.length ?? 0 });
    return providerJson({ packages: data ?? [] });
  } catch (error) { const response = providerError(error); audit.warn("request_refused", { status: response.status }); return response; }
}

/**
 * Start a package. The agent path freezes a brief and queues it for the
 * planner's own connected computer. The upload path records a package the
 * planner built and returns a short-lived URL for the ZIP.
 */
export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("map_packages.post", request);
  try {
    requireProviderBrowserOrigin(request);
    const body = await providerBody(request, createSchema);
    const { client, userId } = await providerUser();
    // Viewers read packages; only owners, admins and members start one. The
    // database functions check the same roles again under lock.
    const access = await loadProjectAccess(client, body.projectId, userId, "programs.write");
    if (access.error) throw new ProviderRequestError("map_package_storage_unavailable", 503);
    if (!access.project || access.project.workspace_id !== body.workspaceId || !access.allowed) throw new ProviderRequestError("map_package_access_denied", 403);
    const service = createServiceRoleClient();
    if (body.source === "agent") {
      const connectionRead = await client.from("assistant_provider_connections").select("id, workspace_id, project_id, provider, device_label, expected_auth_mode, created_at, expires_at, revoked_at, last_seen_at, last_status")
        .eq("id", body.connectionId).eq("user_id", userId).eq("workspace_id", body.workspaceId).eq("project_id", body.projectId).maybeSingle();
      mapPackageRpcError(connectionRead.error);
      if (!connectionRead.data) throw new ProviderRequestError("map_package_connection_required", 403);
      const connection = connectionRead.data as { provider: string; expected_auth_mode: string };
      const runner = mapPackageRunnerFor(connection.provider);
      if (!runner || !runner.ready || !(runner.authModes as readonly string[]).includes(connection.expected_auth_mode)) {
        throw new ProviderRequestError("map_package_runner_not_ready", 409);
      }
      const { canonical } = await loadMapPackageBrief(client, { workspaceId: body.workspaceId, projectId: body.projectId,
        fundingOpportunityId: body.fundingOpportunityId, client: body.client, deliverable: body.deliverable,
        request: body.request, practice: body.practice, capturedAt: new Date().toISOString() });
      const { data, error } = await service.rpc("create_project_map_package", {
        p_request_id: body.requestId, p_user_id: userId, p_workspace_id: body.workspaceId, p_project_id: body.projectId,
        p_title: body.title, p_source: "agent", p_deliverable: body.deliverable, p_funding_opportunity_id: body.fundingOpportunityId,
        p_connection_id: body.connectionId, p_provider: runner.provider, p_auth_mode: connection.expected_auth_mode,
        p_model_id: runner.modelId, p_effort: runner.effort, p_brief_canonical: canonical,
        p_skill_tree_hash: MAP_PACKAGE_SKILL.treeHash, p_upload_file_name: null,
      });
      mapPackageRpcError(error);
      const saved = z.object({ created: z.boolean(), package: z.object({ id: z.string().uuid() }).passthrough() }).parse(data);
      audit.info("map_package_queued", { packageId: saved.package.id, created: saved.created });
      return providerJson({ package: saved.package }, saved.created ? 201 : 200);
    }
    if (body.bytes > mapPackageZipMaxBytes()) throw new ProviderRequestError("map_package_file_too_large", 413);
    const { data, error } = await service.rpc("create_project_map_package", {
      p_request_id: body.requestId, p_user_id: userId, p_workspace_id: body.workspaceId, p_project_id: body.projectId,
      p_title: body.title, p_source: "upload", p_deliverable: body.deliverable, p_funding_opportunity_id: body.fundingOpportunityId,
      p_connection_id: null, p_provider: null, p_auth_mode: null, p_model_id: null, p_effort: null, p_brief_canonical: null,
      p_skill_tree_hash: null, p_upload_file_name: body.fileName,
    });
    mapPackageRpcError(error);
    const saved = z.object({ created: z.boolean(), package: z.object({ id: z.string().uuid(), workspace_id: z.string().uuid(),
      project_id: z.string().uuid(), state: z.string() }).passthrough() }).parse(data);
    if (saved.package.state !== "uploading") throw new ProviderRequestError("map_package_retry_conflict", 409);
    const uploadUrl = await signedMapPackageUpload(service, mapPackageObjectPath(saved.package, body.fileName));
    audit.info("map_package_upload_issued", { packageId: saved.package.id, created: saved.created });
    return providerJson({ package: saved.package, upload: { url: uploadUrl } }, saved.created ? 201 : 200);
  } catch (error) { const response = providerError(error); audit.warn("request_refused", { status: response.status }); return response; }
}

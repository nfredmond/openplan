import { NextRequest } from "next/server";
import { z } from "zod";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { ProviderRequestError, providerError, providerJson, providerUser, requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { mapPackageIdSchema, mapPackageRpcError } from "@/lib/map-packages/server";

export const runtime = "nodejs";

type Context = { params: Promise<{ packageId: string }> };

/** One package with its files and what the planner asked for. RLS limits it to workspace members. */
export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("map_packages.detail.get", request);
  try {
    const { packageId } = mapPackageIdSchema.parse(await context.params);
    const { client } = await providerUser();
    const packageRead = await client.from("project_map_packages")
      .select("id, request_id, workspace_id, project_id, requested_by, title, source, deliverable, funding_opportunity_id, connection_id, provider, auth_mode, model_id, effort, brief_hash, skill_tree_hash, state, attempt_id, lease_expires_at, last_heartbeat_at, progress, receipt, failure_code, upload_file_name, created_at, started_at, finished_at, brief_client:brief->>client, brief_request:brief->>request, brief_practice:brief->>practice, project:projects(id, name), funding_opportunity:funding_opportunities(id, title)")
      .eq("id", packageId).maybeSingle();
    mapPackageRpcError(packageRead.error);
    if (!packageRead.data) throw new ProviderRequestError("map_package_not_found", 404);
    const filesRead = await client.from("project_map_package_files").select("id, package_id, workspace_id, project_id, role, name, object_path, bytes, sha256, verified_at, created_at")
      .eq("package_id", packageId).order("name", { ascending: true });
    mapPackageRpcError(filesRead.error);
    audit.info("map_package_read", { packageId });
    return providerJson({ package: packageRead.data, files: filesRead.data ?? [] });
  } catch (error) { const response = providerError(error); audit.warn("request_refused", { status: response.status }); return response; }
}

/** Stop a package that is not finished. The connector stops at its next heartbeat. */
export async function DELETE(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("map_packages.detail.delete", request);
  try {
    requireProviderBrowserOrigin(request);
    const { packageId } = mapPackageIdSchema.parse(await context.params);
    const { client, userId } = await providerUser();
    const packageRead = await client.from("project_map_packages").select("id, project_id").eq("id", packageId).maybeSingle();
    mapPackageRpcError(packageRead.error);
    if (!packageRead.data) throw new ProviderRequestError("map_package_not_found", 404);
    // Viewers cannot stop a package. Among members, the database function lets
    // owners and admins stop any package and others only their own.
    const access = await loadProjectAccess(client, (packageRead.data as { project_id: string }).project_id, userId, "programs.write");
    if (access.error) throw new ProviderRequestError("map_package_storage_unavailable", 503);
    if (!access.allowed) throw new ProviderRequestError("map_package_access_denied", 403);
    const { data, error } = await createServiceRoleClient().rpc("cancel_project_map_package", { p_package_id: packageId, p_user_id: userId });
    mapPackageRpcError(error);
    const result = z.object({ state: z.string() }).parse(data);
    audit.info("map_package_cancel_requested", { packageId, state: result.state });
    return providerJson(result);
  } catch (error) { const response = providerError(error); audit.warn("request_refused", { status: response.status }); return response; }
}

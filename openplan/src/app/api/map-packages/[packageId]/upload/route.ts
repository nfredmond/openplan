import { NextRequest } from "next/server";
import { z } from "zod";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { ProviderRequestError, providerBody, providerError, providerJson, providerUser, requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { mapPackageZipMaxBytes } from "@/lib/map-packages/contracts";
import { mapPackageIdSchema, mapPackageObjectPath, mapPackageRpcError, measureStoredMapPackageObject } from "@/lib/map-packages/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z.object({ action: z.literal("complete") }).strict();

/**
 * Finish a hand-built package after the browser has put the ZIP in storage.
 * The server reads the object back; its measured size and sha256 are what the
 * record keeps.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ packageId: string }> }) {
  const audit = createApiAuditLogger("map_packages.upload.post", request);
  try {
    requireProviderBrowserOrigin(request);
    const { packageId } = mapPackageIdSchema.parse(await context.params);
    await providerBody(request, bodySchema);
    const { client, userId } = await providerUser();
    const packageRead = await client.from("project_map_packages").select("id, workspace_id, project_id, source, requested_by, upload_file_name").eq("id", packageId).maybeSingle();
    mapPackageRpcError(packageRead.error);
    const row = packageRead.data as { id: string; workspace_id: string; project_id: string; source: string; requested_by: string | null; upload_file_name: string | null } | null;
    if (!row || row.source !== "upload" || row.requested_by !== userId || !row.upload_file_name) throw new ProviderRequestError("map_package_access_denied", 403);
    const access = await loadProjectAccess(client, row.project_id, userId, "programs.write");
    if (access.error) throw new ProviderRequestError("map_package_storage_unavailable", 503);
    if (!access.project || access.project.workspace_id !== row.workspace_id || !access.allowed) throw new ProviderRequestError("map_package_access_denied", 403);
    const service = createServiceRoleClient();
    const measured = await measureStoredMapPackageObject(service, mapPackageObjectPath(row, row.upload_file_name), mapPackageZipMaxBytes());
    if (!measured) throw new ProviderRequestError("map_package_file_missing", 409);
    const { data, error } = await service.rpc("complete_uploaded_map_package", {
      p_package_id: packageId, p_user_id: userId, p_bytes: measured.bytes, p_sha256: measured.sha256,
    });
    mapPackageRpcError(error);
    audit.info("map_package_upload_completed", { packageId, bytes: measured.bytes });
    return providerJson({ package: data });
  } catch (error) { const response = providerError(error); audit.warn("request_refused", { status: response.status }); return response; }
}

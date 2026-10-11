import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { ProviderRequestError, providerError, providerUser } from "@/lib/assistant/provider-server";
import { MAP_PACKAGE_FILE_LIMITS } from "@/lib/map-packages/contracts";
import { type MapPackageFileRow, mapPackageObjectPath, mapPackageRpcError, signedMapPackageDownload } from "@/lib/map-packages/server";

export const runtime = "nodejs";

const paramsSchema = z.object({ packageId: z.string().uuid(), fileName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/) }).strict();

/**
 * Deliver one verified file of a package to a workspace member. Previews and
 * the run report stream through here, so no reusable link reaches the page.
 * The ZIP is too large to proxy; it redirects to a five-minute signed URL.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ packageId: string; fileName: string }> }) {
  const audit = createApiAuditLogger("map_packages.file.get", request);
  try {
    const { packageId, fileName } = paramsSchema.parse(await context.params);
    const { client } = await providerUser();
    const fileRead = await client.from("project_map_package_files").select("id, package_id, workspace_id, project_id, role, name, object_path, bytes, sha256, verified_at, created_at")
      .eq("package_id", packageId).eq("name", fileName).not("verified_at", "is", null).maybeSingle();
    mapPackageRpcError(fileRead.error);
    const file = fileRead.data as MapPackageFileRow | null;
    // The stored path must be the one this package and name produce; anything
    // else is refused before it reaches the signer.
    if (!file || file.object_path !== mapPackageObjectPath({ workspace_id: file.workspace_id, project_id: file.project_id, id: file.package_id }, file.name)) {
      throw new ProviderRequestError("map_package_not_found", 404);
    }
    const service = createServiceRoleClient();
    if (file.role === "package_zip") {
      audit.info("map_package_zip_signed", { packageId });
      return NextResponse.redirect(await signedMapPackageDownload(service, file.object_path, file.name));
    }
    const original = await fetch(await signedMapPackageDownload(service, file.object_path, false), { signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (!original.ok || !original.body) throw new ProviderRequestError("map_package_storage_unavailable", 503);
    audit.info("map_package_file_streamed", { packageId, role: file.role });
    return new NextResponse(original.body, { headers: {
      "Content-Type": MAP_PACKAGE_FILE_LIMITS[file.role].contentType + (file.role === "run_report" ? "; charset=utf-8" : ""),
      "Content-Disposition": `${file.role === "figure_preview" ? "inline" : "attachment"}; filename="${file.name}"`,
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "X-Content-Type-Options": "nosniff",
      "X-OpenPlan-File-SHA256": file.sha256,
      "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    const response = providerError(error);
    audit.warn("request_refused", { status: response.status });
    return response;
  }
}

import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { ProviderRequestError, providerBearer, providerBody, providerError, providerJson } from "@/lib/assistant/provider-server";
import {
  checkedMapPackageFiles,
  mapPackageBriefSchema,
  mapPackageFileDeclarationSchema,
  mapPackageProgressSchema,
  mapPackageReceiptSchema,
  mapPackageZipMaxBytes,
} from "@/lib/map-packages/contracts";
import { mapPackageRunPrompt, MAP_PACKAGE_RUN_PROMPT_VERSION } from "@/lib/map-packages/run-prompt";
import { MAP_PACKAGE_SKILL } from "@/lib/map-packages/skill";
import {
  type MapPackageFileRow,
  mapPackageFileMaxBytes,
  mapPackageRpcError,
  measureStoredMapPackageObject,
  signedMapPackageUpload,
} from "@/lib/map-packages/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const attempt = { packageId: z.string().uuid(), attemptId: z.string().uuid() };
const requestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("claim"), authMode: z.enum(["chatgpt", "apiKey", "claude_subscription"]) }).strict(),
  z.object({ operation: z.literal("heartbeat"), ...attempt, progress: mapPackageProgressSchema.nullable() }).strict(),
  z.object({ operation: z.literal("upload"), ...attempt, receipt: mapPackageReceiptSchema, files: z.array(mapPackageFileDeclarationSchema).min(1).max(62) }).strict(),
  z.object({ operation: z.literal("complete"), ...attempt }).strict(),
  z.object({ operation: z.literal("fail"), ...attempt, failureCode: z.string().regex(/^[a-z_]{1,120}$/) }).strict(),
]);

const claimedSchema = z.object({
  id: z.string().uuid(), attempt_id: z.string().uuid(), workspace_id: z.string().uuid(), project_id: z.string().uuid(),
  title: z.string(), provider: z.string(), auth_mode: z.string(), model_id: z.string(), effort: z.string(),
  brief_canonical: z.string(), brief_hash: z.string(), skill_tree_hash: z.string(), lease_expires_at: z.string(),
}).passthrough();

/**
 * The map package endpoint for the planner's own connector. It accepts only
 * the scoped project connection bearer: no cookie session, no service key on
 * the planner's computer, and every state change is a locked database function.
 */
export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("map_packages.connector.post", request);
  try {
    const { connectionId, tokenHash } = providerBearer(request);
    const body = await providerBody(request, requestSchema);
    const service = createServiceRoleClient();
    const token = { p_connection_id: connectionId, p_token_hash: tokenHash };

    if (body.operation === "claim") {
      const { data, error } = await service.rpc("claim_project_map_package", { ...token, p_auth_mode: body.authMode });
      mapPackageRpcError(error);
      const claimed = z.object({ status: z.string(), package: z.unknown().nullable() }).parse(data);
      if (!claimed.package) return providerJson({ status: claimed.status, package: null });
      const job = claimedSchema.parse(claimed.package);
      const brief = mapPackageBriefSchema.parse(JSON.parse(job.brief_canonical));
      if (createHash("sha256").update(job.brief_canonical, "utf8").digest("hex") !== job.brief_hash || job.skill_tree_hash !== brief.skill.treeHash) {
        throw new ProviderRequestError("map_package_claim_mismatch", 409);
      }
      audit.info("map_package_claimed", { packageId: job.id, attemptId: job.attempt_id });
      return providerJson({ status: claimed.status, package: {
        id: job.id, attemptId: job.attempt_id, workspaceId: job.workspace_id, projectId: job.project_id, title: job.title,
        provider: job.provider, authMode: job.auth_mode, model: job.model_id, effort: job.effort,
        briefCanonical: job.brief_canonical, briefHash: job.brief_hash,
        skill: { name: MAP_PACKAGE_SKILL.name, treeHash: job.skill_tree_hash },
        promptVersion: MAP_PACKAGE_RUN_PROMPT_VERSION, prompt: mapPackageRunPrompt(brief), leaseExpiresAt: job.lease_expires_at,
      } });
    }

    const ids = { p_package_id: body.packageId, p_attempt_id: body.attemptId, ...token };
    if (body.operation === "heartbeat") {
      const { data, error } = await service.rpc("heartbeat_project_map_package", { ...ids, p_progress: body.progress });
      mapPackageRpcError(error);
      return providerJson(z.object({ state: z.string(), leaseExpiresAt: z.string().nullable() }).parse(data));
    }
    if (body.operation === "fail") {
      const { data, error } = await service.rpc("fail_project_map_package", { ...ids, p_failure_code: body.failureCode });
      mapPackageRpcError(error);
      audit.info("map_package_failed", { packageId: body.packageId, failureCode: body.failureCode });
      return providerJson(data);
    }
    if (body.operation === "upload") {
      let files;
      try { files = checkedMapPackageFiles(body.files); } catch { throw new ProviderRequestError("map_package_files_invalid", 400); }
      const declared = new Set(files.map(file => file.name));
      if (body.receipt.figures.some(figure => figure.preview !== null && !declared.has(figure.preview))) throw new ProviderRequestError("map_package_files_invalid", 400);
      const { data, error } = await service.rpc("begin_project_map_package_upload", { ...ids, p_receipt: body.receipt, p_files: files });
      mapPackageRpcError(error);
      const job = z.object({ id: z.string().uuid(), workspace_id: z.string().uuid(), project_id: z.string().uuid(), state: z.literal("uploading") }).passthrough().parse(data);
      const rows = await service.from("project_map_package_files").select("id, package_id, workspace_id, project_id, role, name, object_path, bytes, sha256, verified_at, created_at").eq("package_id", job.id).is("verified_at", null);
      mapPackageRpcError(rows.error);
      const uploads = [];
      for (const row of (rows.data ?? []) as MapPackageFileRow[]) uploads.push({ name: row.name, url: await signedMapPackageUpload(service, row.object_path) });
      audit.info("map_package_upload_issued", { packageId: job.id, files: uploads.length });
      return providerJson({ uploads });
    }

    // complete: confirm this connector owns the attempt before reading any
    // stored object, then measure every object before the package becomes ready.
    const owned = await service.rpc("heartbeat_project_map_package", { ...ids, p_progress: null });
    mapPackageRpcError(owned.error);
    const ownedState = z.object({ state: z.string() }).passthrough().parse(owned.data).state;
    if (ownedState === "ready") return providerJson({ state: ownedState });
    if (ownedState !== "uploading") throw new ProviderRequestError("map_package_not_uploading", 409);
    const rows = await service.from("project_map_package_files").select("id, package_id, workspace_id, project_id, role, name, object_path, bytes, sha256, verified_at, created_at").eq("package_id", body.packageId);
    mapPackageRpcError(rows.error);
    const files = (rows.data ?? []) as MapPackageFileRow[];
    if (!files.length) throw new ProviderRequestError("map_package_files_invalid", 400);
    const zipMax = mapPackageZipMaxBytes();
    const verified = [];
    for (const file of files) {
      const measured = await measureStoredMapPackageObject(service, file.object_path, mapPackageFileMaxBytes(file.role, zipMax));
      if (!measured) throw new ProviderRequestError("map_package_file_missing", 409);
      verified.push({ name: file.name, bytes: measured.bytes, sha256: measured.sha256 });
    }
    const { data, error } = await service.rpc("complete_project_map_package", { ...ids, p_verified: verified });
    mapPackageRpcError(error);
    audit.info("map_package_ready", { packageId: body.packageId, files: verified.length });
    return providerJson({ state: z.object({ state: z.string() }).passthrough().parse(data).state });
  } catch (error) { const response = providerError(error); audit.warn("request_refused", { status: response.status }); return response; }
}

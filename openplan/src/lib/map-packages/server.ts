import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProjectCorridorRow } from "@/lib/cartographic/project-corridor-record";
import { ProviderRequestError, type ProviderService, type ProviderUserClient } from "@/lib/assistant/provider-server";
import { buildMapPackageBrief, type MapPackageBriefProject } from "./brief";
import type { MapPackageDeliverable } from "./catalog";
import { MAP_PACKAGE_FILE_LIMITS, type MapPackageFileRole } from "./contracts";

const MAP_PACKAGE_BUCKET = "project-map-packages";
/** A short life: the link is used at once by the browser or the connector, and is not kept. */
const MAP_PACKAGE_SIGNED_URL_TTL_SECONDS = 300;

export type MapPackageFileRow = {
  id: string; package_id: string; workspace_id: string; project_id: string; role: MapPackageFileRole;
  name: string; object_path: string; bytes: number; sha256: string; verified_at: string | null; created_at: string;
};

export function mapPackageObjectPath(row: { workspace_id: string; project_id: string; id: string }, name: string) {
  return `${row.workspace_id}/${row.project_id}/${row.id}/${name}`;
}

/** Map an RPC error to a status without echoing database text, which may hold brief content. */
export function mapPackageRpcError(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === "42501") throw new ProviderRequestError("map_package_access_denied", 403);
  if (error.code === "PT409") throw new ProviderRequestError("map_package_retry_conflict", 409);
  if (error.code === "22023" || error.code === "23514" || error.code === "23505") throw new ProviderRequestError("map_package_request_invalid", 400);
  throw new ProviderRequestError("map_package_storage_unavailable", 503);
}

/**
 * Freeze the brief from the records the caller can read: the project with its
 * place, its corridors, and the grant application if one is named. Reads use
 * the caller's own client, so RLS bounds what can enter the brief.
 */
export async function loadMapPackageBrief(client: ProviderUserClient, input: {
  workspaceId: string; projectId: string; fundingOpportunityId: string | null; client: string;
  deliverable: MapPackageDeliverable; request: string; practice: boolean; capturedAt: string;
}) {
  const projectRead = await client.from("projects")
    .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, latitude, longitude, place_source, place_kind, place_ref, place_label, place_country_code, place_subdivision_code, place_min_lon, place_min_lat, place_max_lon, place_max_lat, place_geometry_geojson, place_set_at")
    .eq("id", input.projectId).eq("workspace_id", input.workspaceId).maybeSingle();
  if (projectRead.error) throw new ProviderRequestError("map_package_storage_unavailable", 503);
  if (!projectRead.data) throw new ProviderRequestError("map_package_access_denied", 403);
  const corridorRead = await client.from("project_corridors").select("id, workspace_id, project_id, name, corridor_type, los_grade, geometry_geojson, created_at, updated_at")
    .eq("project_id", input.projectId).eq("workspace_id", input.workspaceId).order("created_at", { ascending: true });
  if (corridorRead.error) throw new ProviderRequestError("map_package_storage_unavailable", 503);
  let opportunity = null;
  if (input.fundingOpportunityId) {
    const opportunityRead = await client.from("funding_opportunities").select("id, title, agency_name, program_id, closes_at")
      .eq("id", input.fundingOpportunityId).eq("workspace_id", input.workspaceId).maybeSingle();
    if (opportunityRead.error) throw new ProviderRequestError("map_package_storage_unavailable", 503);
    if (!opportunityRead.data) throw new ProviderRequestError("map_package_access_denied", 403);
    opportunity = opportunityRead.data as { id: string; title: string; agency_name: string | null; program_id: string | null; closes_at: string | null };
  }
  return buildMapPackageBrief({
    project: projectRead.data as unknown as MapPackageBriefProject,
    corridors: (corridorRead.data ?? []) as ProjectCorridorRow[],
    fundingOpportunity: opportunity,
    client: input.client,
    deliverable: input.deliverable,
    request: input.request,
    practice: input.practice,
    capturedAt: input.capturedAt,
  });
}

export async function signedMapPackageUpload(service: ProviderService, objectPath: string) {
  const { data, error } = await service.storage.from(MAP_PACKAGE_BUCKET).createSignedUploadUrl(objectPath, { upsert: false });
  if (error || !data?.signedUrl) throw new ProviderRequestError("map_package_storage_unavailable", 503);
  return data.signedUrl;
}

export async function signedMapPackageDownload(service: ProviderService, objectPath: string, download: string | false) {
  const { data, error } = await service.storage.from(MAP_PACKAGE_BUCKET)
    .createSignedUrl(objectPath, MAP_PACKAGE_SIGNED_URL_TTL_SECONDS, download ? { download } : undefined);
  if (error || !data?.signedUrl) throw new ProviderRequestError("map_package_storage_unavailable", 503);
  return data.signedUrl;
}

/**
 * Read a stored object back and measure it. The package becomes ready only on
 * this measurement, never on what an uploader said it sent. Reading stops as
 * soon as the object runs past `maxBytes`.
 */
export async function measureStoredMapPackageObject(service: ProviderService, objectPath: string, maxBytes: number,
  fetchImpl: typeof fetch = fetch): Promise<{ bytes: number; sha256: string } | null> {
  // Storage refuses to sign a missing object; that is "not uploaded", not an outage.
  const signed = await service.storage.from(MAP_PACKAGE_BUCKET).createSignedUrl(objectPath, MAP_PACKAGE_SIGNED_URL_TTL_SECONDS);
  if (signed.error && /not found/i.test(signed.error.message)) return null;
  if (signed.error || !signed.data?.signedUrl) throw new ProviderRequestError("map_package_storage_unavailable", 503);
  const response = await fetchImpl(signed.data.signedUrl, { signal: AbortSignal.timeout(280_000), cache: "no-store" });
  if (response.status === 400 || response.status === 404) return null;
  if (!response.ok || !response.body) throw new ProviderRequestError("map_package_storage_unavailable", 503);
  const hash = createHash("sha256");
  let bytes = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) { await reader.cancel(); throw new ProviderRequestError("map_package_file_too_large", 413); }
    hash.update(value);
  }
  return { bytes, sha256: hash.digest("hex") };
}

export function mapPackageFileMaxBytes(role: MapPackageFileRole, zipMaxBytes: number) {
  return role === "package_zip" ? zipMaxBytes : MAP_PACKAGE_FILE_LIMITS[role].maxBytes;
}

export const mapPackageIdSchema = z.object({ packageId: z.string().uuid() }).strict();

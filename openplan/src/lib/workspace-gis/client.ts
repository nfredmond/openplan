/**
 * The browser's half of the workspace-GIS store: every request the upload
 * wizard, the layer panel and the map make, written once.
 *
 * WHY THIS EXISTS RATHER THAN `fetch` AT EACH CALL SITE. The chunked upload is
 * a four-step protocol with a retry rule (`runWorkspaceGisIngest` below), and a
 * second implementation of it — one in the wizard, one in a drag-and-drop
 * handler — would get the retry subtly different and produce layers with holes.
 * The shared-capability-inside-one-of-its-callers failure, avoided by
 * extracting it before there are two callers.
 *
 * NO FORMAT KNOWLEDGE LIVES HERE. Parsing, coordinate systems and reprojection
 * are the importer's and the CRS registry's; this module moves the RESULT.
 */

import type {
  WorkspaceGisFeatureCollection,
  WorkspaceGisIngestAppendResponse,
  WorkspaceGisIngestFailureReason,
  WorkspaceGisIngestFinalizeResponse,
  WorkspaceGisIngestOpenRequest,
  WorkspaceGisIngestOpenResponse,
  WorkspaceGisLayer,
  WorkspaceGisLayerListing,
  WorkspaceGisLayerReferencesResponse,
  WorkspaceGisLayerStyle,
  WorkspaceGisVersion,
} from "./types";

export class WorkspaceGisRequestError extends Error {
  readonly status: number;
  /** Everything the route sent besides the message — export path, references, counts. */
  readonly payload: Record<string, unknown>;

  constructor(message: string, status: number, payload: Record<string, unknown> = {}) {
    super(message);
    this.name = "WorkspaceGisRequestError";
    this.status = status;
    this.payload = payload;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    // The route's own sentence, never a generic one: every refusal in this lane
    // names what it needed, and replacing it with "Request failed" is how a
    // planner ends up unable to act on a refusal that told them exactly what to do.
    const message =
      typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`;
    throw new WorkspaceGisRequestError(message, response.status, payload);
  }

  return payload as T;
}

export async function fetchWorkspaceGisLayers(options?: {
  includeArchived?: boolean;
}): Promise<WorkspaceGisLayerListing[]> {
  const query = options?.includeArchived ? "?includeArchived=1" : "";
  const result = await request<{ layers: WorkspaceGisLayerListing[] }>(
    `/api/workspace-gis/layers${query}`
  );
  return result.layers ?? [];
}

export async function fetchWorkspaceGisLayer(layerId: string): Promise<{
  layer: WorkspaceGisLayer;
  versions: WorkspaceGisVersion[];
  notes: string[];
}> {
  return request(`/api/workspace-gis/layers/${layerId}`);
}

export async function createWorkspaceGisLayer(input: {
  name: string;
  description?: string | null;
  projectId?: string | null;
  color?: string;
  opacity?: number;
  lineWidth?: number;
  defaultVisible?: boolean;
}): Promise<WorkspaceGisLayer> {
  const result = await request<{ layer: WorkspaceGisLayer }>("/api/workspace-gis/layers", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.layer;
}

export async function updateWorkspaceGisLayer(
  layerId: string,
  change: Partial<WorkspaceGisLayerStyle> & {
    name?: string;
    description?: string | null;
    projectId?: string | null;
    defaultVisible?: boolean;
    sortOrder?: number;
    currentVersionId?: string;
    archived?: boolean;
  }
): Promise<WorkspaceGisLayer> {
  const result = await request<{ layer: WorkspaceGisLayer }>(
    `/api/workspace-gis/layers/${layerId}`,
    { method: "PATCH", body: JSON.stringify(change) }
  );
  return result.layer;
}

export async function fetchWorkspaceGisLayerReferences(
  layerId: string
): Promise<WorkspaceGisLayerReferencesResponse> {
  return request(`/api/workspace-gis/layers/${layerId}/references`);
}

export async function deleteWorkspaceGisLayer(layerId: string): Promise<void> {
  await request(`/api/workspace-gis/layers/${layerId}`, { method: "DELETE" });
}

export async function fetchWorkspaceGisFeatures(
  layerId: string,
  bbox: [number, number, number, number]
): Promise<WorkspaceGisFeatureCollection> {
  return request(`/api/map-features/workspace-gis/${layerId}?bbox=${bbox.join(",")}`);
}

// ── The chunked upload ──────────────────────────────────────────────────────

export type IngestProgress = {
  featureCount: number;
  declaredFeatureCount: number;
};

/**
 * Open, append, finalize — the whole upload, with the one retry rule.
 *
 * A BATCH IS RETRIED, AND A RETRY IS SAFE. Every batch declares the index its
 * first feature occupies in the source file, and the database's unique index on
 * (version_id, feature_index) makes a resend insert nothing. So a dropped
 * connection costs one repeated request and never a duplicated shape.
 *
 * A BATCH TOO LARGE IS HALVED, NOT ABANDONED. Feature weight varies by two
 * orders of magnitude between a bus stop and a parcel polygon, so no fixed
 * batch size is right for both; the server's byte limit is the real bound and
 * the client adapts to it here rather than guessing.
 *
 * AND A FAILURE IS RECORDED. If anything throws, the ingest is closed as
 * failed, so a half-uploaded version says so instead of sitting at 'receiving'
 * until a reaper notices. The layer keeps drawing whatever it drew before.
 */
export async function runWorkspaceGisIngest(input: {
  open: WorkspaceGisIngestOpenRequest;
  /** Normalized WGS84 GeoJSON features, in source-file order. */
  features: unknown[];
  onProgress?: (progress: IngestProgress) => void;
  signal?: AbortSignal;
}): Promise<WorkspaceGisIngestFinalizeResponse> {
  const opened = await request<WorkspaceGisIngestOpenResponse>("/api/workspace-gis/ingests", {
    method: "POST",
    body: JSON.stringify(input.open),
    signal: input.signal,
  });

  const versionId = opened.version.id;

  try {
    let index = 0;
    let batchSize = Math.max(1, opened.batchSize);

    while (index < input.features.length) {
      const batch = input.features.slice(index, index + batchSize);
      let appended: WorkspaceGisIngestAppendResponse;
      try {
        appended = await request<WorkspaceGisIngestAppendResponse>(
          `/api/workspace-gis/ingests/${versionId}/features`,
          {
            method: "POST",
            body: JSON.stringify({ startIndex: index, features: batch }),
            signal: input.signal,
          }
        );
      } catch (error) {
        // 413: this batch is too heavy for the transport. Halve and retry the
        // SAME features from the same index — never skip forward.
        if (
          error instanceof WorkspaceGisRequestError &&
          error.status === 413 &&
          batchSize > 1
        ) {
          batchSize = Math.max(1, Math.floor(batchSize / 2));
          continue;
        }
        throw error;
      }

      index += batch.length;
      input.onProgress?.({
        featureCount: appended.featureCount,
        declaredFeatureCount: appended.declaredFeatureCount,
      });
    }

    return await request<WorkspaceGisIngestFinalizeResponse>(
      `/api/workspace-gis/ingests/${versionId}/finalize`,
      { method: "POST", signal: input.signal }
    );
  } catch (error) {
    await recordIngestFailure(versionId, "client_reported_failure").catch(() => {
      // The upload already failed; failing to say so must not replace the
      // original error with a less useful one.
    });
    throw error;
  }
}

export async function recordIngestFailure(
  versionId: string,
  reason: WorkspaceGisIngestFailureReason
): Promise<void> {
  await request(`/api/workspace-gis/ingests/${versionId}/finalize`, {
    method: "POST",
    body: JSON.stringify({ failed: true, reason }),
  });
}

/**
 * The zone-attribute handoff: how a worker-backed model run receives the
 * demographics its zone table is built from, WITHOUT the worker holding a
 * third-party credential of its own.
 *
 * THE DEFECT THIS REPLACES
 *   `workers/aequilibrae_worker/data_pipeline.py` read `CENSUS_API_KEY` from
 *   the worker host and, when it was absent, failed with "set CENSUS_API_KEY in
 *   openplan/.env.local". A self-serve workspace that had added its own Census
 *   key in the integrations wizard still hit that wall, because the worker
 *   could not see a per-workspace key at all. The equity overlay took the
 *   opposite and worse path: it skipped SILENTLY, producing a run with no
 *   equity KPIs and no stated reason.
 *
 * WHY THE KEY IS NOT SHIPPED TO THE WORKER
 *   The obvious shortcut — stamp the decrypted key into the `model_runs` row —
 *   would write a plaintext third-party credential into a row every workspace
 *   member can read, defeating the AES-256-GCM envelope in
 *   `lib/integrations/key-crypto.ts`. So the FETCH is inverted instead: the app
 *   holds the key, reads the demographics, and hands over a finished table.
 *   Nothing secret crosses the boundary — only public census measures.
 *
 * WHERE THE PAYLOAD TRAVELS
 *   The table itself goes to the private `run-artifacts` bucket at
 *   `model-runs/<runId>/zone-attributes.json`; only a small POINTER plus its
 *   provenance is stamped into `model_runs.input_snapshot_json`. That split is
 *   deliberate: `input_snapshot_json` is copied verbatim into every evidence
 *   packet (`lib/models/evidence-packet.ts`), and a few hundred kilobytes of
 *   census rows have no business riding inside a provenance document.
 *
 * REBUILT ON EVERY LAUNCH, WHICH IS WHAT MAKES THE RECOVERY REAL
 *   The stamp is a snapshot of one read, so it is only true of the moment it was
 *   taken. Both paths that queue a run — the initial launch and the relaunch —
 *   therefore go through {@link prepareWorkerZoneAttributes} and re-stamp. That
 *   is not tidiness: the worker's own failure text tells a planner to add a
 *   Census key and relaunch, and an unrebuilt stamp would make that instruction
 *   a false statement — the run would re-read its stale "no key" refusal forever.
 *
 * NOT A FLAG DAY
 *   The stamp is additive. A worker that predates it, or a run launched by a
 *   path that does not stamp one, falls back to the worker's own env-key fetch
 *   exactly as before. And when the app cannot build a table, the stamp records
 *   WHY, so the worker's failure names the real reason instead of inventing one.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolveZoneAttributeSource,
  type ZoneAttributeBbox,
  type ZoneAttributeLevel,
  type ZoneAttributeTableResult,
} from "@/lib/geographies/zone-attribute-source";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Wire-format version. The worker refuses a payload it does not recognise
 * rather than guessing at a newer shape — a misread population column would
 * silently rescale an entire model.
 */
export const ZONE_ATTRIBUTE_PAYLOAD_VERSION = "zone-attributes-v1";

export const ZONE_ATTRIBUTE_BUCKET = "run-artifacts";

export type ZoneAttributePayload = {
  version: typeof ZONE_ATTRIBUTE_PAYLOAD_VERSION;
  generated_at: string;
  run_id: string;
  source: {
    id: string;
    label: string;
    coverage: string;
    vintage: string;
    retrieval_url: string;
    key_origin: "workspace" | "deployment_env" | "none";
    geography_index_truncated: boolean;
  };
  tables: {
    demographics: ZoneAttributeTableResult;
    equity: ZoneAttributeTableResult;
  };
};

/**
 * The small, evidence-safe record stamped into `input_snapshot_json`. It says
 * what was supplied, from where, and — when nothing was — why not. Counts, not
 * rows: a reader must be able to tell a 400-geography table from an empty one
 * without downloading it.
 */
export type ZoneAttributeStamp = {
  version: typeof ZONE_ATTRIBUTE_PAYLOAD_VERSION;
  status: "supplied" | "unavailable" | "handoff_failed";
  /** `storage://<bucket>/<path>`; null unless status is "supplied". */
  storageRef: string | null;
  sourceId: string;
  sourceLabel: string;
  vintage: string;
  keyOrigin: "workspace" | "deployment_env" | "none";
  demographics: { status: string; geographies: number; reason: string | null };
  equity: { status: string; level: ZoneAttributeLevel | null; geographies: number; reason: string | null };
  /** Set when the whole handoff failed (upload error, unexpected exception). */
  reason: string | null;
  geographyIndexTruncated: boolean;
};

export function zoneAttributeObjectPath(runId: string): string {
  return `model-runs/${runId}/zone-attributes.json`;
}

export function zoneAttributeStorageRef(runId: string): string {
  return `storage://${ZONE_ATTRIBUTE_BUCKET}/${zoneAttributeObjectPath(runId)}`;
}

/** Bounding box of a study-area geometry, or null when it has none. */
export function zoneAttributeBboxFromGeojson(geojson: unknown): ZoneAttributeBbox | null {
  const geometry = geojson as { type?: unknown; coordinates?: unknown } | null;
  if (!geometry || typeof geometry.type !== "string" || !Array.isArray(geometry.coordinates)) {
    return null;
  }

  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let seen = 0;

  // Depth-agnostic walk: Polygon nests coordinates three deep and MultiPolygon
  // four, and a launch payload can legitimately carry either.
  const walk = (node: unknown) => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === "number" && typeof node[1] === "number") {
      const [lon, lat] = node as number[];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      seen += 1;
      return;
    }
    for (const child of node) walk(child);
  };
  walk(geometry.coordinates);

  return seen > 0 ? { minLon, minLat, maxLon, maxLat } : null;
}

function tableStamp(result: ZoneAttributeTableResult): {
  status: string;
  level: ZoneAttributeLevel | null;
  geographies: number;
  reason: string | null;
} {
  return result.status === "supplied"
    ? {
        status: "supplied",
        level: result.table.level,
        geographies: Object.keys(result.table.rows).length,
        reason: null,
      }
    : { status: "unavailable", level: null, geographies: 0, reason: result.reason };
}

/** The stamp for a run the app could not attempt a handoff for at all. */
export function zoneAttributeHandoffFailedStamp(reason: string): ZoneAttributeStamp {
  return {
    version: ZONE_ATTRIBUTE_PAYLOAD_VERSION,
    status: "handoff_failed",
    storageRef: null,
    sourceId: resolveZoneAttributeSource().descriptor.id,
    sourceLabel: resolveZoneAttributeSource().descriptor.label,
    vintage: resolveZoneAttributeSource().descriptor.vintage,
    keyOrigin: "none",
    demographics: { status: "unavailable", geographies: 0, reason },
    equity: { status: "unavailable", level: null, geographies: 0, reason },
    reason,
    geographyIndexTruncated: false,
  };
}

/** Minimal structural view of the one Storage call this module makes. */
export type ZoneAttributeUploader = {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: string | Blob | ArrayBuffer | Uint8Array,
        options?: { contentType?: string; upsert?: boolean }
      ) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

/**
 * Build the run's zone-attribute table and hand it to Storage.
 *
 * MUST NOT THROW and must never fail a launch: a run with no supplied table is
 * still a run the worker can attempt on its own env key. What it must never do
 * is come back silent — every non-supplied outcome carries a reason the worker
 * will surface.
 *
 * Call this INSIDE `withWorkspaceIntegrationContext`, or the workspace's own
 * Census key will not be visible and the read falls back to the deployment env.
 */
export async function prepareZoneAttributeHandoff(args: {
  runId: string;
  corridorGeojson: unknown;
  /** The run's TAZ resolution — the level the equity overlay is published at. */
  zoneGeography: ZoneAttributeLevel;
  uploader: ZoneAttributeUploader;
}): Promise<ZoneAttributeStamp> {
  const { runId, corridorGeojson, zoneGeography, uploader } = args;

  try {
    const bbox = zoneAttributeBboxFromGeojson(corridorGeojson);
    if (!bbox) {
      return zoneAttributeHandoffFailedStamp(
        "This run has no usable study-area geometry, so no demographics could be resolved for it."
      );
    }

    const source = resolveZoneAttributeSource();
    const fetched = await source.fetch({ bbox, equityLevel: zoneGeography });

    const demographics = tableStamp(fetched.demographics);
    const equity = tableStamp(fetched.equity);

    const baseStamp: ZoneAttributeStamp = {
      version: ZONE_ATTRIBUTE_PAYLOAD_VERSION,
      status: "unavailable",
      storageRef: null,
      sourceId: fetched.descriptor.id,
      sourceLabel: fetched.descriptor.label,
      vintage: fetched.descriptor.vintage,
      keyOrigin: fetched.keyOrigin,
      demographics: {
        status: demographics.status,
        geographies: demographics.geographies,
        reason: demographics.reason,
      },
      equity,
      reason: null,
      geographyIndexTruncated: fetched.geographyIndexTruncated,
    };

    // Nothing usable at all: skip the upload rather than park an empty object
    // in Storage that the worker would have to interpret.
    if (fetched.demographics.status !== "supplied" && fetched.equity.status !== "supplied") {
      return { ...baseStamp, reason: demographics.reason ?? equity.reason };
    }

    const payload: ZoneAttributePayload = {
      version: ZONE_ATTRIBUTE_PAYLOAD_VERSION,
      generated_at: new Date().toISOString(),
      run_id: runId,
      source: {
        id: fetched.descriptor.id,
        label: fetched.descriptor.label,
        coverage: fetched.descriptor.coverage,
        vintage: fetched.descriptor.vintage,
        retrieval_url: fetched.descriptor.retrievalUrl,
        key_origin: fetched.keyOrigin,
        geography_index_truncated: fetched.geographyIndexTruncated,
      },
      tables: { demographics: fetched.demographics, equity: fetched.equity },
    };

    const { error } = await uploader.storage
      .from(ZONE_ATTRIBUTE_BUCKET)
      .upload(zoneAttributeObjectPath(runId), JSON.stringify(payload), {
        contentType: "application/json",
        upsert: true,
      });

    if (error) {
      // The table exists but could not be delivered. That is a DIFFERENT
      // failure from "no key", and the worker's message must not conflate them.
      return {
        ...baseStamp,
        status: "handoff_failed",
        reason: `The demographics for this run were read but could not be stored for the worker (${error.message}).`,
      };
    }

    return { ...baseStamp, status: "supplied", storageRef: zoneAttributeStorageRef(runId) };
  } catch (error) {
    return zoneAttributeHandoffFailedStamp(
      `Preparing demographics for this run failed unexpectedly (${
        error instanceof Error ? error.message : String(error)
      }).`
    );
  }
}

/** Narrow a Supabase client to the structural uploader this module needs. */
export function asZoneAttributeUploader(client: SupabaseClient | unknown): ZoneAttributeUploader {
  return client as ZoneAttributeUploader;
}

/**
 * Read a run's study-area demographics with the WORKSPACE's Census key and hand
 * the resulting table to the worker through private Storage.
 *
 * THE ONE ENTRY POINT, deliberately. Both routes that put a run in front of the
 * AequilibraE worker call this: the initial launch (`POST /api/models/[modelId]
 * /runs`, including the large-study-area reroute) and the relaunch
 * (`POST /api/models/[modelId]/runs/[modelRunId]/launch`). A second copy is how
 * the recovery loop got broken in the first place — the relaunch path re-queued
 * a run without rebuilding its stamp, so a run stamped "no Census key" re-read
 * that same refusal forever and "add a key, then relaunch" could never succeed.
 * One function means the two paths cannot drift apart again.
 *
 * MUST be called inside `withWorkspaceIntegrationContext`, or `censusApiKey()`
 * cannot see the workspace's own key and the read silently falls back to the
 * deployment env.
 *
 * Never throws and never blocks a launch: a run with no supplied table still
 * reaches the worker, which then falls back to its own env key and — if that is
 * absent too — fails naming the reason recorded here.
 */
export async function prepareWorkerZoneAttributes(args: {
  modelRunId: string;
  corridorGeojson: unknown;
  zoneGeography: ZoneAttributeLevel;
}): Promise<ZoneAttributeStamp> {
  let uploader: ZoneAttributeUploader;
  try {
    uploader = asZoneAttributeUploader(createServiceRoleClient());
  } catch (error) {
    // No service-role key on this deployment. Real, operator-fixable, and it
    // must be said rather than silently degraded into "no demographics".
    return zoneAttributeHandoffFailedStamp(
      `This deployment cannot store run inputs for the worker because its Supabase service-role key is unavailable (${
        error instanceof Error ? error.message : String(error)
      }).`
    );
  }

  try {
    return await prepareZoneAttributeHandoff({
      runId: args.modelRunId,
      corridorGeojson: args.corridorGeojson,
      zoneGeography: args.zoneGeography,
      uploader,
    });
  } catch (error) {
    // prepareZoneAttributeHandoff documents that it never throws, and it
    // catches its own failures. This is the boundary honoring the promise
    // anyway: if that contract is ever broken, the cost must be a degraded run
    // that says so — not a 500 that leaves the planner with no run at all.
    return zoneAttributeHandoffFailedStamp(
      `Preparing demographics for this run failed unexpectedly (${
        error instanceof Error ? error.message : String(error)
      }).`
    );
  }
}

/**
 * The chunked ingest, as rules rather than as route code.
 *
 * WHY IT IS CHUNKED AT ALL. A county parcel shapefile is 50-200 MB. No
 * serverless request body will hold it (Vercel refuses over roughly 4.5 MB
 * before a handler runs), and a 200 MB parse is not something to do inside a
 * 60-second function anyway. So the browser — which already has the file, and
 * already has the shared importer that reads it — parses and reprojects
 * locally, opens an ingest, and posts features in batches.
 *
 * WHAT THAT COSTS, AND WHAT PAYS FOR IT. A client that can post features can
 * post WRONG features. Three things bound that, and none of them is trust:
 *   1. The coordinate system is decided SERVER-side from the file's own .prj
 *      text or from an explicit, attributed assertion (`crs-resolution.ts`).
 *   2. Every feature lands in a table whose CHECK refuses any coordinate
 *      outside the world, so a mis-scaled layer cannot be stored at all.
 *   3. A version is `ready` only when the count that arrived equals the count
 *      declared at the start — a CHECK, not a route's promise. A client that
 *      stops halfway leaves a version visibly unfinished, and an unfinished
 *      version is one no map will draw.
 *
 * PURE — validation and arithmetic. No I/O, no environment.
 */

import { BODY_LIMITS } from "@/lib/http/body-limit";

import type {
  WorkspaceGisIngestOpenRequest,
  WorkspaceGisSourceFormat,
} from "./types";
import { WORKSPACE_GIS_SOURCE_FORMATS } from "./types";

/**
 * How many features the client should put in one batch.
 *
 * ADVISORY, and the byte limit is what is enforced — a batch of 2,000 county
 * parcels with fifty attributes each is well past 4 MiB, and a batch of 2,000
 * bus stops is a tenth of it. The client halves on a 413; this number is a
 * starting point chosen so a typical line or point layer completes in a
 * sensible number of round trips rather than a number chosen to be safe for the
 * worst case, which would make a 200,000-feature upload take 400 requests.
 */
export const WORKSPACE_GIS_INGEST_BATCH_SIZE = 2_000;

/** The enforced bound: one batch's JSON body. */
export const WORKSPACE_GIS_BATCH_BYTE_LIMIT = BODY_LIMITS.workspaceGisFeatureBatch;

export const WORKSPACE_GIS_BATCH_TOO_LARGE_MESSAGE =
  `One upload batch may carry up to ${Math.round(WORKSPACE_GIS_BATCH_BYTE_LIMIT / (1024 * 1024))} MB of features. ` +
  `Send fewer features per batch — nothing was stored from this one, and the same batch can be sent again split in two.`;

export type IngestOpenValidation =
  | { ok: true; request: WorkspaceGisIngestOpenRequest }
  | { ok: false; message: string };

function isSourceFormat(value: unknown): value is WorkspaceGisSourceFormat {
  return (
    typeof value === "string" &&
    (WORKSPACE_GIS_SOURCE_FORMATS as readonly string[]).includes(value)
  );
}

function nonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * What the server will accept as the opening of an ingest.
 *
 * THE COUNT ARITHMETIC IS CHECKED HERE AND AGAIN IN SQL. The database's
 * `truncation_coherent` CHECK is the one that cannot be bypassed, but a
 * constraint violation surfaces to a planner as a 500 with a Postgres message
 * in it. This turns the same rule into a sentence, so the honest refusal and
 * the unbypassable rule are the same rule stated twice rather than two rules.
 */
export function validateIngestOpenRequest(body: unknown): IngestOpenValidation {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Expected an ingest description." };
  }
  const input = body as Record<string, unknown>;

  const layerId = typeof input.layerId === "string" ? input.layerId.trim() : "";
  if (!layerId) return { ok: false, message: "An ingest must name the layer it belongs to." };

  if (!isSourceFormat(input.sourceFormat)) {
    return {
      ok: false,
      message: `Unrecognised file format. OpenPlan reads: ${WORKSPACE_GIS_SOURCE_FORMATS.join(", ")}.`,
    };
  }

  const sourceFilename =
    typeof input.sourceFilename === "string" ? input.sourceFilename.trim() : "";
  if (!sourceFilename) {
    return { ok: false, message: "An upload must record the name of the file it came from." };
  }

  const sourceByteSize = nonNegativeInteger(input.sourceByteSize);
  const declaredFeatureCount = nonNegativeInteger(input.declaredFeatureCount);
  const sourceFeatureCount = nonNegativeInteger(input.sourceFeatureCount);
  const droppedFeatureCount = nonNegativeInteger(input.droppedFeatureCount) ?? 0;

  if (sourceByteSize === null || declaredFeatureCount === null || sourceFeatureCount === null) {
    return { ok: false, message: "An upload must declare how large it is and how many shapes it holds." };
  }

  if (declaredFeatureCount + droppedFeatureCount > sourceFeatureCount) {
    return {
      ok: false,
      message:
        "The counts in this upload do not add up: more shapes are claimed as stored and dropped than the file holds. " +
        "Nothing was stored.",
    };
  }

  const reprojectionEngine =
    input.reprojectionEngine === "openplan" ||
    input.reprojectionEngine === "gdal" ||
    input.reprojectionEngine === "none"
      ? input.reprojectionEngine
      : null;
  if (!reprojectionEngine) {
    return {
      ok: false,
      message: "An upload must record which engine moved its coordinates, or that none did.",
    };
  }

  const geometryKinds = Array.isArray(input.geometryKinds)
    ? input.geometryKinds.filter((kind): kind is string => typeof kind === "string")
    : [];

  const attributeFields = Array.isArray(input.attributeFields)
    ? input.attributeFields.flatMap((field) => {
        if (!field || typeof field !== "object") return [];
        const record = field as Record<string, unknown>;
        const name = typeof record.name === "string" ? record.name.trim() : "";
        if (!name) return [];
        return [{ name, type: typeof record.type === "string" ? record.type : "unknown" }];
      })
    : [];

  const bbox = Array.isArray(input.bbox) && input.bbox.length === 4 &&
    input.bbox.every((entry) => typeof entry === "number" && Number.isFinite(entry))
      ? ([input.bbox[0], input.bbox[1], input.bbox[2], input.bbox[3]] as [
          number,
          number,
          number,
          number,
        ])
      : null;

  return {
    ok: true,
    request: {
      layerId,
      sourceFormat: input.sourceFormat,
      sourceFilename,
      sourceByteSize,
      prjText: typeof input.prjText === "string" ? input.prjText : null,
      assertedSrsCode: typeof input.assertedSrsCode === "string" ? input.assertedSrsCode : null,
      datumAcknowledged: input.datumAcknowledged === true,
      declaredFeatureCount,
      sourceFeatureCount,
      droppedFeatureCount,
      geometryKinds,
      attributeFields,
      attributeEncoding:
        typeof input.attributeEncoding === "string" ? input.attributeEncoding : null,
      attributeEncodingIsFallback: input.attributeEncodingIsFallback === true,
      bbox,
      reprojectionEngine,
    },
  };
}

export type BatchValidation =
  | { ok: true; startIndex: number; features: unknown[] }
  | { ok: false; message: string };

/**
 * What the server will accept as one batch.
 *
 * The features themselves are NOT inspected here beyond shape: the geometry is
 * handed to PostGIS, which is the only thing qualified to say whether it is
 * valid, and whose refusal aborts the whole batch rather than storing part of
 * it. Checking geometry twice, in two languages, is how the two come to
 * disagree.
 */
export function validateFeatureBatch(body: unknown): BatchValidation {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Expected a batch of features." };
  }
  const input = body as Record<string, unknown>;

  const startIndex = nonNegativeInteger(input.startIndex);
  if (startIndex === null) {
    return {
      ok: false,
      message:
        "A batch must say which feature of the file it starts at. That index is what makes a retried batch " +
        "harmless instead of a duplicate.",
    };
  }

  if (!Array.isArray(input.features)) {
    return { ok: false, message: "A batch must carry an array of GeoJSON features." };
  }

  if (input.features.length === 0) {
    return { ok: false, message: "An empty batch stores nothing; do not send one." };
  }

  const malformed = input.features.findIndex((feature) => {
    if (!feature || typeof feature !== "object") return true;
    const record = feature as Record<string, unknown>;
    return !record.geometry || typeof record.geometry !== "object";
  });

  if (malformed >= 0) {
    return {
      ok: false,
      message: `Feature ${startIndex + malformed} in this batch has no geometry. Nothing from this batch was stored.`,
    };
  }

  return { ok: true, startIndex, features: input.features };
}

/**
 * Whether an ingest can be declared finished.
 *
 * The database enforces this too — `ready` is CHECK-constrained to mean the
 * counts match — so this exists to produce the SENTENCE rather than to be the
 * rule. A finalize that arrives early is a client bug, and the reply says
 * exactly which features never turned up.
 */
export function describeIncompleteIngest(
  featureCount: number,
  declaredFeatureCount: number
): string {
  const missing = declaredFeatureCount - featureCount;
  return (
    `This upload is not finished: ${featureCount.toLocaleString()} of ${declaredFeatureCount.toLocaleString()} shapes ` +
    `have arrived and ${missing.toLocaleString()} have not. It stays unfinished — a partly loaded layer is never drawn, ` +
    `because a map missing shapes nobody knows about is worse than a map that is not there.`
  );
}

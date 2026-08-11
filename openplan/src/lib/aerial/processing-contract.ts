import { z } from "zod";

/**
 * TypeScript/zod mirror of schemas/aerial_processing_contract.schema.json
 * (natford-aerial-processing.v1 / v1.1) — the service contract between
 * OpenPlan and an ODM processing worker: the external Aerial Intel Platform,
 * or the self-hosted NodeODM worker in workers/odm_worker.
 *
 * The JSON schema is the single source of truth and is committed identically
 * to both repositories; keep this module in lockstep with it and bump the
 * schema version for any breaking change.
 *
 * REVISION v1.1 IS ADDITIVE, AND THE VERSIONING RULE IS LOAD-BEARING:
 *   - a request whose imagery is `zip_url` MUST still declare v1, so a
 *     v1-only worker (the external platform) receives byte-identical payloads
 *     and its strict validator never sees v1.1;
 *   - a request whose imagery is `photo_manifest` MUST declare v1.1, so a
 *     v1-only worker refuses it loudly instead of half-understanding it;
 *   - callbacks are accepted under either version.
 * `buildProcessingRequest` derives the version from the imagery type, so a
 * caller cannot pair them wrongly; the schemas below refuse the wrong pairing
 * on the wire as well.
 */

export const CONTRACT_SCHEMA_VERSION = "natford-aerial-processing.v1" as const;
export const CONTRACT_SCHEMA_VERSION_V1_1 = "natford-aerial-processing.v1.1" as const;

export const CONTRACT_SCHEMA_VERSIONS = [
  CONTRACT_SCHEMA_VERSION,
  CONTRACT_SCHEMA_VERSION_V1_1,
] as const;
export type ContractSchemaVersion = (typeof CONTRACT_SCHEMA_VERSIONS)[number];

/**
 * The contract's two imagery shapes. Also the vocabulary of
 * `aerial_processing_jobs.imagery_type` (20260811000004) — one vocabulary,
 * two places, guarded the same way the custody kinds are.
 */
export const CONTRACT_IMAGERY_TYPES = ["zip_url", "photo_manifest"] as const;
export type ContractImageryType = (typeof CONTRACT_IMAGERY_TYPES)[number];

export const PROCESSING_PRESET_IDS = ["fast-preview", "balanced", "high-quality"] as const;
export type ProcessingPresetId = (typeof PROCESSING_PRESET_IDS)[number];

export const PROCESSING_CALLBACK_STATUSES = [
  "accepted",
  "running",
  "succeeded",
  "failed",
  "canceled",
] as const;
export type ProcessingCallbackStatus = (typeof PROCESSING_CALLBACK_STATUSES)[number];

export const PROCESSING_ARTIFACT_KINDS = [
  "orthomosaic",
  "dsm",
  "dtm",
  "point_cloud",
  "mesh",
  "ortho_preview",
] as const;
export type ProcessingArtifactKind = (typeof PROCESSING_ARTIFACT_KINDS)[number];

export const processingExternalRefSchema = z
  .object({
    system: z.string(),
    missionId: z.string(),
    workspaceId: z.string(),
    projectId: z.string().optional(),
  })
  .strict();

export const zipImagerySchema = z
  .object({
    type: z.literal("zip_url"),
    url: z.string().url(),
    imageCount: z.number().int().min(1).optional(),
    sizeBytes: z.number().int().min(1).optional(),
  })
  .strict();

export const photoManifestPhotoSchema = z
  .object({
    url: z.string().url(),
    filename: z.string().min(1).max(512),
    sizeBytes: z.number().int().min(0).optional(),
    checksumSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "checksumSha256 must be 64 lowercase hex characters")
      .optional(),
  })
  .strict();

export const photoManifestImagerySchema = z
  .object({
    type: z.literal("photo_manifest"),
    photos: z.array(photoManifestPhotoSchema).min(1).max(10000),
    imageCount: z.number().int().min(1),
    totalSizeBytes: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.imageCount !== value.photos.length) {
      ctx.addIssue({
        code: "custom",
        path: ["imageCount"],
        message: `imageCount (${value.imageCount}) must equal photos.length (${value.photos.length}) — carried explicitly so a truncated payload is detectable`,
      });
    }
  });

export const processingImagerySchema = z.union([zipImagerySchema, photoManifestImagerySchema]);

export const processingRequestSchema = z
  .object({
    schemaVersion: z.enum(CONTRACT_SCHEMA_VERSIONS),
    requestId: z.string().min(8).max(128),
    callbackUrl: z.string().url(),
    externalRef: processingExternalRefSchema,
    missionTitle: z.string().min(1).max(256),
    imagery: processingImagerySchema,
    presetId: z.enum(PROCESSING_PRESET_IDS).optional(),
    notes: z.string().max(2048).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // The version↔imagery pairing rule (see the module header). Enforced here
    // as well as in the JSON schema, so a hand-assembled payload cannot slip a
    // v1.1 marker past a v1-only worker or vice versa.
    if (value.imagery.type === "zip_url" && value.schemaVersion !== CONTRACT_SCHEMA_VERSION) {
      ctx.addIssue({
        code: "custom",
        path: ["schemaVersion"],
        message: "a zip_url request must declare natford-aerial-processing.v1",
      });
    }
    if (
      value.imagery.type === "photo_manifest" &&
      value.schemaVersion !== CONTRACT_SCHEMA_VERSION_V1_1
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["schemaVersion"],
        message: "a photo_manifest request must declare natford-aerial-processing.v1.1",
      });
    }
  });

export type ProcessingRequest = z.infer<typeof processingRequestSchema>;
export type ProcessingRequestImagery = z.infer<typeof processingImagerySchema>;
export type PhotoManifestPhoto = z.infer<typeof photoManifestPhotoSchema>;

export const processingArtifactSchema = z
  .object({
    kind: z.enum(PROCESSING_ARTIFACT_KINDS),
    downloadUrl: z.string().url(),
    expiresAt: z.string().datetime({ offset: true }),
    sizeBytes: z.number().int().min(0).optional(),
    contentType: z.string().optional(),
    // v1.1 optional georeferencing, reported by the worker from the artifact
    // file's own GeoTIFF tags. ABSENT means the worker did not report it — the
    // consumer must refuse to place the artifact on a map, never infer.
    boundsWgs84: z
      .tuple([
        z.number().min(-180).max(180),
        z.number().min(-90).max(90),
        z.number().min(-180).max(180),
        z.number().min(-90).max(90),
      ])
      .optional(),
    crs: z.string().min(1).max(64).optional(),
    pixelSizeM: z.number().positive().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.boundsWgs84) {
      const [west, south, east, north] = value.boundsWgs84;
      if (!(west < east && south < north)) {
        ctx.addIssue({
          code: "custom",
          path: ["boundsWgs84"],
          message:
            "boundsWgs84 must open the right way: [west, south, east, north] with west < east and south < north",
        });
      }
    }
  });

export type ProcessingArtifact = z.infer<typeof processingArtifactSchema>;

export const processingCallbackSchema = z
  .object({
    // Either version: a v1 worker keeps sending v1 unchanged, and OpenPlan's
    // own worker echoes the version the request declared.
    schemaVersion: z.enum(CONTRACT_SCHEMA_VERSIONS),
    requestId: z.string(),
    callbackId: z.string().min(8),
    jobReference: z.string(),
    status: z.enum(PROCESSING_CALLBACK_STATUSES),
    occurredAt: z.string().datetime({ offset: true }),
    progress: z.number().min(0).max(100).optional(),
    message: z.string().max(2048).optional(),
    artifacts: z.array(processingArtifactSchema).optional(),
    // Opaque pass-through: schema owned by the platform.
    benchmarkSummary: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "succeeded" && value.artifacts === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: "artifacts is required when status is 'succeeded'",
      });
    }
  });

export type ProcessingCallback = z.infer<typeof processingCallbackSchema>;

export type BuildProcessingRequestImageryInput =
  | {
      type: "zip_url";
      url: string;
      imageCount?: number | null;
      sizeBytes?: number | null;
    }
  | {
      type: "photo_manifest";
      photos: Array<{
        url: string;
        filename: string;
        sizeBytes?: number | null;
        checksumSha256?: string | null;
      }>;
      totalSizeBytes?: number | null;
    };

export type BuildProcessingRequestInput = {
  requestId: string;
  callbackUrl: string;
  missionId: string;
  workspaceId: string;
  projectId?: string | null;
  missionTitle: string;
  imagery: BuildProcessingRequestImageryInput;
  presetId?: ProcessingPresetId;
  notes?: string | null;
};

/**
 * Assemble a ProcessingRequest for the worker and validate it against the
 * contract before it goes on the wire. Throws ZodError if the inputs cannot
 * form a contract-conformant payload.
 *
 * The schemaVersion is DERIVED from the imagery type — zip_url dispatches as
 * v1 (byte-identical to what the external worker has always received),
 * photo_manifest as v1.1 — so no caller can pair them wrongly. For a manifest,
 * imageCount is computed from photos.length for the same reason.
 */
export function buildProcessingRequest(input: BuildProcessingRequestInput): ProcessingRequest {
  const missionTitle = input.missionTitle.trim().slice(0, 256) || "Aerial mission";

  const imagery =
    input.imagery.type === "zip_url"
      ? {
          type: "zip_url" as const,
          url: input.imagery.url,
          ...(input.imagery.imageCount ? { imageCount: input.imagery.imageCount } : {}),
          ...(input.imagery.sizeBytes ? { sizeBytes: input.imagery.sizeBytes } : {}),
        }
      : {
          type: "photo_manifest" as const,
          photos: input.imagery.photos.map((photo) => ({
            url: photo.url,
            filename: photo.filename,
            ...(typeof photo.sizeBytes === "number" ? { sizeBytes: photo.sizeBytes } : {}),
            ...(photo.checksumSha256 ? { checksumSha256: photo.checksumSha256 } : {}),
          })),
          imageCount: input.imagery.photos.length,
          ...(typeof input.imagery.totalSizeBytes === "number"
            ? { totalSizeBytes: input.imagery.totalSizeBytes }
            : {}),
        };

  return processingRequestSchema.parse({
    schemaVersion:
      imagery.type === "zip_url" ? CONTRACT_SCHEMA_VERSION : CONTRACT_SCHEMA_VERSION_V1_1,
    requestId: input.requestId,
    callbackUrl: input.callbackUrl,
    externalRef: {
      system: "openplan",
      missionId: input.missionId,
      workspaceId: input.workspaceId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
    },
    missionTitle,
    imagery,
    presetId: input.presetId ?? "balanced",
    ...(input.notes?.trim() ? { notes: input.notes.trim().slice(0, 2048) } : {}),
  });
}

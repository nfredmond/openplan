import { z } from "zod";

/**
 * TypeScript/zod mirror of schemas/aerial_processing_contract.schema.json
 * (natford-aerial-processing.v1) — the service contract between OpenPlan and
 * the Aerial Intel Platform acting as its ODM processing worker.
 *
 * The JSON schema is the single source of truth and is committed identically
 * to both repositories; keep this module in lockstep with it and bump the
 * schema version for any breaking change.
 */

export const CONTRACT_SCHEMA_VERSION = "natford-aerial-processing.v1" as const;

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

export const processingImagerySchema = z
  .object({
    type: z.literal("zip_url"),
    url: z.string().url(),
    imageCount: z.number().int().min(1).optional(),
    sizeBytes: z.number().int().min(1).optional(),
  })
  .strict();

export const processingRequestSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
    requestId: z.string().min(8).max(128),
    callbackUrl: z.string().url(),
    externalRef: processingExternalRefSchema,
    missionTitle: z.string().min(1).max(256),
    imagery: processingImagerySchema,
    presetId: z.enum(PROCESSING_PRESET_IDS).optional(),
    notes: z.string().max(2048).optional(),
  })
  .strict();

export type ProcessingRequest = z.infer<typeof processingRequestSchema>;

export const processingArtifactSchema = z
  .object({
    kind: z.enum(PROCESSING_ARTIFACT_KINDS),
    downloadUrl: z.string().url(),
    expiresAt: z.string().datetime({ offset: true }),
    sizeBytes: z.number().int().min(0).optional(),
    contentType: z.string().optional(),
  })
  .strict();

export type ProcessingArtifact = z.infer<typeof processingArtifactSchema>;

export const processingCallbackSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
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

export type BuildProcessingRequestInput = {
  requestId: string;
  callbackUrl: string;
  missionId: string;
  workspaceId: string;
  projectId?: string | null;
  missionTitle: string;
  imageryZipUrl: string;
  imageCount?: number | null;
  sizeBytes?: number | null;
  presetId?: ProcessingPresetId;
  notes?: string | null;
};

/**
 * Assemble a ProcessingRequest for the worker and validate it against the
 * contract before it goes on the wire.  Throws ZodError if the inputs cannot
 * form a contract-conformant payload.
 */
export function buildProcessingRequest(input: BuildProcessingRequestInput): ProcessingRequest {
  const missionTitle = input.missionTitle.trim().slice(0, 256) || "Aerial mission";

  return processingRequestSchema.parse({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    requestId: input.requestId,
    callbackUrl: input.callbackUrl,
    externalRef: {
      system: "openplan",
      missionId: input.missionId,
      workspaceId: input.workspaceId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
    },
    missionTitle,
    imagery: {
      type: "zip_url",
      url: input.imageryZipUrl,
      ...(input.imageCount ? { imageCount: input.imageCount } : {}),
      ...(input.sizeBytes ? { sizeBytes: input.sizeBytes } : {}),
    },
    presetId: input.presetId ?? "balanced",
    ...(input.notes?.trim() ? { notes: input.notes.trim().slice(0, 2048) } : {}),
  });
}

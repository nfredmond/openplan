import { z } from "zod";
import { countyOnrampManifestSchema, countyRunEnqueueStatusSchema, countyRunStageSchema } from "@/lib/models/county-onramp";
import { countyOnrampWorkerPayloadSchema } from "@/lib/api/county-onramp-worker";

export const countyRuntimeOptionsSchema = z.object({
  keepProject: z.boolean().optional(),
  force: z.boolean().optional(),
  overallDemandScalar: z.number().nullable().optional(),
  externalDemandScalar: z.number().nullable().optional(),
  hbwScalar: z.number().nullable().optional(),
  hboScalar: z.number().nullable().optional(),
  nhbScalar: z.number().nullable().optional(),
  activitysimContainerImage: z.string().min(1).nullable().optional(),
  containerEngineCli: z.string().min(1).nullable().optional(),
  activitysimContainerCliTemplate: z.string().min(1).nullable().optional(),
  containerNetworkMode: z.string().min(1).nullable().optional(),
});

export const createCountyRunRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  geographyType: z.literal("county_fips"),
  geographyId: z.string().min(1),
  geographyLabel: z.string().min(1).max(160),
  runName: z.string().min(1).max(160),
  countyPrefix: z.string().min(1).max(32).optional(),
  runtimeOptions: countyRuntimeOptionsSchema.default({}),
});

export const createCountyRunResponseSchema = z.object({
  countyRunId: z.string().uuid(),
  stage: countyRunStageSchema,
  runName: z.string().min(1),
  workerPayload: countyOnrampWorkerPayloadSchema.optional(),
});

export const countyRunListItemSchema = z.object({
  id: z.string().uuid(),
  geographyLabel: z.string().min(1),
  runName: z.string().min(1),
  stage: countyRunStageSchema,
  statusLabel: z.string().nullable().optional(),
  enqueueStatus: countyRunEnqueueStatusSchema.optional(),
  lastEnqueuedAt: z.string().nullable().optional(),
  runtimePresetLabel: z.string().nullable().optional(),
  behavioralPipelineStatus: z.string().nullable().optional(),
  behavioralRuntimeStatus: z.string().nullable().optional(),
  behavioralRuntimeMode: z.string().nullable().optional(),
  behavioralEvidenceReady: z.boolean().optional(),
  behavioralComparisonReady: z.boolean().optional(),
  behavioralEvidenceStatusLabel: z.string().nullable().optional(),
  behavioralComparisonStatusLabel: z.string().nullable().optional(),
  artifactAvailabilityLabels: z.array(z.string()).optional(),
  updatedAt: z.string(),
});

export const countyRunListResponseSchema = z.object({
  items: z.array(countyRunListItemSchema),
});

export const countyRunArtifactSchema = z.object({
  artifactType: z.string().min(1),
  path: z.string().min(1),
});

export const countyRunDetailResponseSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid().optional(),
  geographyType: z.string().min(1),
  geographyId: z.string().min(1),
  geographyLabel: z.string().min(1),
  runName: z.string().min(1),
  stage: countyRunStageSchema,
  statusLabel: z.string().nullable().optional(),
  enqueueStatus: countyRunEnqueueStatusSchema.optional(),
  lastEnqueuedAt: z.string().nullable().optional(),
  runtimePresetLabel: z.string().nullable().optional(),
  workerPayload: countyOnrampWorkerPayloadSchema.nullable().optional(),
  manifest: countyOnrampManifestSchema.nullable(),
  artifacts: z.array(countyRunArtifactSchema),
  validationSummary: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const enqueueCountyRunResponseSchema = z.object({
  countyRunId: z.string().uuid(),
  status: z.literal("queued_stub"),
  deliveryMode: z.enum(["prepared", "submitted"]),
  workerPayload: countyOnrampWorkerPayloadSchema,
});

export const ingestCountyRunManifestRequestSchema = z.object({
  jobId: z.string().uuid().optional(),
  status: z.enum(["completed", "failed"]).default("completed"),
  manifest: countyOnrampManifestSchema.optional(),
  error: z
    .object({
      message: z.string().min(1),
      kind: z.string().min(1).optional(),
      details: z.string().optional(),
    })
    .optional(),
}).superRefine((value, ctx) => {
  if (value.status === "completed" && !value.manifest) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "manifest is required when status=completed",
      path: ["manifest"],
    });
  }
  if (value.status === "failed" && !value.error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "error is required when status=failed",
      path: ["error"],
    });
  }
});

export type CountyRuntimeOptions = z.infer<typeof countyRuntimeOptionsSchema>;
export type CreateCountyRunRequest = z.infer<typeof createCountyRunRequestSchema>;
export type CreateCountyRunResponse = z.infer<typeof createCountyRunResponseSchema>;
export type CountyRunListItem = z.infer<typeof countyRunListItemSchema>;
export type CountyRunListResponse = z.infer<typeof countyRunListResponseSchema>;
export type CountyRunArtifact = z.infer<typeof countyRunArtifactSchema>;
export type CountyRunDetailResponse = z.infer<typeof countyRunDetailResponseSchema>;
export type EnqueueCountyRunResponse = z.infer<typeof enqueueCountyRunResponseSchema>;
export type IngestCountyRunManifestRequest = z.infer<typeof ingestCountyRunManifestRequestSchema>;

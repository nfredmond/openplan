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
  activitysimContainerImage: z.string().min(1).optional(),
  containerEngineCli: z.string().min(1).optional(),
  activitysimContainerCliTemplate: z.string().min(1).optional(),
  containerNetworkMode: z.string().min(1).optional(),
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
  updatedAt: z.string(),
});

export const countyRunListResponseSchema = z.object({
  items: z.array(countyRunListItemSchema),
});

export const countyRunArtifactSchema = z.object({
  artifactType: z.string().min(1),
  path: z.string().min(1),
});

export const countyRunModelingEvidenceSchema = z.object({
  claimDecision: z
    .object({
      track: z.enum(["assignment", "behavioral_demand", "multimodal_accessibility", "shared"]),
      claimStatus: z.enum(["claim_grade_passed", "screening_grade", "prototype_only"]),
      statusReason: z.string().min(1),
      reasons: z.array(z.string()),
      validationSummary: z.record(z.string(), z.unknown()),
      decidedAt: z.string().nullable(),
    })
    .nullable(),
  reportLanguage: z.string().nullable(),
  sourceManifests: z.array(
    z.object({
      id: z.string().uuid(),
      sourceKey: z.string().min(1),
      sourceKind: z.string().min(1),
      sourceLabel: z.string().min(1),
      sourceUrl: z.string().nullable(),
      sourceVintage: z.string().nullable(),
      geographyId: z.string().nullable(),
      geographyLabel: z.string().nullable(),
      licenseNote: z.string().nullable(),
      citationText: z.string().min(1),
    })
  ),
  validationResults: z.array(
    z.object({
      id: z.string().uuid(),
      track: z.enum(["assignment", "behavioral_demand", "multimodal_accessibility", "shared"]),
      metricKey: z.string().min(1),
      metricLabel: z.string().min(1),
      observedValue: z.number().nullable(),
      thresholdValue: z.number().nullable(),
      thresholdMaxValue: z.number().nullable(),
      thresholdComparator: z.enum(["lte", "gte", "between", "eq", "exists", "manual"]),
      status: z.enum(["pass", "warn", "fail"]),
      blocksClaimGrade: z.boolean(),
      detail: z.string().min(1),
      sourceManifestId: z.string().uuid().nullable(),
      evaluatedAt: z.string().nullable(),
    })
  ),
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
  workerPayload: countyOnrampWorkerPayloadSchema.nullable().optional(),
  manifest: countyOnrampManifestSchema.nullable(),
  artifacts: z.array(countyRunArtifactSchema),
  validationSummary: z.record(z.string(), z.unknown()).nullable().optional(),
  modelingEvidence: countyRunModelingEvidenceSchema.nullable().optional(),
});

export const enqueueCountyRunResponseSchema = z.object({
  countyRunId: z.string().uuid(),
  status: z.literal("queued_stub"),
  workerPayload: countyOnrampWorkerPayloadSchema,
});

export const countyRunScaffoldResponseSchema = z.object({
  path: z.string().min(1),
  csvContent: z.string().min(1),
});

export const updateCountyRunScaffoldRequestSchema = z.object({
  csvContent: z.string().min(1),
});

export const prepareCountyRunValidationResponseSchema = z.object({
  countyRunId: z.string().uuid(),
  ready: z.boolean(),
  statusLabel: z.string().min(1),
  reasons: z.array(z.string()),
  command: z.string().nullable(),
  automationCommand: z.string().nullable(),
  refreshUrl: z.string().url(),
  callbackAuthMode: z.enum(["session-only", "bearer-env"]),
  runOutputDir: z.string().nullable(),
  countsCsvPath: z.string().nullable(),
  outputDir: z.string().nullable(),
  projectDbPath: z.string().nullable(),
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
export type CountyRunModelingEvidence = z.infer<typeof countyRunModelingEvidenceSchema>;
export type CountyRunDetailResponse = z.infer<typeof countyRunDetailResponseSchema>;
export type EnqueueCountyRunResponse = z.infer<typeof enqueueCountyRunResponseSchema>;
export type CountyRunScaffoldResponse = z.infer<typeof countyRunScaffoldResponseSchema>;
export type UpdateCountyRunScaffoldRequest = z.infer<typeof updateCountyRunScaffoldRequestSchema>;
export type PrepareCountyRunValidationResponse = z.infer<typeof prepareCountyRunValidationResponseSchema>;
export type IngestCountyRunManifestRequest = z.infer<typeof ingestCountyRunManifestRequestSchema>;

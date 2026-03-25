import { z } from "zod";
import type { CreateCountyRunRequest } from "@/lib/api/county-onramp";

export const storedCountyOnrampRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  geographyType: z.literal("county_fips"),
  geographyId: z.string().min(1),
  geographyLabel: z.string().min(1),
  runName: z.string().min(1),
  countyPrefix: z.string().min(1),
  runtimeOptions: z.object({
    keepProject: z.boolean(),
    force: z.boolean(),
    overallDemandScalar: z.number().nullable(),
    externalDemandScalar: z.number().nullable(),
    hbwScalar: z.number().nullable(),
    hboScalar: z.number().nullable(),
    nhbScalar: z.number().nullable(),
  }),
});

export const countyOnrampWorkerPayloadSchema = z.object({
  jobId: z.string().uuid(),
  countyRunId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  runName: z.string().min(1),
  geographyType: z.literal("county_fips"),
  geographyId: z.string().min(1),
  geographyLabel: z.string().min(1),
  countyPrefix: z.string().min(1),
  runtimeOptions: z.object({
    keepProject: z.boolean(),
    force: z.boolean(),
    overallDemandScalar: z.number().nullable(),
    externalDemandScalar: z.number().nullable(),
    hbwScalar: z.number().nullable(),
    hboScalar: z.number().nullable(),
    nhbScalar: z.number().nullable(),
  }),
  artifactTargets: z.object({
    scaffoldCsvPath: z.string().min(1),
    reviewPacketMdPath: z.string().min(1),
    manifestPath: z.string().min(1),
  }),
  callback: z.object({
    manifestIngestUrl: z.string().min(1),
  }),
});

export type StoredCountyOnrampRequest = z.infer<typeof storedCountyOnrampRequestSchema>;
export type CountyOnrampWorkerPayload = z.infer<typeof countyOnrampWorkerPayloadSchema>;

function defaultCountyPrefix(input: CreateCountyRunRequest): string {
  if (input.countyPrefix?.trim()) return input.countyPrefix.trim().toUpperCase();
  const normalized = input.geographyLabel
    .trim()
    .replace(/County,?/gi, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
  const firstToken = normalized.split(/\s+/)[0] || input.geographyId;
  return firstToken.toUpperCase();
}

export function normalizeCountyOnrampRequest(input: CreateCountyRunRequest): StoredCountyOnrampRequest {
  return storedCountyOnrampRequestSchema.parse({
    workspaceId: input.workspaceId,
    geographyType: input.geographyType,
    geographyId: input.geographyId,
    geographyLabel: input.geographyLabel,
    runName: input.runName,
    countyPrefix: defaultCountyPrefix(input),
    runtimeOptions: {
      keepProject: input.runtimeOptions.keepProject ?? true,
      force: input.runtimeOptions.force ?? true,
      overallDemandScalar: input.runtimeOptions.overallDemandScalar ?? null,
      externalDemandScalar: input.runtimeOptions.externalDemandScalar ?? null,
      hbwScalar: input.runtimeOptions.hbwScalar ?? null,
      hboScalar: input.runtimeOptions.hboScalar ?? null,
      nhbScalar: input.runtimeOptions.nhbScalar ?? null,
    },
  });
}

export function buildCountyOnrampWorkerPayloadFromStoredRequest(params: {
  origin: string;
  jobId: string;
  countyRunId: string;
  input: StoredCountyOnrampRequest;
}): CountyOnrampWorkerPayload {
  const { origin, jobId, countyRunId, input } = params;
  const countyPrefix = input.countyPrefix;
  const runSlug = input.runName;
  const artifactBase = input.geographyId.toLowerCase().includes("06061")
    ? "data/pilot-placer-county/validation"
    : `data/pilot-${countyPrefix.toLowerCase()}-county/validation`;

  return countyOnrampWorkerPayloadSchema.parse({
    jobId,
    countyRunId,
    workspaceId: input.workspaceId,
    runName: input.runName,
    geographyType: input.geographyType,
    geographyId: input.geographyId,
    geographyLabel: input.geographyLabel,
    countyPrefix,
    runtimeOptions: input.runtimeOptions,
    artifactTargets: {
      scaffoldCsvPath: `${artifactBase}/${countyPrefix.toLowerCase()}_priority_count_scaffold_auto.csv`,
      reviewPacketMdPath: `docs/ops/${runSlug}-validation-review-packet.md`,
      manifestPath: `tmp/county-onramp/${runSlug}.manifest.json`,
    },
    callback: {
      manifestIngestUrl: `${origin.replace(/\/$/, "")}/api/county-runs/${countyRunId}/manifest`,
    },
  });
}

export function buildCountyOnrampWorkerPayload(params: {
  origin: string;
  jobId: string;
  countyRunId: string;
  input: CreateCountyRunRequest;
}): CountyOnrampWorkerPayload {
  return buildCountyOnrampWorkerPayloadFromStoredRequest({
    origin: params.origin,
    jobId: params.jobId,
    countyRunId: params.countyRunId,
    input: normalizeCountyOnrampRequest(params.input),
  });
}

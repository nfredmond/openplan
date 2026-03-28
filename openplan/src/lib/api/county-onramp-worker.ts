import { z } from "zod";
import type { CreateCountyRunRequest } from "@/lib/api/county-onramp";
import { buildCountyPrefix, buildCountySlug } from "@/lib/geographies/county-utils";

const countyOnrampRuntimeOptionsSchema = z.object({
  keepProject: z.boolean(),
  force: z.boolean(),
  overallDemandScalar: z.number().nullable(),
  externalDemandScalar: z.number().nullable(),
  hbwScalar: z.number().nullable(),
  hboScalar: z.number().nullable(),
  nhbScalar: z.number().nullable(),
  activitysimContainerImage: z.string().min(1).nullable().optional(),
  containerEngineCli: z.string().min(1).nullable().optional(),
  activitysimContainerCliTemplate: z.string().min(1).nullable().optional(),
  containerNetworkMode: z.string().min(1).nullable().optional(),
});

export const storedCountyOnrampRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  geographyType: z.literal("county_fips"),
  geographyId: z.string().min(1),
  geographyLabel: z.string().min(1),
  runName: z.string().min(1),
  countyPrefix: z.string().min(1),
  runtimeOptions: countyOnrampRuntimeOptionsSchema,
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
  runtimeOptions: countyOnrampRuntimeOptionsSchema,
  artifactTargets: z.object({
    scaffoldCsvPath: z.string().min(1),
    reviewPacketMdPath: z.string().min(1),
    manifestPath: z.string().min(1),
  }),
  callback: z.object({
    manifestIngestUrl: z.string().min(1),
    bearerToken: z.string().min(1).optional(),
  }),
});

export type StoredCountyOnrampRequest = z.infer<typeof storedCountyOnrampRequestSchema>;
export type CountyOnrampWorkerPayload = z.infer<typeof countyOnrampWorkerPayloadSchema>;

function getConfiguredCountyWorkerCallbackToken(): string | undefined {
  const token = process.env.OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN?.trim();
  return token ? token : undefined;
}

function defaultCountyPrefix(input: CreateCountyRunRequest): string {
  if (input.countyPrefix?.trim()) return input.countyPrefix.trim().toUpperCase();
  return buildCountyPrefix(input.geographyLabel, input.geographyId);
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
      activitysimContainerImage: input.runtimeOptions.activitysimContainerImage?.trim() || null,
      containerEngineCli: input.runtimeOptions.containerEngineCli?.trim() || null,
      activitysimContainerCliTemplate: input.runtimeOptions.activitysimContainerCliTemplate?.trim() || null,
      containerNetworkMode: input.runtimeOptions.containerNetworkMode?.trim() || null,
    },
  });
}

export function buildCountyOnrampWorkerPayloadFromStoredRequest(params: {
  origin: string;
  jobId: string;
  countyRunId: string;
  input: StoredCountyOnrampRequest;
  callbackBearerToken?: string;
}): CountyOnrampWorkerPayload {
  const { origin, jobId, countyRunId, input } = params;
  const countyPrefix = input.countyPrefix;
  const runSlug = input.runName;
  const countySlug = buildCountySlug(input.geographyLabel, input.geographyId);
  const artifactBase = `data/county-runs/${countySlug}/validation`;
  const callbackBearerToken = params.callbackBearerToken ?? getConfiguredCountyWorkerCallbackToken();

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
      scaffoldCsvPath: `${artifactBase}/${countySlug}-priority-count-scaffold-auto.csv`,
      reviewPacketMdPath: `docs/ops/${countySlug}-validation-review-packet.md`,
      manifestPath: `tmp/county-onramp/${countySlug}/${runSlug}.manifest.json`,
    },
    callback: {
      manifestIngestUrl: `${origin.replace(/\/$/, "")}/api/county-runs/${countyRunId}/manifest`,
      ...(callbackBearerToken ? { bearerToken: callbackBearerToken } : {}),
    },
  });
}

export function buildCountyOnrampWorkerPayload(params: {
  origin: string;
  jobId: string;
  countyRunId: string;
  input: CreateCountyRunRequest;
  callbackBearerToken?: string;
}): CountyOnrampWorkerPayload {
  return buildCountyOnrampWorkerPayloadFromStoredRequest({
    origin: params.origin,
    jobId: params.jobId,
    countyRunId: params.countyRunId,
    input: normalizeCountyOnrampRequest(params.input),
    callbackBearerToken: params.callbackBearerToken,
  });
}

export function sanitizeCountyOnrampWorkerPayload(
  payload: CountyOnrampWorkerPayload
): CountyOnrampWorkerPayload {
  return countyOnrampWorkerPayloadSchema.parse({
    ...payload,
    callback: {
      manifestIngestUrl: payload.callback.manifestIngestUrl,
    },
  });
}

import { z } from "zod";
import type { CreateCountyRunRequest } from "@/lib/api/county-onramp";

export const storedCountyOnrampRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  geographyType: z.enum(["county_fips", "place"]),
  geographyId: z.string().min(1),
  geographyLabel: z.string().min(1),
  runName: z.string().min(1),
  countyPrefix: z.string().min(1),
  // The polygon the planner actually chose, for a study area that has no FIPS
  // code to look one up from. Carried rather than re-resolved in the worker on
  // purpose: the app already resolved it through the one geography front door,
  // and a second resolution could hand the model a different area than the
  // person saw on screen.
  boundaryGeojson: z.unknown().nullable().optional(),
  runtimeOptions: z.object({
    keepProject: z.boolean(),
    force: z.boolean(),
    // Opt-in: fit the model to this study area's published traffic counts.
    // Comparing against them happens either way — this decides whether the
    // model is also ADJUSTED toward them, which is a different, disclosed
    // claim and never a default.
    calibrateToCounts: z.boolean().default(false),
    overallDemandScalar: z.number().nullable(),
    externalDemandScalar: z.number().nullable(),
    hbwScalar: z.number().nullable(),
    hboScalar: z.number().nullable(),
    nhbScalar: z.number().nullable(),
    activitysimContainerImage: z.string().min(1).optional(),
    containerEngineCli: z.string().min(1).optional(),
    activitysimContainerCliTemplate: z.string().min(1).optional(),
    containerNetworkMode: z.string().min(1).optional(),
  }),
});

const countyOnrampWorkerPayloadBaseSchema = z.object({
  jobId: z.string().uuid(),
  countyRunId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  runName: z.string().min(1),
  geographyType: z.enum(["county_fips", "place"]),
  geographyId: z.string().min(1),
  geographyLabel: z.string().min(1),
  countyPrefix: z.string().min(1),
  // The polygon the planner actually chose, for a study area that has no FIPS
  // code to look one up from. Carried rather than re-resolved in the worker on
  // purpose: the app already resolved it through the one geography front door,
  // and a second resolution could hand the model a different area than the
  // person saw on screen.
  boundaryGeojson: z.unknown().nullable().optional(),
  runtimeOptions: z.object({
    keepProject: z.boolean(),
    force: z.boolean(),
    // Opt-in: fit the model to this study area's published traffic counts.
    // Comparing against them happens either way — this decides whether the
    // model is also ADJUSTED toward them, which is a different, disclosed
    // claim and never a default.
    calibrateToCounts: z.boolean().default(false),
    overallDemandScalar: z.number().nullable(),
    externalDemandScalar: z.number().nullable(),
    hbwScalar: z.number().nullable(),
    hboScalar: z.number().nullable(),
    nhbScalar: z.number().nullable(),
    activitysimContainerImage: z.string().min(1).optional(),
    containerEngineCli: z.string().min(1).optional(),
    activitysimContainerCliTemplate: z.string().min(1).optional(),
    containerNetworkMode: z.string().min(1).optional(),
  }),
  artifactTargets: z.object({
    attemptDirectory: z.string().min(1),
    scaffoldCsvPath: z.string().min(1),
    reviewPacketMdPath: z.string().min(1),
    manifestPath: z.string().min(1),
  }),
});

export const countyOnrampWorkerPayloadSchema = countyOnrampWorkerPayloadBaseSchema.extend({
  callback: z.object({
    manifestIngestUrl: z.string().min(1),
    bearerToken: z.string().min(1).optional(),
  }),
});

export const sanitizedCountyOnrampWorkerPayloadSchema = countyOnrampWorkerPayloadBaseSchema.extend({
  callback: z.object({
    manifestIngestUrl: z.string().min(1),
    hasBearerToken: z.boolean(),
  }),
});

export type StoredCountyOnrampRequest = z.infer<typeof storedCountyOnrampRequestSchema>;
export type CountyOnrampWorkerPayload = z.infer<typeof countyOnrampWorkerPayloadSchema>;
export type SanitizedCountyOnrampWorkerPayload = z.infer<typeof sanitizedCountyOnrampWorkerPayloadSchema>;

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
    boundaryGeojson: input.boundaryGeojson ?? null,
    countyPrefix: defaultCountyPrefix(input),
    runtimeOptions: {
      keepProject: input.runtimeOptions.keepProject ?? true,
      force: input.runtimeOptions.force ?? true,
      // Defaults to FALSE, and that is the product decision, not an oversight:
      // the uncalibrated screening model is what OpenPlan ships, and a
      // calibrated run is a claim someone chooses to make.
      calibrateToCounts: input.runtimeOptions.calibrateToCounts ?? false,
      overallDemandScalar: input.runtimeOptions.overallDemandScalar ?? null,
      externalDemandScalar: input.runtimeOptions.externalDemandScalar ?? null,
      hbwScalar: input.runtimeOptions.hbwScalar ?? null,
      hboScalar: input.runtimeOptions.hboScalar ?? null,
      nhbScalar: input.runtimeOptions.nhbScalar ?? null,
      activitysimContainerImage: input.runtimeOptions.activitysimContainerImage,
      containerEngineCli: input.runtimeOptions.containerEngineCli,
      activitysimContainerCliTemplate: input.runtimeOptions.activitysimContainerCliTemplate,
      containerNetworkMode: input.runtimeOptions.containerNetworkMode,
    },
  });
}

export const COUNTY_ONRAMP_CALLBACK_ORIGIN_ENV = "OPENPLAN_COUNTY_ONRAMP_CALLBACK_ORIGIN";

/**
 * Where the worker should post a finished run back to.
 *
 * Defaults to the origin of the request that launched the run, which is right
 * whenever the worker can reach OpenPlan at the same address a browser does.
 * It cannot when the worker is in a container on a bridge network: OpenPlan
 * sees itself at `http://localhost:3000`, and inside that container
 * `localhost` is the container, where nothing is listening. The model then runs
 * correctly for minutes and the result goes nowhere — the failure is entirely
 * silent from OpenPlan's side, because nothing ever arrives to fail.
 *
 * So an operator can name the address the WORKER should use — typically
 * `http://host.docker.internal:3000` on Docker Desktop, or the deployment's
 * public URL on a server. Same posture and same fallback as
 * `OPENPLAN_KB_OCR_CALLBACK_URL` in the OCR lane; deliberately not a second
 * idea about the same problem.
 *
 * Resolved in ONE place so that the callback URL a planner is shown on the run
 * page is the callback URL the worker was actually handed.
 */
export function resolveCountyOnrampCallbackOrigin(
  requestOrigin: string,
  // A plain lookup rather than NodeJS.ProcessEnv: this reads ONE key, and
  // demanding the full environment shape means a caller — including a test —
  // has to fabricate variables it does not care about to ask a question about
  // one it does.
  env: Record<string, string | undefined> = process.env
): string {
  const configured = env[COUNTY_ONRAMP_CALLBACK_ORIGIN_ENV]?.trim();
  return (configured || requestOrigin).replace(/\/+$/, "");
}

export function buildCountyOnrampWorkerPayloadFromStoredRequest(params: {
  origin: string;
  jobId: string;
  countyRunId: string;
  input: StoredCountyOnrampRequest;
}): CountyOnrampWorkerPayload {
  const { jobId, countyRunId, input } = params;
  const origin = resolveCountyOnrampCallbackOrigin(params.origin);
  const callbackBearerToken = process.env.OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN?.trim();
  const countyPrefix = input.countyPrefix;
  // Every accepted attempt owns one directory. A retry of the same county run
  // must not overwrite or ingest the files from an earlier job.
  const artifactBase = `data/screening-runs/${countyRunId}/${jobId}`;

  return countyOnrampWorkerPayloadSchema.parse({
    jobId,
    countyRunId,
    workspaceId: input.workspaceId,
    runName: input.runName,
    geographyType: input.geographyType,
    geographyId: input.geographyId,
    geographyLabel: input.geographyLabel,
    boundaryGeojson: input.boundaryGeojson ?? null,
    countyPrefix,
    runtimeOptions: input.runtimeOptions,
    artifactTargets: {
      attemptDirectory: artifactBase,
      scaffoldCsvPath: `${artifactBase}/validation-scaffold.csv`,
      reviewPacketMdPath: `${artifactBase}/validation-review-packet.md`,
      manifestPath: `${artifactBase}/manifest.json`,
    },
    callback: {
      manifestIngestUrl: `${origin}/api/county-runs/${countyRunId}/manifest`,
      ...(callbackBearerToken ? { bearerToken: callbackBearerToken } : {}),
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

export function sanitizeCountyOnrampWorkerPayload(
  payload: CountyOnrampWorkerPayload
): SanitizedCountyOnrampWorkerPayload {
  return sanitizedCountyOnrampWorkerPayloadSchema.parse({
    ...payload,
    callback: {
      manifestIngestUrl: payload.callback.manifestIngestUrl,
      hasBearerToken: Boolean(payload.callback.bearerToken),
    },
  });
}

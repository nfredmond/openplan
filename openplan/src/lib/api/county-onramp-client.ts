import {
  countyRunDetailResponseSchema,
  countyRunListResponseSchema,
  createCountyRunRequestSchema,
  createCountyRunResponseSchema,
  enqueueCountyRunResponseSchema,
  ingestCountyRunManifestRequestSchema,
  countyRunScaffoldResponseSchema,
  prepareCountyRunValidationResponseSchema,
  type CountyRunDetailResponse,
  type CountyRunScaffoldResponse,
  type CountyRunListResponse,
  type CreateCountyRunRequest,
  type CreateCountyRunResponse,
  type EnqueueCountyRunResponse,
  type IngestCountyRunManifestRequest,
  type PrepareCountyRunValidationResponse,
} from "@/lib/api/county-onramp";

async function parseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export async function listCountyRuns(params: {
  workspaceId: string;
  stage?: string;
  geographyId?: string;
  limit?: number;
  fetcher?: typeof fetch;
}): Promise<CountyRunListResponse> {
  const fetcher = params.fetcher ?? fetch;
  const search = new URLSearchParams({ workspaceId: params.workspaceId });
  if (params.stage) search.set("stage", params.stage);
  if (params.geographyId) search.set("geographyId", params.geographyId);
  if (typeof params.limit === "number") search.set("limit", String(params.limit));

  const response = await fetcher(`/api/county-runs?${search.toString()}`, {
    method: "GET",
    headers: { accept: "application/json" },
  });

  return countyRunListResponseSchema.parse(await parseJson(response));
}

export async function createCountyRun(
  input: CreateCountyRunRequest,
  fetcher: typeof fetch = fetch
): Promise<CreateCountyRunResponse> {
  const body = createCountyRunRequestSchema.parse(input);
  const response = await fetcher("/api/county-runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  return createCountyRunResponseSchema.parse(await parseJson(response));
}

export async function getCountyRunDetail(
  countyRunId: string,
  fetcher: typeof fetch = fetch
): Promise<CountyRunDetailResponse> {
  const response = await fetcher(`/api/county-runs/${countyRunId}`, {
    method: "GET",
    headers: { accept: "application/json" },
  });

  return countyRunDetailResponseSchema.parse(await parseJson(response));
}

export async function enqueueCountyRun(
  countyRunId: string,
  fetcher: typeof fetch = fetch
): Promise<EnqueueCountyRunResponse> {
  const response = await fetcher(`/api/county-runs/${countyRunId}/enqueue`, {
    method: "POST",
    headers: { accept: "application/json" },
  });

  return enqueueCountyRunResponseSchema.parse(await parseJson(response));
}

export async function ingestCountyRunManifest(
  countyRunId: string,
  input: IngestCountyRunManifestRequest,
  fetcher: typeof fetch = fetch
): Promise<CountyRunDetailResponse | { countyRunId: string; status: "failed" }> {
  const body = ingestCountyRunManifestRequestSchema.parse(input);
  const response = await fetcher(`/api/county-runs/${countyRunId}/manifest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await parseJson<unknown>(response);
  if (body.status === "failed") {
    return payload as { countyRunId: string; status: "failed" };
  }
  return countyRunDetailResponseSchema.parse(payload);
}

/**
 * Ask whether this county run can be validated against observed counts yet,
 * and — when it can — what to run.
 *
 * The sixth wrapper beside list/create/get/enqueue/ingest, and the one that was
 * missing: `/api/county-runs/[id]/validate` had been built, with the readiness
 * reasons and the assembled validator command in it, and nothing called it. The
 * step it covers is the one between "a manifest was ingested" and "this run is
 * validated screening", which is exactly where an operator gets stuck.
 *
 * It is a POST that writes nothing. The verb is not about mutation — the route
 * probes the filesystem for the run directory, the counts CSV and the project
 * database, and the answer is specific to this deployment's disk at this moment.
 */
export async function prepareCountyRunValidation(
  countyRunId: string,
  fetcher: typeof fetch = fetch
): Promise<PrepareCountyRunValidationResponse> {
  const response = await fetcher(`/api/county-runs/${countyRunId}/validate`, {
    method: "POST",
    headers: { accept: "application/json" },
  });

  return prepareCountyRunValidationResponseSchema.parse(await parseJson(response));
}

/**
 * Load the observed-counts scaffold for editing.
 *
 * NOT called on mount, matching `CountyRunValidationPrep`: this reads the
 * deployment's own filesystem when the manifest carries no inline copy, so
 * firing it on every render would put a file read behind runs nowhere near this
 * stage and would report a stale answer as a current one.
 */
export async function getCountyRunScaffold(
  countyRunId: string,
  fetcher: typeof fetch = fetch
): Promise<CountyRunScaffoldResponse> {
  const response = await fetcher(`/api/county-runs/${countyRunId}/scaffold`, {
    headers: { accept: "application/json" },
  });

  return countyRunScaffoldResponseSchema.parse(await parseJson(response));
}

/**
 * Save edited observed counts back over the scaffold.
 *
 * Sends the WHOLE file, which is what the route replaces — the counts a planner
 * did not touch have to arrive unchanged, so the caller serializes the same
 * table it was given rather than a diff.
 */
export async function saveCountyRunScaffold(
  countyRunId: string,
  csvContent: string,
  fetcher: typeof fetch = fetch
): Promise<void> {
  const response = await fetcher(`/api/county-runs/${countyRunId}/scaffold`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ csvContent }),
  });

  await parseJson(response);
}

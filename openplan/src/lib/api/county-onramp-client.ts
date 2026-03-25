import {
  countyRunDetailResponseSchema,
  countyRunListResponseSchema,
  createCountyRunRequestSchema,
  createCountyRunResponseSchema,
  enqueueCountyRunResponseSchema,
  ingestCountyRunManifestRequestSchema,
  type CountyRunDetailResponse,
  type CountyRunListResponse,
  type CreateCountyRunRequest,
  type CreateCountyRunResponse,
  type EnqueueCountyRunResponse,
  type IngestCountyRunManifestRequest,
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

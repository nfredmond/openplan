import {
  countyGeographySearchResponseSchema,
  type CountyGeographySearchResponse,
} from "@/lib/api/county-geographies";

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

export async function searchCountyGeographies(params: {
  query: string;
  limit?: number;
  fetcher?: typeof fetch;
}): Promise<CountyGeographySearchResponse> {
  const fetcher = params.fetcher ?? fetch;
  const search = new URLSearchParams({ q: params.query.trim() });
  if (typeof params.limit === "number") search.set("limit", String(params.limit));

  const response = await fetcher(`/api/geographies/counties?${search.toString()}`, {
    method: "GET",
    headers: { accept: "application/json" },
  });

  return countyGeographySearchResponseSchema.parse(await parseJson(response));
}

import { isCorridorLineGeoJson } from "@/lib/cartographic/corridor-line-geojson";
import type { SafetyRoadContextFeature } from "@/lib/safety/road-context";

const TIGERWEB_ROOT =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation_LargeScale/MapServer";
const ROAD_LAYER_IDS = [0, 1, 2] as const;
const CACHE_SECONDS = 30 * 24 * 60 * 60;
const POINT_BUFFER_DEGREES = 0.003;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type TigerGeoJsonFeature = {
  geometry?: unknown;
  properties?: { NAME?: unknown; OID?: unknown; OBJECTID?: unknown };
};

type TigerGeoJsonResponse = {
  features?: TigerGeoJsonFeature[];
  error?: { message?: unknown };
};

export type UsRoadContextLoad = {
  roads: SafetyRoadContextFeature[];
  coverageLimit: string;
  sourceVintage: string | null;
};

/** A downstream packet may use source roads only after its project cache write succeeds. */
export function roadContextForFrozenPacket(
  roads: SafetyRoadContextFeature[],
  cacheError: unknown,
): SafetyRoadContextFeature[] {
  return cacheError ? [] : roads;
}

function fetchOptions(): RequestInit & { next: { revalidate: number } } {
  return {
    signal: AbortSignal.timeout(8_000),
    next: { revalidate: CACHE_SECONDS },
  };
}

function readVintage(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const description = (metadata as { description?: unknown }).description;
  if (typeof description !== "string") return null;
  const match = description.match(/([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  if (!match) return null;
  const stamp = new Date(`${match[1]} ${match[2]}, ${match[3]} UTC`);
  return Number.isNaN(stamp.getTime()) ? null : stamp.toISOString().slice(0, 10);
}

function roadFeatures(
  payload: TigerGeoJsonResponse,
  layerId: number,
  vintage: string,
): SafetyRoadContextFeature[] {
  if (payload.error || !Array.isArray(payload.features)) return [];
  return payload.features.flatMap((feature, featureIndex) => {
    const name = typeof feature.properties?.NAME === "string"
      ? feature.properties.NAME.trim()
      : "";
    if (!name) return [];
    const geometries = feature.geometry && typeof feature.geometry === "object"
      && (feature.geometry as { type?: unknown }).type === "MultiLineString"
      && Array.isArray((feature.geometry as { coordinates?: unknown }).coordinates)
        ? ((feature.geometry as { coordinates: unknown[] }).coordinates).map((coordinates) => ({
            type: "LineString" as const,
            coordinates,
          }))
        : [feature.geometry];
    const sourceFeatureId = String(
      feature.properties?.OID ?? feature.properties?.OBJECTID ?? featureIndex,
    );
    return geometries.flatMap((geometry, partIndex) => {
      if (!isCorridorLineGeoJson(geometry)) return [];
      return [{
        id: `tiger-${layerId}-${sourceFeatureId}-${partIndex}`,
        name,
        geometry,
        sourceId: "us-census-tiger-line-cache" as const,
        sourceLabel: "U.S. Census TIGER/Line roads",
        vintage,
      }];
    });
  });
}

function queryUrl(longitude: number, latitude: number, layerId: number): URL {
  const url = new URL(`${TIGERWEB_ROOT}/${layerId}/query`);
  const envelope = [
    longitude - POINT_BUFFER_DEGREES,
    latitude - POINT_BUFFER_DEGREES,
    longitude + POINT_BUFFER_DEGREES,
    latitude + POINT_BUFFER_DEGREES,
  ];
  url.search = new URLSearchParams({
    where: "NAME IS NOT NULL",
    geometry: envelope.join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "NAME,OID,OBJECTID",
    returnGeometry: "true",
    outSR: "4326",
    resultRecordCount: "25",
    f: "geojson",
  }).toString();
  return url;
}

/**
 * Load named roads only from the official US Census service, with its published
 * vintage. Next's fetch cache retains each small source response for 30 days;
 * a failed or undated source produces no road identity rather than a guess.
 */
export async function loadUsTigerRoadContext(
  points: readonly { longitude: number; latitude: number }[],
  fetcher: FetchLike = fetch,
): Promise<UsRoadContextLoad> {
  const usablePoints = Array.from(new Map(
    points
      .filter((point) => Number.isFinite(point.longitude) && Number.isFinite(point.latitude))
      .map((point) => [`${point.longitude.toFixed(5)},${point.latitude.toFixed(5)}`, point]),
  ).values()).slice(0, 10);
  if (usablePoints.length === 0) {
    return {
      roads: [],
      coverageLimit: "No KSI concentration coordinates were available for a road match.",
      sourceVintage: null,
    };
  }

  try {
    const metadataResponse = await fetcher(`${TIGERWEB_ROOT}/2?f=pjson`, fetchOptions());
    if (!metadataResponse.ok) throw new Error("TIGERweb metadata did not answer");
    const vintage = readVintage(await metadataResponse.json());
    if (!vintage) throw new Error("TIGERweb did not publish a readable vintage");

    const requests = usablePoints.flatMap((point) =>
      ROAD_LAYER_IDS.map(async (layerId) => {
        const response = await fetcher(queryUrl(point.longitude, point.latitude, layerId), fetchOptions());
        if (!response.ok) return [];
        return roadFeatures(await response.json() as TigerGeoJsonResponse, layerId, vintage);
      })
    );
    const roads = (await Promise.all(requests)).flat();
    const deduped = Array.from(new Map(roads.map((road) => [road.id, road])).values());
    return {
      roads: deduped,
      coverageLimit: deduped.length > 0
        ? "Road names are nearest-line matches within 150 meters against cached U.S. Census TIGER/Line road responses. Unnamed roads and roads outside the queried concentration buffers are excluded."
        : "The U.S. Census TIGER/Line road service answered, but returned no named road geometry near these KSI concentrations. Coordinates remain the source location.",
      sourceVintage: vintage,
    };
  } catch {
    return {
      roads: [],
      coverageLimit: "U.S. Census TIGER/Line road context could not be read. Coordinates remain the source location; no road name was inferred.",
      sourceVintage: null,
    };
  }
}

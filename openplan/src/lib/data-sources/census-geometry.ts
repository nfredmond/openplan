import { fetchJsonWithRetry } from "./http";

export type CensusTractOverlayMetrics = {
  geoid: string;
  population: number;
  medianIncome: number | null;
  pctMinority: number;
  pctBelowPoverty: number;
  zeroVehicleHouseholds: number;
  totalHouseholds: number;
  transitCommuters?: number;
  totalCommuters?: number;
};

type BBox = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

type TigerGeoJsonFeature = {
  type: "Feature";
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  properties?: Record<string, unknown>;
};

type TigerGeoJsonResponse = {
  type?: string;
  features?: TigerGeoJsonFeature[];
};

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export async function fetchTractOverlayFeatures(
  bbox: BBox,
  tractMetrics: CensusTractOverlayMetrics[]
): Promise<GeoJSON.Feature[]> {
  if (!tractMetrics.length) {
    return [];
  }

  const tractMetricMap = new Map(tractMetrics.map((tract) => [tract.geoid, tract]));
  const params = new URLSearchParams({
    where: "1=1",
    geometry: `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "GEOID,STATE,COUNTY,TRACT,BASENAME,NAME",
    outSR: "4326",
    returnGeometry: "true",
    f: "geojson",
  });

  const url = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query?${params.toString()}`;

  const data = await fetchJsonWithRetry<TigerGeoJsonResponse>(url, undefined, {
    timeoutMs: 20000,
    retries: 1,
    cacheTtlMs: 30 * 60 * 1000,
    cacheKey: `tiger-tracts:${bbox.minLon.toFixed(3)}:${bbox.minLat.toFixed(3)}:${bbox.maxLon.toFixed(3)}:${bbox.maxLat.toFixed(3)}`,
  }).catch(() => null);

  if (!data?.features?.length) {
    return [];
  }

  const overlays: GeoJSON.Feature[] = [];

  for (const feature of data.features) {
    if (!feature.geometry) {
      continue;
    }

    const geoid = String(feature.properties?.GEOID ?? feature.properties?.geoid ?? "").trim();
    const tract = tractMetricMap.get(geoid);
    if (!tract) {
      continue;
    }

    const zeroVehiclePct = pct(tract.zeroVehicleHouseholds, tract.totalHouseholds);
    const transitCommutePct = pct(tract.transitCommuters ?? 0, tract.totalCommuters ?? 0);
    const isDisadvantaged =
      tract.medianIncome !== null &&
      tract.medianIncome < 50000 &&
      (tract.pctBelowPoverty >= 30 || tract.pctMinority >= 50 || zeroVehiclePct >= 10 || transitCommutePct >= 15);

    overlays.push({
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        kind: "census_tract",
        geoid,
        name: String(feature.properties?.NAME ?? feature.properties?.BASENAME ?? geoid),
        population: tract.population,
        medianIncome: tract.medianIncome,
        pctMinority: tract.pctMinority,
        pctBelowPoverty: tract.pctBelowPoverty,
        zeroVehiclePct,
        transitCommutePct,
        isDisadvantaged: isDisadvantaged ? 1 : 0,
      },
    });
  }

  return overlays;
}

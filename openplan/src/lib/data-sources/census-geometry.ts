import { fetchJsonWithRetry } from "./http";
import { evaluateProxyDisadvantage } from "./equity";

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

    // The ACS income + burden PROXY — a screening heuristic, NOT the federal
    // CEJST/Justice40 designation. The property key stays `isDisadvantaged`
    // (wide paint/test blast radius); the map legend and hover label carry the
    // "proxy" qualifier.
    //
    // This used to be a hand-copied reimplementation of the rule in equity.ts,
    // with the five thresholds inlined as literals and a comment claiming they
    // were the "same thresholds as screenEquity". They agreed by luck, not by
    // construction: nothing failed if one moved. It now calls the one evaluator,
    // so the shading on the map and the count on the scorecard cannot disagree.
    const {
      disadvantaged: isDisadvantaged,
      zeroVehiclePct,
      transitCommutePct,
    } = evaluateProxyDisadvantage(tract);

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

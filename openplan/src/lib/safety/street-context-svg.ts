import type { CorridorGeojson } from "@/lib/models/run-launch";
import type { SafetyRoadContextFeature } from "@/lib/safety/road-context";

type Position = [number, number];

export const SAFETY_STREET_CONTEXT_PROJECTION_NOTE =
  "Local latitude-adjusted drawing; distances are approximate, not survey-grade. The scale bar is omitted for point-only or broad extents that cannot support a single local scale.";

function projectRings(geometry: CorridorGeojson | null): Position[][] {
  if (!geometry) return [];
  return geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
}

function pleasantDistance(meters: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(meters));
  const normalized = meters / magnitude;
  return (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * magnitude;
}

/** Deterministic, tile-free street context shared by the screen and report packet. */
export function renderSafetyStreetContextSvg(input: {
  roads: readonly SafetyRoadContextFeature[];
  crashLocations: readonly Position[];
  projectGeometry: CorridorGeojson | null;
  width?: number;
  height?: number;
}): string | null {
  const width = input.width ?? 760;
  const height = input.height ?? 430;
  const padding = 28;
  const rings = projectRings(input.projectGeometry);
  const positions = [
    ...rings.flat(),
    ...input.roads.flatMap((road) => road.geometry.coordinates),
    ...input.crashLocations,
  ];
  if (positions.length === 0 || !Number.isFinite(width) || !Number.isFinite(height)
    || width <= padding * 2 || height <= padding * 2
    || positions.some(([lon, lat]) => !Number.isFinite(lon) || !Number.isFinite(lat)
      || lon < -180 || lon > 180 || lat < -90 || lat > 90)) return null;

  // Fit the shortest circular longitude interval so local date-line crossings
  // stay local. One latitude-adjusted scale fits BOTH axes, as in the packet's
  // geography figure; independent x/y fitting would stretch the ground itself.
  const normalizeLon = (lon: number) => ((lon + 180) % 360 + 360) % 360 - 180;
  const longitudes = positions.map(([lon]) => normalizeLon(lon)).sort((a, b) => a - b);
  let largestGap = -1;
  let startLon = longitudes[0];
  for (let i = 0; i < longitudes.length; i++) {
    const next = i + 1 < longitudes.length ? longitudes[i + 1] : longitudes[0] + 360;
    if (next - longitudes[i] > largestGap) {
      largestGap = next - longitudes[i];
      startLon = normalizeLon(next);
    }
  }
  const unwrapLon = (lon: number) => {
    const normalized = normalizeLon(lon);
return normalized < startLon ? normalized + 360 : normalized;
  };
  let minLat = 90;
  let maxLat = -90;
  let maxLon = startLon;
  for (const [lon, lat] of positions) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    maxLon = Math.max(maxLon, unwrapLon(lon));
  }
  const radians = Math.PI / 180;
  const centerCos = Math.cos(((minLat + maxLat) / 2) * radians);
const longitudeMeters = 111_320 * Math.max(centerCos, 0.0001);
  const spanX = (maxLon - startLon) * longitudeMeters;
  const spanY = (maxLat - minLat) * 111_320;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const hasExtent = spanX > 0 || spanY > 0;
  const pixelsPerMeter = hasExtent
    ? Math.min(spanX > 0 ? innerWidth / spanX : Infinity, spanY > 0 ? innerHeight / spanY : Infinity)
    : 0;
const offsetX = (width - spanX * pixelsPerMeter) / 2;
  const offsetY = (height - spanY * pixelsPerMeter) / 2;
  const x = (lon: number) => offsetX + (unwrapLon(lon) - startLon) * longitudeMeters * pixelsPerMeter;
  const y = (lat: number) => height - offsetY - (lat - minLat) * 111_320 * pixelsPerMeter;
  const points = (line: readonly Position[]) => line.map(([lon, lat]) => `${x(lon).toFixed(2)},${y(lat).toFixed(2)}`).join(" ");
  const scaleUsable = hasExtent && maxLon - startLon < 180 && centerCos > 0.0001
&& [minLat, maxLat].every((lat) => Math.abs(centerCos / Math.cos(lat * radians) - 1) <= 0.02);
  const scaleMeters = scaleUsable
    ? pleasantDistance(Math.min(Math.max(spanX, spanY) / 4, innerWidth / (4 * pixelsPerMeter)))
    : 0;
const scalePixels = scaleMeters * pixelsPerMeter;
  const scaleLabel = scaleMeters >= 1000
    ? `${(scaleMeters / 1000).toLocaleString("en-US", { maximumSignificantDigits: 3 })} km`
    : `${scaleMeters.toLocaleString("en-US", { maximumSignificantDigits: 3 })} m`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Local street context" style="display:block;width:100%;height:auto;background:#fffdf8;border:1px solid #d5d7da">
    <desc>${SAFETY_STREET_CONTEXT_PROJECTION_NOTE}</desc>
    <rect width="${width}" height="${height}" fill="#fffdf8"/>
    ${input.roads.map((road) => `<polyline points="${points(road.geometry.coordinates)}" fill="none" stroke="#52636f" stroke-width="2.2"/>`).join("")}
    ${rings.map((ring) => `<polygon points="${points(ring)}" fill="rgba(31,107,94,0.08)" stroke="#1f6b5e" stroke-width="2" stroke-dasharray="8 5"/>`).join("")}
    ${input.crashLocations.map(([lon, lat]) => `<circle cx="${x(lon).toFixed(2)}" cy="${y(lat).toFixed(2)}" r="4" fill="#b42318" stroke="#fff" stroke-width="1.2"/>`).join("")}
    <g transform="translate(${width - 54} 30)"><text x="0" y="0" text-anchor="middle" font-size="12" font-weight="700">N</text><path d="M 0 8 L -7 26 L 0 21 L 7 26 Z" fill="#18242d"/></g>
    <g transform="translate(${padding} ${height - 14})">${scaleUsable
      ? `<line x1="0" y1="0" x2="${scalePixels.toFixed(2)}" y2="0" stroke="#18242d" stroke-width="4"/><text x="${(scalePixels / 2).toFixed(2)}" y="-7" text-anchor="middle" font-size="11">${scaleLabel}</text>`
      : '<text font-size="11">Scale omitted: no reliable single local scale.</text>'}</g>
  </svg>`;
}

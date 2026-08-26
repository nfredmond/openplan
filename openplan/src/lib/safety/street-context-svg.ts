import type { CorridorGeojson } from "@/lib/models/run-launch";
import type { SafetyRoadContextFeature } from "@/lib/safety/road-context";

type Position = [number, number];

function projectRings(geometry: CorridorGeojson | null): Position[][] {
  if (!geometry) return [];
  return geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
}

function pleasantDistance(meters: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, meters)));
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
  if (positions.length === 0) return null;

  const minLon = Math.min(...positions.map(([lon]) => lon));
  const maxLon = Math.max(...positions.map(([lon]) => lon));
  const minLat = Math.min(...positions.map(([, lat]) => lat));
  const maxLat = Math.max(...positions.map(([, lat]) => lat));
  const lonSpan = Math.max(maxLon - minLon, 0.0001);
  const latSpan = Math.max(maxLat - minLat, 0.0001);
  const x = (lon: number) => padding + ((lon - minLon) / lonSpan) * (width - padding * 2);
  const y = (lat: number) => height - padding - ((lat - minLat) / latSpan) * (height - padding * 2);
  const points = (line: readonly Position[]) => line.map(([lon, lat]) => `${x(lon).toFixed(2)},${y(lat).toFixed(2)}`).join(" ");
  const widthMeters = lonSpan * 111_320 * Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const scaleMeters = pleasantDistance(widthMeters / 4);
  const scalePixels = (scaleMeters / widthMeters) * (width - padding * 2);
  const scaleLabel = scaleMeters >= 1000
    ? `${(scaleMeters / 1000).toLocaleString()} km`
    : `${scaleMeters.toLocaleString()} m`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Local street context" style="display:block;width:100%;height:auto;background:#fffdf8;border:1px solid #d5d7da">
    <rect width="${width}" height="${height}" fill="#fffdf8"/>
    ${input.roads.map((road) => `<polyline points="${points(road.geometry.coordinates)}" fill="none" stroke="#52636f" stroke-width="2.2"/>`).join("")}
    ${rings.map((ring) => `<polygon points="${points(ring)}" fill="rgba(31,107,94,0.08)" stroke="#1f6b5e" stroke-width="2" stroke-dasharray="8 5"/>`).join("")}
    ${input.crashLocations.map(([lon, lat]) => `<circle cx="${x(lon).toFixed(2)}" cy="${y(lat).toFixed(2)}" r="4" fill="#b42318" stroke="#fff" stroke-width="1.2"/>`).join("")}
    <g transform="translate(${width - 54} 30)"><text x="0" y="0" text-anchor="middle" font-size="12" font-weight="700">N</text><path d="M 0 8 L -7 26 L 0 21 L 7 26 Z" fill="#18242d"/></g>
    <g transform="translate(${padding} ${height - 14})"><line x1="0" y1="0" x2="${scalePixels.toFixed(2)}" y2="0" stroke="#18242d" stroke-width="4"/><text x="${(scalePixels / 2).toFixed(2)}" y="-7" text-anchor="middle" font-size="11">${scaleLabel}</text></g>
  </svg>`;
}

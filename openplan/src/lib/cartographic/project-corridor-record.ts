/**
 * The wire shape of a project corridor, shared by the collection route, the
 * single-corridor route, and the client editor.
 *
 * It lives here rather than in a route file because a Next.js `route.ts` may
 * only export request handlers and a small set of route config values —
 * exporting a helper from one would be a build-time surprise — and because the
 * two corridor routes must not drift on what a corridor looks like.
 */

export const CORRIDOR_COLUMNS =
  "id, workspace_id, project_id, name, corridor_type, los_grade, geometry_geojson, created_at, updated_at";

export type ProjectCorridorRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  name: string;
  corridor_type: string;
  los_grade: string | null;
  geometry_geojson: unknown;
  created_at: string;
  updated_at: string;
};

export type ProjectCorridor = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  corridorType: string;
  losGrade: string | null;
  geometry: unknown;
  createdAt: string;
  updatedAt: string;
};

/** snake_case row -> camelCase wire record, the house convention for API payloads. */
export function serializeProjectCorridor(row: ProjectCorridorRow): ProjectCorridor {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    name: row.name,
    corridorType: row.corridor_type,
    losGrade: row.los_grade,
    geometry: row.geometry_geojson,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Roughly how long a corridor line is, in kilometres — or null when the shape
 * carries no usable line.
 *
 * WHY A LIST NEEDS THIS. Two corridors with the same name and the same type
 * rendered identically: same label, same sub-line, same delete button, and the
 * delete buttons even shared an accessible name, so a screen-reader user could
 * not tell them apart either. A tester uploaded a corridor file next to an
 * existing same-named corridor and was left with two entries and no way to know
 * which held the real geometry. Length is what actually differs between them,
 * and it is the thing a planner would use to decide.
 *
 * Equirectangular, which is honest enough to tell 0.2 km from 4 km — the job
 * here. It is rendered with ≈ and is not a survey measurement.
 */
export function corridorLengthKm(geometry: unknown): number | null {
  const coords = (geometry as { type?: string; coordinates?: unknown } | null)?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;

  let km = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1];
    const b = coords[i];
    if (!Array.isArray(a) || !Array.isArray(b)) return null;
    const [lon1, lat1] = a as number[];
    const [lon2, lat2] = b as number[];
    if (![lon1, lat1, lon2, lat2].every((n) => Number.isFinite(n))) return null;
    const midLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
    const dLat = (lat2 - lat1) * 110.574;
    const dLon = (lon2 - lon1) * 111.32 * Math.cos(midLat);
    km += Math.hypot(dLat, dLon);
  }
  return km > 0 ? km : null;
}

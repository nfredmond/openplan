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

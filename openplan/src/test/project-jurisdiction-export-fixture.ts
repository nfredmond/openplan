import { clearedProjectPlace } from "@/lib/projects/project-place";
import type { ProjectGeoPackageProject } from "@/lib/projects/project-geopackage";
export const actor = "99999999-9999-4999-8999-999999999999";
export const declaration = {
  version: 1, state: "declared", recordedBy: actor, recordedAt: "2026-10-15T00:00:00.000Z",
  entries: [{ label: "Source-defined sovereign context", kind: "nation", reference: "nation:source", countryCode: "CA", subdivisionCode: "BC", scope: "sovereign", identity: "staff_declared" }],
};
export const exportProject: ProjectGeoPackageProject = {
  ...clearedProjectPlace(), id: "project", workspace_id: "workspace", name: "Project", summary: null,
  status: "active", plan_type: "corridor_plan", delivery_phase: "planning", latitude: null, longitude: null,
  created_at: declaration.recordedAt, updated_at: "2026-10-15T01:00:00.000Z", jurisdiction_context: declaration,
  place_source: "uploaded", place_label: "Uploaded study boundary",
  place_geometry_geojson: { type: "Polygon", coordinates: [[[-124.12345, 40], [-123.12345, 40], [-123.12345, 41], [-124.12345, 40]]] },
};

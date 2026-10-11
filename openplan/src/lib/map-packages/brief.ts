import { z } from "zod";
import type { ProjectCorridorRow } from "@/lib/cartographic/project-corridor-record";
import type { ProjectPlaceRow } from "@/lib/projects/project-place";
import type { MapPackageDeliverable } from "./catalog";
import {
  canonicalMapPackageBrief,
  mapPackageBriefSchema,
  type MapPackageBrief,
  type MapPackageFeature,
} from "./contracts";
import { MAP_PACKAGE_SKILL } from "./skill";

export type MapPackageBriefProject = Partial<ProjectPlaceRow> & {
  id: string;
  workspace_id: string;
  name: string;
  summary: string | null;
  status: string | null;
  plan_type: string | null;
  delivery_phase: string | null;
  latitude: number | null;
  longitude: number | null;
};

type MapPackageBriefOpportunity = {
  id: string;
  title: string;
  agency_name: string | null;
  program_id: string | null;
  closes_at: string | null;
};

export type MapPackageBriefInput = {
  project: MapPackageBriefProject;
  corridors: ProjectCorridorRow[];
  fundingOpportunity: MapPackageBriefOpportunity | null;
  client: string;
  deliverable: MapPackageDeliverable;
  request: string;
  practice: boolean;
  capturedAt: string;
};

const geometryOnly = mapPackageBriefSchema.shape.studyArea.shape.features.element.shape.geometry;
type BriefGeometry = z.infer<typeof geometryOnly>;

/** A stored geometry, or the geometry inside a stored Feature, when it is one the brief carries. */
function briefGeometry(raw: unknown, allowed: BriefGeometry["type"][]): BriefGeometry | null {
  const candidate = raw && typeof raw === "object" && (raw as { type?: unknown }).type === "Feature"
    ? (raw as { geometry?: unknown }).geometry
    : raw;
  const parsed = geometryOnly.safeParse(candidate);
  return parsed.success && allowed.includes(parsed.data.type) ? parsed.data : null;
}

function bbox(project: MapPackageBriefProject): [number, number, number, number] | null {
  const values = [project.place_min_lon, project.place_min_lat, project.place_max_lon, project.place_max_lat];
  return values.every((value) => typeof value === "number" && Number.isFinite(value))
    ? (values as [number, number, number, number])
    : null;
}

/**
 * Freeze what the agent may know about one project: its own fields, its place
 * and drawn geography, the grant application it serves, and the planner's
 * request. Nothing else in the workspace enters the brief. A place boundary
 * too large for the brief is left out and named as left out; the agent can
 * fetch the boundary itself from the place name.
 */
export function buildMapPackageBrief(input: MapPackageBriefInput): { brief: MapPackageBrief; canonical: string; hash: string } {
  const { project } = input;
  const features: MapPackageFeature[] = [];
  for (const corridor of input.corridors.slice(0, 150)) {
    if (corridor.project_id !== project.id || corridor.workspace_id !== project.workspace_id) continue;
    const geometry = briefGeometry(corridor.geometry_geojson, ["LineString", "MultiLineString"]);
    if (geometry) features.push({ type: "Feature", properties: { role: "corridor", name: corridor.name.slice(0, 300) }, geometry });
  }
  if (typeof project.latitude === "number" && typeof project.longitude === "number"
    && Number.isFinite(project.latitude) && Number.isFinite(project.longitude)) {
    features.push({ type: "Feature", properties: { role: "site", name: null }, geometry: { type: "Point", coordinates: [project.longitude, project.latitude] } });
  }
  const boundary = briefGeometry(project.place_geometry_geojson, ["Polygon", "MultiPolygon"]);
  const placeLabel = project.place_label ?? null;
  const base: Omit<MapPackageBrief, "studyArea" | "placeBoundary"> = {
    version: 1,
    kind: "openplan.map_package_brief",
    workspaceId: project.workspace_id,
    project: {
      id: project.id,
      name: project.name,
      summary: project.summary ? project.summary.slice(0, 8000) : null,
      status: project.status,
      planType: project.plan_type,
      deliveryPhase: project.delivery_phase,
    },
    client: input.client.trim(),
    deliverable: input.deliverable,
    fundingOpportunity: input.fundingOpportunity
      ? {
          id: input.fundingOpportunity.id,
          title: input.fundingOpportunity.title,
          agencyName: input.fundingOpportunity.agency_name,
          programId: input.fundingOpportunity.program_id,
          closesAt: input.fundingOpportunity.closes_at,
        }
      : null,
    place: placeLabel || bbox(project)
      ? {
          label: placeLabel,
          kind: project.place_kind ?? null,
          countryCode: project.place_country_code ?? null,
          subdivisionCode: project.place_subdivision_code ?? null,
          bbox: bbox(project),
        }
      : null,
    request: input.request.trim(),
    practice: input.practice,
    skill: { name: MAP_PACKAGE_SKILL.name, treeHash: MAP_PACKAGE_SKILL.treeHash },
    capturedAt: input.capturedAt,
  };

  if (boundary) {
    const withBoundary = mapPackageBriefSchema.parse({
      ...base,
      studyArea: { type: "FeatureCollection", features: [{ type: "Feature", properties: { role: "place_boundary", name: placeLabel }, geometry: boundary }, ...features] },
      placeBoundary: "included",
    });
    try {
      return { brief: withBoundary, ...canonicalMapPackageBrief(withBoundary) };
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "map_package_brief_too_large") throw error;
    }
  }
  const brief = mapPackageBriefSchema.parse({
    ...base,
    studyArea: { type: "FeatureCollection", features },
    placeBoundary: boundary ? "too_large" : "none_recorded",
  });
  return { brief, ...canonicalMapPackageBrief(brief) };
}

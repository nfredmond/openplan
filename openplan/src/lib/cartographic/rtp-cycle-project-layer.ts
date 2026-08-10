/**
 * The contract for the per-cycle RTP project layer: what the route asks the
 * database for, and what it hands back.
 *
 * WHY THIS IS NOT IN `route.ts`, WHERE IT STARTED. Next's generated route types
 * (`.next/types/app/**`) allow a route module to export only the HTTP handlers
 * and a fixed set of segment options — a stray `export const` fails
 * `next build` with `Type 'OmitWithTag<…>' does not satisfy the constraint
 * '{ [x: string]: never; }'`. TYPES are erased and may be exported from a route
 * (`MapFeatureCounts` in `map-features/counts/route.ts` is the precedent); a
 * VALUE may not. The projection has to be a value, because the test asserts on
 * the `.select()` STRING — the Supabase clients here are untyped and a mocked
 * one returns its fixture whatever was asked for, so the string is the only
 * thing that catches a column that stopped being requested.
 *
 * PURE — no I/O, no Mapbox import, no React. Sits beside `layer-disclosure.ts`
 * for the same reason that module does: it is the vocabulary both the producing
 * route and the consuming panel have to agree on, and a copy on either side
 * would drift.
 */

import { buildMapLayerDisclosure, type MapLayerFeatureCollection } from "./layer-disclosure";
import { parseOptionalAmount } from "@/lib/money/optional-amount";

/**
 * The columns the layer renders from.
 *
 * `projects(…)` is a PostgREST embed of the linked project. Geometry comes from
 * the project's own `latitude`/`longitude` — the project SITE (20260421000065)
 * — and deliberately NOT from `rtp_cycles.anchor_latitude/longitude`, which
 * that migration's own comment calls display-only and "not a spatial-query
 * index". An anchor is one dot for a whole plan; it cannot answer "where is the
 * money going?".
 */
export const RTP_CYCLE_PROJECT_MAP_COLUMNS =
  "id, project_id, portfolio_role, horizon_band_id, estimated_cost, cost_basis_year, " +
  "projects(id, name, status, latitude, longitude)";

export type RtpCycleProjectFeature = {
  type: "Feature";
  /** The LINK id: a project can sit in two cycles, so a project id is not unique per map. */
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    kind: "rtp_cycle_project";
    linkId: string;
    projectId: string;
    projectName: string | null;
    projectStatus: string | null;
    portfolioRole: string | null;
    horizonBandId: string | null;
    /**
     * NULL MEANS UNPRICED, never zero — the distinction the whole financial
     * element rests on. A cycle with twelve of forty projects uncosted must not
     * total as though it were complete.
     */
    estimatedCost: number | null;
    costBasisYear: number | null;
  };
};

/**
 * The layer's payload: the shared `MapLayerDisclosure` contract plus the two
 * counts that contract cannot express.
 *
 * `MapLayerDisclosure.droppedCount` means "fetched but not drawable", which
 * covers both of these at once — and the two are different facts a different
 * person acts on. "No location recorded" is the agency's own data entry, and a
 * planner fixes it on the project page. "The project row could not be read" is
 * the database, and only an operator can act on it. Folding them together would
 * send the wrong person looking.
 */
export type RtpCycleProjectFeatureCollection = MapLayerFeatureCollection<RtpCycleProjectFeature> & {
  /** Links whose project exists and has no usable site coordinate. */
  withoutGeometry: number;
  /** Links whose embedded project row came back empty. */
  withoutReadableProject: number;
};

/** A row as `RTP_CYCLE_PROJECT_MAP_COLUMNS` returns it, before any coercion. */
export type RtpCycleProjectLinkRow = {
  id: string;
  project_id: string;
  portfolio_role: string | null;
  horizon_band_id: string | null;
  estimated_cost: number | string | null;
  cost_basis_year: number | null;
  projects:
    | { id: string; name: string | null; status: string | null; latitude: number | string | null; longitude: number | string | null }
    | Array<{ id: string; name: string | null; status: string | null; latitude: number | string | null; longitude: number | string | null }>
    | null;
};

/**
 * PostgREST returns an embedded to-one relation as an object or a one-element
 * array depending on driver plumbing; both spellings appear in this repo.
 */
function unwrapProject(value: RtpCycleProjectLinkRow["projects"]) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Lat/lng are NUMERIC, so PostgREST may hand them back as strings. Out-of-range
 * values are rejected as well as unparseable ones: the row-level CHECK
 * constraints in 20260421000065 already refuse them, and this is the defense in
 * depth every sibling layer applies — a coordinate outside the globe draws a
 * dot somewhere, which is worse than drawing none.
 */
function coerceCoordinate(value: unknown, bound: number): number | null {
  const n = typeof value === "string" ? Number.parseFloat(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n) || n < -bound || n > bound) return null;
  return n;
}

/**
 * Rows → the layer payload. Extracted from the members-only route when the
 * public plan share page grew the same map: a second copy of the geometry
 * coercion or the withoutGeometry/withoutReadableProject accounting would
 * drift, and the two maps would silently disagree about the same plan — the
 * shared-capability-inside-one-caller seam defect, pre-empted rather than
 * shipped this time. Pure, so both callers (route and server component) can
 * use it as-is.
 */
export function buildRtpCycleProjectFeatureCollection(
  rows: RtpCycleProjectLinkRow[],
  matchedCount: number | null
): RtpCycleProjectFeatureCollection {
  const features: RtpCycleProjectFeature[] = [];
  let withoutGeometry = 0;
  let withoutReadableProject = 0;

  for (const row of rows) {
    const project = unwrapProject(row.projects);

    if (!project) {
      withoutReadableProject += 1;
      continue;
    }

    const lat = coerceCoordinate(project.latitude, 90);
    const lng = coerceCoordinate(project.longitude, 180);

    if (lat === null || lng === null) {
      withoutGeometry += 1;
      continue;
    }

    features.push({
      type: "Feature",
      id: row.id,
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: {
        kind: "rtp_cycle_project",
        linkId: row.id,
        projectId: project.id,
        projectName: project.name,
        projectStatus: project.status,
        portfolioRole: row.portfolio_role,
        horizonBandId: row.horizon_band_id,
        estimatedCost: parseOptionalAmount(row.estimated_cost),
        costBasisYear: row.cost_basis_year,
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
    withoutGeometry,
    withoutReadableProject,
    ...buildMapLayerDisclosure({
      returnedCount: features.length,
      droppedCount: withoutGeometry + withoutReadableProject,
      matchedCount,
    }),
  };
}

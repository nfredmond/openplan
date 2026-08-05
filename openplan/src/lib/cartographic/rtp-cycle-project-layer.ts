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

import type { MapLayerFeatureCollection } from "./layer-disclosure";

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

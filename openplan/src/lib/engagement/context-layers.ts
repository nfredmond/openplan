/**
 * GIS context layers on engagement maps — the shared vocabulary.
 *
 * WHAT THIS IS FOR. A resident asked to draw on a map needs to see the thing
 * being planned. Until this module existed, the participant map carried exactly
 * one source (the resident's own sketch) and the operator had no way to put the
 * proposed alignment, the parcel boundaries, or the existing bike network
 * underneath it. Comments came back describing a blank basemap.
 *
 * WHAT LIVES HERE. The types, the operator-configurable bounds, the disclosure
 * sentences, and the ONE query that decides what a member of the public may see.
 * Reading an upload — parsing GeoJSON / KML / shapefile, establishing its
 * coordinate reference system, refusing what it cannot place honestly — lives
 * next door in `context-layer-import.ts`, because that half is node-only
 * (it inflates zip archives) and this half is imported by client components.
 *
 * THE DISCLOSURE CONTRACT IS BORROWED, NOT REINVENTED.
 * `src/lib/cartographic/layer-disclosure.ts` already states what a map layer
 * must say about its own completeness, and its `MapLayerDisclosure` type is used
 * here verbatim. Only the SENTENCES are local, because `MapLayerKey` is a closed
 * union of the operator-side layers and a context layer's noun is whatever the
 * operator named it ("Proposed alignment", "Parcels") rather than a fixed word.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { MapLayerDisclosure } from "@/lib/cartographic/layer-disclosure";
import { describeSpatialFileSrs } from "@/lib/geo/crs/describe";
import type { SpatialFileSrsBasis } from "@/lib/geo/spatial-file-import";

type QueryClient = Pick<SupabaseClient, "from">;

// ── Vocabulary ───────────────────────────────────────────────────────────────

/** Upload formats the importer can read. */
export const CONTEXT_LAYER_FORMATS = ["geojson", "kml", "kmz", "shapefile_zip"] as const;
export type ContextLayerFormat = (typeof CONTEXT_LAYER_FORMATS)[number];

/**
 * How a layer's coordinate reference system was established.
 *
 * There is deliberately no member meaning "assumed". OpenPlan does not ask a
 * planner to choose a projection — most do not know theirs, and EngagementHQ
 * making them pick is a question with a wrong answer available. It reads the
 * answer from the file, or from a specification that fixes it, or it refuses.
 * A silently reprojected alignment drawn fifty metres off the street is worse
 * than a layer that did not load.
 */
export const CONTEXT_LAYER_SRS_BASES = [
  /** Read from a shapefile's `.prj` WKT. */
  "prj_file",
  /** A legacy (GeoJSON 2008) `crs` member naming CRS84 / EPSG:4326. */
  "geojson_crs_member",
  /** RFC 7946 §4: GeoJSON coordinates are WGS84 unless a `crs` member says otherwise. */
  "geojson_rfc7946_default",
  /** OGC KML 2.2 §6.1: KML coordinates are WGS84. */
  "kml_specification",
] as const;
/**
 * The bases a CONTEXT LAYER can be stored with — the four above, which is what
 * migration 20260729000002's CHECK constraint allows.
 *
 * The TYPE, however, is the shared importer's wider union. That is deliberate
 * and is not a loosening: the importer now also produces `planner_asserted` for
 * workspace GIS layers, where a person states the coordinate system of a
 * shapefile that carries no .prj. The engagement path never supplies a CRS
 * resolver, so it cannot produce that basis, and the database refuses it if
 * anything ever tries. Narrowing the type here instead would mean the two
 * vocabularies drift apart and every shared function needs a conversion.
 */
export type ContextLayerSrsBasis = SpatialFileSrsBasis;

export type ContextLayerSrs = {
  /** Registry that issued the code, e.g. "EPSG". Null when the file named none. */
  authority: string | null;
  /** Code within that registry, e.g. "4326". Null when the file named none. */
  code: string | null;
  /** What a planner reads: "WGS 84", "NAD83 / California zone 2 (ftUS)". */
  name: string;
  basis: ContextLayerSrsBasis;
};

/** Geometry kinds a normalized context layer can carry. */
export type ContextLayerGeometryKind = "Point" | "LineString" | "Polygon";

export type ContextLayerFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJSON.Feature[];
};

// ── Operator bounds (never a tier) ───────────────────────────────────────────

/**
 * TWO OPTIONAL, OPERATOR-SET BOUNDS. Unset means genuinely unlimited, and the
 * check is skipped rather than defaulted — the same posture, and the same
 * reasoning, as `src/lib/config/run-cap.ts`.
 *
 * OpenPlan is free and has no tiers, so these can never be a plan. They exist
 * because someone running a public deployment on their own compute may not want
 * a single upload to become a 300 MB row, and that is a property of THEIR
 * hardware, not of the person uploading. The refusal names the operator.
 *
 * WHAT IS NOT NEGOTIABLE HERE: the hosting platform imposes its own request-body
 * ceiling (Vercel's serverless functions cap request bodies at a few megabytes),
 * and a 413 from the platform is not OpenPlan refusing. Self-hosting removes
 * that ceiling; no OpenPlan setting can.
 */
export const CONTEXT_LAYER_FEATURE_CAP_ENV = "OPENPLAN_ENGAGEMENT_LAYER_FEATURE_CAP";
export const CONTEXT_LAYER_BYTE_CAP_ENV = "OPENPLAN_ENGAGEMENT_LAYER_MAX_BYTES";

/**
 * A positive-integer env var, or null for unlimited.
 *
 * Anything malformed is treated as UNSET rather than as zero, for the same
 * reason `resolveMonthlyRunCap` does: a typo must not become a cap of 0 that
 * refuses every upload in the deployment.
 */
function resolvePositiveIntEnv(name: string, env: NodeJS.ProcessEnv): number | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Most features one uploaded layer may store, or null for unlimited. */
export function resolveContextLayerFeatureCap(env: NodeJS.ProcessEnv = process.env): number | null {
  return resolvePositiveIntEnv(CONTEXT_LAYER_FEATURE_CAP_ENV, env);
}

/** Largest upload this deployment accepts in bytes, or null for unlimited. */
export function resolveContextLayerByteCap(env: NodeJS.ProcessEnv = process.env): number | null {
  return resolvePositiveIntEnv(CONTEXT_LAYER_BYTE_CAP_ENV, env);
}

/**
 * The refusal a planner sees when an upload exceeds the deployment's byte
 * ceiling. It names the operator and says nothing about plans or upgrades —
 * there is nothing to buy.
 */
export function contextLayerByteCapMessage(capBytes: number, actualBytes: number): string {
  const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return (
    `This OpenPlan deployment accepts map layer uploads up to ${mb(capBytes)}, and this file is ${mb(actualBytes)}. ` +
    `Contact whoever operates this deployment to raise or remove the limit, or simplify the layer in your GIS ` +
    `before uploading — OpenPlan itself is free and has no usage tiers.`
  );
}

// ── Disclosure ───────────────────────────────────────────────────────────────

/**
 * What one context layer must say about its own completeness.
 *
 * Returns a LIST rather than a joined string for the same reason
 * `describeMapLayerCoverage` does: a layer can be both truncated and carrying
 * undrawable geometry, and folding the second into the first lets a
 * non-truncated layer hide its drops.
 *
 * THE NOUN IS "SHAPES", AND THAT IS A CORRECTION, NOT A STYLE CHOICE. These
 * counts are counts of drawn geometries, not of source GeoJSON Features, and
 * the two diverge: a Feature carrying a GeometryCollection becomes one shape per
 * member, because Mapbox will not draw a GeometryCollection. Written as
 * "features", "showing 5 of 12" could name a denominator larger than the number
 * of features the operator's file actually contained — a wrong number on the one
 * surface whose whole job is to keep the layer from overstating itself. Both
 * sides of the ratio are shapes, so the sentence says shapes.
 */
export function describeContextLayerCoverage(
  layerName: string,
  disclosure: MapLayerDisclosure
): string[] {
  const notes: string[] = [];

  if (disclosure.truncated) {
    notes.push(
      `${layerName}: showing ${disclosure.returnedCount.toLocaleString()} of ` +
        `${disclosure.matchedCount.toLocaleString()} shapes — this deployment stores at most ` +
        `${disclosure.limit.toLocaleString()} per layer. The rest are not drawn, which is not a finding ` +
        `that the layer ends here.`
    );
  }

  if (disclosure.droppedCount > 0) {
    const count = disclosure.droppedCount;
    notes.push(
      `${layerName}: ${count.toLocaleString()} ${count === 1 ? "shape" : "shapes"} in the uploaded file ` +
        `could not be drawn — the geometry was unusable, or it was a kind OpenPlan will not place on a guess — ` +
        `so ${count === 1 ? "it is" : "they are"} missing from the map rather than absent from the source.`
    );
  }

  return notes;
}

/**
 * The disclosure a stored row carries, in the shared field names.
 *
 * `limit` is the stored feature count because truncation, when it happened,
 * happened exactly AT the cap — the importer stops after storing `limit`
 * features. Reconstructing it this way rather than adding a column keeps the row
 * from carrying two numbers that could disagree, and the field is only ever read
 * on a truncated layer.
 */
export function contextLayerDisclosure(row: {
  feature_count: number;
  source_feature_count: number;
  dropped_feature_count: number;
  truncated: boolean;
}): MapLayerDisclosure {
  return {
    returnedCount: row.feature_count,
    matchedCount: row.source_feature_count,
    droppedCount: row.dropped_feature_count,
    truncated: row.truncated,
    limit: row.feature_count,
  };
}

// ── Rows and projections ─────────────────────────────────────────────────────

export type ContextLayerRow = {
  id: string;
  campaign_id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  source_format: ContextLayerFormat;
  source_filename: string;
  source_byte_size: number;
  srs_authority: string | null;
  srs_code: string | null;
  srs_name: string;
  srs_basis: ContextLayerSrsBasis;
  geometry_kinds: ContextLayerGeometryKind[];
  /**
   * THE THREE COUNTS ARE COUNTS OF SHAPES, not of source GeoJSON Features.
   *
   * One stored shape is one drawn geometry: a Feature holding a
   * GeometryCollection is expanded into one shape per member at import, because
   * Mapbox will not draw a GeometryCollection. Keeping every count in that one
   * unit is what makes `feature_count + dropped <= source_feature_count` — the
   * check constraint on the table — and the "showing N of M" sentence both true
   * at once. The columns keep the `feature` name because they mirror
   * `MapLayerDisclosure` field for field across the whole product; the sentence
   * a person reads says "shapes".
   */
  feature_count: number;
  source_feature_count: number;
  dropped_feature_count: number;
  truncated: boolean;
  features: ContextLayerFeatureCollection;
  bbox: [number, number, number, number] | null;
  display_color: string;
  sort_order: number;
  visible_to_participants: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * THE SELECT STRINGS, AS CONSTANTS.
 *
 * Supabase clients in this repo are deliberately untyped, so a column missing
 * from a `.select()` string is `undefined` at runtime and `tsc` says nothing.
 * That exact defect has shipped here more than once — a complete, tested,
 * role-gated capability that no planner could reach because one column never
 * made it into the projection. Naming the projections once, here, lets a test
 * assert that the columns the UI reads are the columns the query asks for.
 *
 * The operator list deliberately OMITS `features`: a campaign with a dozen
 * parcel layers would otherwise ship every polygon to a management panel that
 * only renders names and counts.
 */
export const CONTEXT_LAYER_SUMMARY_COLUMNS =
  "id, campaign_id, workspace_id, name, description, source_format, source_filename, source_byte_size, " +
  "srs_authority, srs_code, srs_name, srs_basis, geometry_kinds, feature_count, source_feature_count, " +
  "dropped_feature_count, truncated, bbox, display_color, sort_order, visible_to_participants, created_at, updated_at";

/** The participant projection — the summary plus the geometry the map draws. */
export const PARTICIPANT_CONTEXT_LAYER_COLUMNS = `${CONTEXT_LAYER_SUMMARY_COLUMNS}, features`;

/** What an operator management panel renders (no geometry). */
export type ContextLayerSummary = Omit<ContextLayerRow, "features">;

/**
 * What the PARTICIPANT map is handed. Deliberately not the row: a resident's
 * browser has no business receiving the workspace id, and a field that never
 * crosses the boundary cannot leak across it.
 */
export type ParticipantContextLayer = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  geometryKinds: ContextLayerGeometryKind[];
  featureCollection: ContextLayerFeatureCollection;
  /**
   * [west, south, east, north] in WGS84, or null when the stored row predates a
   * computed extent. Carried so a map with no community input yet can still
   * frame the project rather than opening on the continent.
   */
  bbox: [number, number, number, number] | null;
  /** Truncation / undrawable-feature sentences. Empty when the layer is whole. */
  coverageNotes: string[];
};

/**
 * The whole participant-side answer, INCLUDING the failure case.
 *
 * A read that failed may not be rendered as an answer
 * (`src/lib/ui/read-failures.ts`). If this list came back empty because the
 * query broke, a map that simply draws the basemap is telling the resident
 * "there is no project geometry here" — a confident statement of something
 * nobody checked. So the failure travels with the layers and the map says it.
 */
export type ParticipantContextLayerSet = {
  layers: ParticipantContextLayer[];
  /** Null on success; the operator-readable reason when the read failed. */
  readFailure: string | null;
};

export const EMPTY_PARTICIPANT_CONTEXT_LAYERS: ParticipantContextLayerSet = {
  layers: [],
  readFailure: null,
};

export function toParticipantContextLayer(row: ContextLayerRow): ParticipantContextLayer {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.display_color,
    geometryKinds: row.geometry_kinds ?? [],
    featureCollection: row.features,
    bbox: row.bbox ?? null,
    coverageNotes: describeContextLayerCoverage(row.name, contextLayerDisclosure(row)),
  };
}

// ── The one query that decides what the public sees ──────────────────────────

/**
 * Layers this campaign has PUBLISHED, for the unauthenticated portal.
 *
 * THE PUBLICATION RULE LIVES HERE AND NOWHERE ELSE. The table grants anon no
 * policy at all, so this service-role query — filtered on
 * `visible_to_participants` — is the single statement of what a member of the
 * public may read. That is deliberate: an anon SELECT policy would publish every
 * flagged layer through PostgREST to anyone holding the deployment's public key,
 * campaign link or not, and would turn "is this layer public?" into a question
 * you answer by reading policy predicates.
 *
 * The caller must already have resolved the campaign from its share token and
 * confirmed it is active; this function does not re-derive that, exactly as
 * `loadPublishedCloseLoopEntries` does not.
 */
export async function loadParticipantContextLayers(
  supabase: QueryClient,
  campaignId: string
): Promise<ParticipantContextLayerSet> {
  const { data, error } = await supabase
    .from("engagement_context_layers")
    .select(PARTICIPANT_CONTEXT_LAYER_COLUMNS)
    .eq("campaign_id", campaignId)
    .eq("visible_to_participants", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return {
      layers: [],
      readFailure: error.message ?? "The campaign's map layers could not be read.",
    };
  }

  return {
    layers: ((data ?? []) as ContextLayerRow[]).map(toParticipantContextLayer),
    readFailure: null,
  };
}

/** Every layer on a campaign, published or not — the operator management read. */
export async function loadCampaignContextLayerSummaries(
  supabase: QueryClient,
  campaignId: string
): Promise<{ layers: ContextLayerSummary[]; readFailure: string | null }> {
  const { data, error } = await supabase
    .from("engagement_context_layers")
    .select(CONTEXT_LAYER_SUMMARY_COLUMNS)
    .eq("campaign_id", campaignId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return { layers: [], readFailure: error.message ?? "The campaign's map layers could not be read." };
  }

  return { layers: (data ?? []) as unknown as ContextLayerSummary[], readFailure: null };
}

// ── What the operator is told before publishing ──────────────────────────────

/**
 * The sentence next to the publication switch.
 *
 * An operator uploading a parcel layer has to understand that turning this on
 * puts the geometry — and every attribute that rode along with it — in front of
 * anyone who has the share link, indexable, downloadable, forever. Making the
 * default off is not enough on its own; the default has to be explained at the
 * moment it is changed, in the words a planner uses.
 */
export function contextLayerPublicationWarning(layerName: string): string {
  return (
    `Showing “${layerName}” to participants publishes it. Anyone with this campaign's public link — no ` +
    `sign-in, no invitation — can see the geometry and download it. Do not publish parcels, addresses, or ` +
    `right-of-way data that carries personal or non-public attributes.`
  );
}

/**
 * How a layer's coordinate reference system is explained back to the operator.
 *
 * ONE SENTENCE, PRODUCT-WIDE. The wording moved to `@/lib/geo/crs/describe`
 * when workspace GIS layers arrived, because two panels writing their own
 * version of this drift, and the drift is invisible: the day one of them stops
 * saying "no datum transformation was applied" is the day that stops being
 * disclosed, with nothing in the code that does the work having changed.
 *
 * This alias stays because the engagement lane's callers read better for it and
 * because it is the seam where a context layer's narrower vocabulary meets the
 * shared one.
 */
export function describeContextLayerSrs(srs: ContextLayerSrs): string {
  return describeSpatialFileSrs(srs);
}

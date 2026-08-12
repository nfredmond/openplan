/**
 * THE WHOLE CONTRACT between the workspace-GIS store and everything that draws
 * it. Persistence, ingest and serving own this file; the map, the panel and the
 * upload wizard import it and never invent a shape it does not declare.
 *
 * WHY THAT RULE IS WRITTEN DOWN. A layer's completeness is a claim — "this is
 * your parcel fabric" — and every field below either carries that claim or
 * qualifies it. A surface that assembled its own response shape would sooner or
 * later render a count without the sentence that makes the count honest. So the
 * shapes are declared once, here, with the caveat fields non-optional.
 *
 * PURE — types, small pure helpers, no I/O and no environment access.
 */

/** Formats the store accepts. Detection itself lives in the shared importer. */
export const WORKSPACE_GIS_SOURCE_FORMATS = [
  "geojson",
  "kml",
  "kmz",
  "shapefile_zip",
  "file_geodatabase",
] as const;
export type WorkspaceGisSourceFormat = (typeof WORKSPACE_GIS_SOURCE_FORMATS)[number];

/**
 * How the coordinate reference system was established, mirroring the CHECK in
 * 20260812000015 exactly.
 *
 * `planner_asserted` is the one member that is NOT evidence from the file: the
 * upload carried no .prj and a named person chose the system. It is the reason
 * this vocabulary is bigger than the engagement one, and the reason the
 * database refuses to store it without an author.
 */
export const WORKSPACE_GIS_SRS_BASES = [
  "prj_file",
  "geojson_crs_member",
  "geojson_rfc7946_default",
  "kml_specification",
  "gdal_detected",
  "planner_asserted",
] as const;
export type WorkspaceGisSrsBasis = (typeof WORKSPACE_GIS_SRS_BASES)[number];

/** The bases that are evidence read from the file. Never a person's choice. */
export const WORKSPACE_GIS_EVIDENCE_BASES: readonly WorkspaceGisSrsBasis[] =
  WORKSPACE_GIS_SRS_BASES.filter((basis) => basis !== "planner_asserted");

/**
 * True when this basis records a PERSON's statement rather than the file's.
 *
 * The distinction is a claim tier: an assertion may be wrong in a way evidence
 * cannot be, so it is displayed differently, it names its author, and it may
 * never be rewritten as evidence.
 */
export function isAssertedSrsBasis(basis: WorkspaceGisSrsBasis): boolean {
  return basis === "planner_asserted";
}

export type WorkspaceGisReprojectionEngine = "none" | "openplan" | "gdal";

/** The state an upload is in. `ready` is the only state a map will draw. */
export type WorkspaceGisIngestStatus = "receiving" | "ready" | "failed";

/**
 * Why an ingest failed — a FIXED vocabulary, mirroring the CHECK in
 * 20260812000015. A raw driver message never reaches a planner: the sentence
 * they read is written from this code by `describeIngestFailure`.
 */
export const WORKSPACE_GIS_INGEST_FAILURE_REASONS = [
  "abandoned",
  "client_reported_failure",
  "feature_cap_exceeded",
  "geometry_rejected",
  "worker_conversion_failed",
] as const;
export type WorkspaceGisIngestFailureReason =
  (typeof WORKSPACE_GIS_INGEST_FAILURE_REASONS)[number];

export function describeIngestFailure(reason: WorkspaceGisIngestFailureReason): string {
  switch (reason) {
    case "abandoned":
      return "This upload stopped partway through and never finished — the browser was closed, or the connection dropped. Nothing was drawn from it. Upload the file again.";
    case "client_reported_failure":
      return "The upload was stopped by the browser while it was reading the file, so this version is incomplete and is not drawn.";
    case "feature_cap_exceeded":
      return "This file holds more shapes than this deployment stores in one layer. Nothing was drawn from it — ask whoever operates this deployment about the per-layer limit, or upload a clipped extract.";
    case "geometry_rejected":
      return "Some shapes in this file could not be stored as valid WGS84 geometry, so the upload was stopped rather than left with holes in it.";
    case "worker_conversion_failed":
      return "The conversion worker could not read this file, so nothing was stored. The version record keeps what it reported.";
    default:
      return "This upload did not finish, and nothing from it is drawn.";
  }
}

/** One attribute column of a layer, as the file declared it. */
export type WorkspaceGisAttributeField = {
  name: string;
  /** The source's own type word (dBASE `C`/`N`/`D`, a GeoJSON value kind). Data, not a vocabulary. */
  type: string;
};

/** WGS84 [west, south, east, north]. */
export type WorkspaceGisBbox = [number, number, number, number];

/**
 * The coordinate reference system a version was read as, WITH how that was
 * established. The two are one object because the second is what makes the
 * first meaningful — a CRS name with no basis is a claim with no tier.
 */
export type WorkspaceGisSrs = {
  authority: string | null;
  code: string | null;
  /** The human name a planner recognises: "California State Plane Zone 3, US survey feet". */
  name: string;
  basis: WorkspaceGisSrsBasis;
  /** Set only for `planner_asserted` — the person who chose it. */
  assertedBy: string | null;
  assertedAt: string | null;
};

/** One upload of a layer. */
export type WorkspaceGisVersion = {
  id: string;
  layerId: string;
  versionNumber: number;
  sourceFormat: WorkspaceGisSourceFormat;
  sourceFilename: string;
  sourceByteSize: number;
  /** True when this deployment retained the original file and it can be downloaded. */
  hasStoredSource: boolean;
  srs: WorkspaceGisSrs;
  reprojectionEngine: WorkspaceGisReprojectionEngine;
  /** The permanent positional caveat this version carries, or null. */
  datumShiftNote: string | null;
  datumAcknowledgedBy: string | null;
  geometryKinds: string[];
  attributeFields: WorkspaceGisAttributeField[];
  attributeEncoding: string | null;
  /** True when the encoding above was OpenPlan's fallback, not the file's own declaration. */
  attributeEncodingIsFallback: boolean;
  /** Shapes the client said it would send, after drops and after the cap. */
  declaredFeatureCount: number;
  /** Shapes that actually arrived. Equal to the declared count once ready. */
  featureCount: number;
  /** Every shape the file held, before drops and before the cap. */
  sourceFeatureCount: number;
  droppedFeatureCount: number;
  truncated: boolean;
  bbox: WorkspaceGisBbox | null;
  ingestStatus: WorkspaceGisIngestStatus;
  ingestFailureReason: WorkspaceGisIngestFailureReason | null;
  createdAt: string;
  finalizedAt: string | null;
};

/** How a layer draws. Four controls; the geometry decides fill vs line. */
export type WorkspaceGisLayerStyle = {
  /** `#rrggbb`. The legend swatch and the drawn colour are the same value. */
  color: string;
  opacity: number;
  lineWidth: number;
  /** An attribute name to label shapes by, or null for no labels (the default). */
  labelField: string | null;
};

export type WorkspaceGisLayer = {
  id: string;
  workspaceId: string;
  /** Null = agency-wide. */
  projectId: string | null;
  name: string;
  description: string | null;
  style: WorkspaceGisLayerStyle;
  defaultVisible: boolean;
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
  /** The version the maps draw, or null when no upload has finished. */
  currentVersion: WorkspaceGisVersion | null;
};

/**
 * A layer plus every caveat a surface must render with it.
 *
 * `notes` is a LIST, never a joined string, for the reason
 * `describeMapLayerCoverage` returns a list: a version can be truncated AND
 * carry a datum caveat AND have lost its label field, and appending one to
 * another lets a surface render the first and drop the rest.
 */
export type WorkspaceGisLayerListing = {
  layer: WorkspaceGisLayer;
  notes: string[];
};

// ── The chunked ingest, as a state machine ──────────────────────────────────

/**
 * What the browser declares when it opens an ingest. The server resolves the
 * CRS from `prjText` (or from the planner's assertion) and answers with the
 * version row it created; the browser then posts features against that id.
 *
 * WHY THE SERVER RESOLVES THE CRS AND NOT THE CLIENT. A client-declared CRS is
 * a client-declared claim, and this one decides where a layer lands on a map.
 * The client sends the file's own .prj TEXT — evidence, a few hundred bytes —
 * or an explicit assertion naming a registry entry, and the server decides
 * which of those it is. That is why `srsBasis` is not an input.
 */
export type WorkspaceGisIngestOpenRequest = {
  layerId: string;
  sourceFormat: WorkspaceGisSourceFormat;
  sourceFilename: string;
  sourceByteSize: number;
  /** Verbatim .prj text, when the upload carried one. */
  prjText?: string | null;
  /**
   * The authority code the PLANNER chose when the file carried no .prj
   * ("EPSG:2226"). Recorded as their assertion, with their name on it.
   */
  assertedSrsCode?: string | null;
  /** True when the planner acknowledged a datum caveat the CRS entry carries. */
  datumAcknowledged?: boolean;
  declaredFeatureCount: number;
  sourceFeatureCount: number;
  droppedFeatureCount: number;
  geometryKinds: string[];
  attributeFields: WorkspaceGisAttributeField[];
  attributeEncoding?: string | null;
  attributeEncodingIsFallback?: boolean;
  bbox?: WorkspaceGisBbox | null;
  reprojectionEngine: WorkspaceGisReprojectionEngine;
};

export type WorkspaceGisIngestOpenResponse = {
  version: WorkspaceGisVersion;
  /** How many features to put in one POST. Derived from the transport ceiling. */
  batchSize: number;
  /** Sentences the wizard must show before the planner accepts this reading of the file. */
  notes: string[];
};

export type WorkspaceGisIngestAppendRequest = {
  /** Index of this batch's FIRST feature in the source file. Makes a retry a no-op. */
  startIndex: number;
  features: unknown[];
};

export type WorkspaceGisIngestAppendResponse = {
  /** Rows actually written. Zero for a retried batch — not an error. */
  insertedCount: number;
  /** The version's running total after this batch. */
  featureCount: number;
  declaredFeatureCount: number;
};

export type WorkspaceGisIngestFinalizeResponse = {
  version: WorkspaceGisVersion;
  /** True when this finalize also moved the layer's current version. */
  becameCurrent: boolean;
};

// ── Serving ─────────────────────────────────────────────────────────────────

/**
 * What `/api/map-features/workspace-gis/[layerId]` answers.
 *
 * `tooDenseToDraw` is the member that does not exist on any other map layer,
 * and it is the point of this shape. Every other layer draws up to its cap and
 * says "showing 500 of 2,000". A parcel fabric drawn as an arbitrary 500 of
 * 214,391 shows HOLES, and a planner looking at holes in their own parcel layer
 * believes them. So above the cap this draws nothing, reports the true count,
 * and the panel says to zoom in.
 */
export type WorkspaceGisFeatureCollection = {
  type: "FeatureCollection";
  features: WorkspaceGisMapFeature[];
  returnedCount: number;
  matchedCount: number;
  droppedCount: number;
  truncated: boolean;
  limit: number;
  tooDenseToDraw: boolean;
  /** Everything the panel must say about this layer right now. */
  coverageNotes: string[];
};

export type WorkspaceGisMapFeature = {
  type: "Feature";
  id: string;
  geometry: unknown;
  properties: {
    kind: "workspace_gis_feature";
    layerId: string;
    versionId: string;
    featureIndex: number;
    /** The shape's own attributes, verbatim from the file. */
    attributes: Record<string, unknown>;
  };
};

// ── Deletion ────────────────────────────────────────────────────────────────

export const WORKSPACE_GIS_REFERENCE_KINDS = [
  "engagement_campaign",
  "report",
  "project",
] as const;
export type WorkspaceGisReferenceKind = (typeof WORKSPACE_GIS_REFERENCE_KINDS)[number];

export type WorkspaceGisLayerReference = {
  id: string;
  kind: WorkspaceGisReferenceKind;
  referenceId: string;
  label: string;
  /** An in-app link to the thing that adopted the layer, so the dialog is actionable. */
  href: string | null;
  createdAt: string;
};

/**
 * The answer to "what breaks if I delete this?" — the payload behind the delete
 * dialog, and the payload the DELETE route itself returns when it refuses.
 */
export type WorkspaceGisLayerReferencesResponse = {
  layerId: string;
  references: WorkspaceGisLayerReference[];
  /** False when something has adopted this layer. The database enforces it too. */
  deletable: boolean;
  /** The sentence shown when it is not deletable, naming what would break. */
  refusal: string | null;
};

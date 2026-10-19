import { z } from "zod";
import { CRASH_SEVERITIES } from "./vocabulary";
import { projectEstimateDecimal } from "@/lib/projects/estimated-cost";

export const SAFETY_COMPARISON_VERSION = "openplan.safety-comparison.v2";
export const SAFETY_COMPARISON_MIGRATION = "20261019120000_safety_comparison_inputs";
export const SAFETY_COMPARISON_POINTER = "safetyComparisonV2";
export const SAFETY_COMPARISON_ACQUISITION_SELECT = "id, workspace_id, project_id, evidence_revision::text, min_lon, min_lat, max_lon, max_lat, status, source_id, source_label, attribution, coverage_state, severity_completeness, years_requested, crash_count, geocoded_count, stored_count, truncated, created_at, updated_at, dimension_coverage, party_completeness, party_count, involvement_basis, published_through, published_through_provenance";
export const SAFETY_COMPARISON_PROJECT_SELECT = "id, workspace_id, updated_at, estimated_cost_amount::text, estimated_cost_currency, estimated_cost_basis_year, estimated_cost_source_document_id, estimated_cost_recorded_at";
export const SAFETY_COMPARISON_MEMBER_FIELDS = ["id", "workspace_id", "ingest_id", "source_id", "external_id", "collision_date", "collision_year", "longitude", "latitude", "severity", "pedestrian_involved", "bicyclist_involved", "motorcyclist_involved", "collision_type", "lighting", "weather"] as const;
const text = z.string().trim().min(1).max(4000);
const retainedText = z.string().min(1).max(4000);
const id = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.string().datetime({ offset: true });
export const missingFactSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unknown"), reason: text }).strict(),
  z.object({ state: z.literal("recorded"), value: text, unit: text.nullable(), source: text,
    locator: text, retainedQuotation: text, sourceUrl: z.string().url().nullable(),
    sourceDate: text.nullable(), retrievedAt: revision.nullable(), spatialTemporalScope: text, retentionBasis: text }).strict(),
]);
export const comparisonAlternativeSchema = z.object({
  id, kind: z.enum(["no_build", "treatment"]), name: text, scope: text, operatingAssumptions: text,
  treatmentDescription: text, proposedTimeRange: missingFactSchema,
  applicability: z.enum(["matched", "mismatched", "unknown", "not_applicable"]),
  applicabilityRationale: text, conditions: z.array(z.object({
    requiredCondition: text, siteFact: missingFactSchema,
    finding: z.enum(["matched", "mismatched", "unknown", "not_applicable"]), rationale: text,
  }).strict()).max(30),
  cost: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("missing"), reason: text }).strict(),
    z.object({ kind: z.literal("project_estimate"), scopeRelationship: z.enum(["context_only", "same_scope"]),
      scopeRationale: text, estimatingBasis: missingFactSchema, includedElements: missingFactSchema }).strict(),
  ]),
  effect: z.literal("unassessed"), effectReason: text,
}).strict().superRefine((alternative, ctx) => {
  if (alternative.applicability !== "unknown" && !alternative.conditions.length) ctx.addIssue({ code: "custom", message: "A finding requires sourced condition comparisons; otherwise record unknown." });
  if (alternative.applicability !== "unknown" && alternative.conditions.length) {
    const supported = alternative.conditions.filter(condition => condition.siteFact.state === "recorded");
    const findingSupported = alternative.applicability === "matched"
      ? supported.length === alternative.conditions.length && supported.every(condition => condition.finding === "matched" || condition.finding === "not_applicable") && supported.some(condition => condition.finding === "matched")
      : supported.some(condition => condition.finding === alternative.applicability);
    if (!findingSupported) ctx.addIssue({ code: "custom", message: "The overall finding requires supporting recorded conditions. A match cannot include unknown or mismatched conditions." });
  }
  for (const condition of alternative.conditions) {
    if (condition.finding !== "unknown" && condition.siteFact.state !== "recorded") ctx.addIssue({ code: "custom", message: "Matched, mismatched and not-applicable findings require a retained site fact." });
  }
});
const point = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]);
export const comparisonGeometrySchema = z.object({ type: z.literal("Polygon"),
  coordinates: z.array(z.array(point).min(4).max(500)).min(1).max(20) }).strict().superRefine((geometry, ctx) => {
  for (const ring of geometry.coordinates) {
    if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) ctx.addIssue({ code: "custom", message: "Close every polygon ring." });
    if (ring.some((p, i) => i > 0 && Math.abs(p[0] - ring[i - 1][0]) > 180)) ctx.addIssue({ code: "custom", message: "Wrapped influence polygons are unsupported in this review. Split the study explicitly." });
  }
});
export const safetyComparisonInputsSchema = z.object({
  title: text, acquisitionId: id, siteLabel: text, siteIdentity: missingFactSchema,
  influenceArea: comparisonGeometrySchema, influenceRationale: text,
  analysisGeometry: comparisonGeometrySchema,
  selectedYears: z.array(z.number().int().min(1900).max(2200)).min(1).max(100)
    .refine(v => new Set(v).size === v.length, "Years must be distinct."),
  severities: z.array(z.enum(CRASH_SEVERITIES)).min(1).max(5).refine(v => new Set(v).size === v.length),
  involvement: z.enum(["all", "pedestrian", "bicyclist", "motorcyclist"]),
  siteFacts: z.array(z.object({ name: text, fact: missingFactSchema }).strict()).max(30),
  alternatives: z.array(comparisonAlternativeSchema).min(2).max(11)
    .refine(v => v.filter(a => a.kind === "no_build").length === 1 && v.filter(a => a.kind === "treatment").length <= 10 && new Set(v.map(a => a.id)).size === v.length,
      "Record one No Build and one to ten treatment alternatives with distinct identities."),
  findings: text,
}).strict();
export type SafetyComparisonInputs = z.infer<typeof safetyComparisonInputsSchema>;
export const safetyComparisonCommandSchema = z.object({
  operation: z.enum(["save", "refresh"]), requestId: id, expectedReportRevision: revision,
  expectedProjectRevision: revision, expectedAcquisitionRevision: z.string().regex(/^[1-9]\d*$/),
  expectedComparison: z.object({ revisionId: id, hash }).strict().nullable(),
  inputs: safetyComparisonInputsSchema,
}).strict();
export type SafetyComparisonCommand = z.infer<typeof safetyComparisonCommandSchema>;
export const safetyComparisonPointerSchema = z.object({ version: z.literal(SAFETY_COMPARISON_VERSION), revisionId: id, hash }).strict();
export const safetyComparisonAcquisitionSchema = z.object({
  id, workspace_id: id, project_id: id, evidence_revision: z.string().regex(/^[1-9]\d*$/),
  min_lon: z.number().finite(), min_lat: z.number().finite(), max_lon: z.number().finite(), max_lat: z.number().finite(),
  status: z.literal("ready"), source_id: retainedText, source_label: retainedText, attribution: z.string().min(1).max(20000), coverage_state: retainedText,
  severity_completeness: retainedText, years_requested: z.array(z.number().int()).max(100),
  crash_count: z.number().int().nonnegative(), geocoded_count: z.number().int().nonnegative(), stored_count: z.number().int().nonnegative().nullable(),
  truncated: z.boolean(), created_at: revision, updated_at: revision, dimension_coverage: z.record(z.string(), z.unknown()),
  party_completeness: retainedText, party_count: z.number().int().nonnegative().nullable(), involvement_basis: retainedText.nullable(),
  published_through: z.string().nullable(), published_through_provenance: z.unknown(),
}).strict();
export const safetyComparisonCostSchema = z.object({
  alternativeId: id, originProjectId: id,
  amount: z.string().refine(value => { try { return projectEstimateDecimal(value) === value; } catch { return false; } }),
  currency: z.string().nullable(), priceYear: z.number().int().nullable(), recordedAt: revision.nullable(), recordedBy: id.nullable(),
  sourceDocument: z.object({ id, title: z.string(), checksum: z.string().nullable(), updatedAt: revision, status: z.enum(["stored", "ready"]) }).strict().nullable(),
  scopeRelationship: z.enum(["context_only", "same_scope"]), estimatingBasis: missingFactSchema, includedElements: missingFactSchema,
  precision: z.literal("retained_database_decimal_not_historical_precision_recovery"), normalizedComparison: z.literal("unassessed"),
}).strict();
export const safetyComparisonRecordSchema = z.object({
  id, workspace_id: id, project_id: id, report_id: id, parent_revision_id: id.nullable(),
  created_by: id, created_at: revision, content_hash: hash,
  content_text: z.string().min(1).max(500000),
  payload: z.object({ version: z.literal(SAFETY_COMPARISON_VERSION), inputs: safetyComparisonInputsSchema,
    source: z.object({ acquisition: safetyComparisonAcquisitionSchema, acquisitionHash: hash, projectId: id, projectName: retainedText,
      projectRevision: revision, reportRevision: revision, geometryHash: hash, analysisGeometryHash: hash,
      vocabularyVersion: z.literal("neutral-crash-storage-20260812"), catalog: z.literal("descriptive-only-no-numerical-cmf-consumed"),
      legacyDerivedFrom: z.object({ reportId: id, reportRevision: revision, note: text }).strict().nullable(),
      rawSourceHash: z.null(), rawSourceState: z.literal("unavailable"), roadContext: z.literal("unassessed_no_road_geometry_consumed"),
    }).strict(), capture: z.object({
      method: z.literal("postgis-covers-wgs84-v1"), unit: z.literal("crash"),
      projection: z.array(z.string()), membersHash: hash, stored: z.number().int().nonnegative(),
      included: z.number().int().nonnegative(), excluded: z.number().int().nonnegative(), indeterminate: z.number().int().nonnegative(),
      reasonCounts: z.record(z.string().regex(/^(included|excluded_(spatial|year|severity)|indeterminate_(year|severity|involvement))$/), z.number().int().nonnegative()),
      populationCoverage: z.literal("unassessed"), coverageReason: text,
    }).strict(), costs: z.array(safetyComparisonCostSchema).max(11),
    effect: z.literal("unassessed"), programBasis: z.literal("missing_exact_fy_nofo"),
    authorship: z.literal("human_entered_source_review"),
  }).strict(),
}).strict();
export type SafetyComparisonRecord = z.infer<typeof safetyComparisonRecordSchema>;
export const safetyComparisonReceiptSchema = z.object({
  schema: z.literal("openplan.safety-comparison-receipt.v2"), requestId: id, requestHash: hash,
  revisionId: id, contentHash: hash, reportId: id, projectId: id, workspaceId: id,
  beforeReportRevision: revision, reportRevision: revision, beforeProjectRevision: revision, projectRevision: revision,
}).strict();

/** Missing notice material refuses new notice-specific reuse, without hiding the review. */
export const SAFETY_V2_NOFO_REFUSAL = "Safety input comparison v2 recognized. Missing source: the exact selected fiscal-year SS4A NOFO, amendments and reviewed application-section mapping. Notice-specific seeding is unavailable. No eligibility determination is made.";

/** Acquisition declarations qualify stored counts; none establishes complete population coverage. */
export function describeSafetyComparisonSource(record: SafetyComparisonRecord): string {
  const raw = record.payload.source.acquisition;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "Acquisition source metadata is unavailable.";
  const a = raw as Record<string, unknown>;
  const severity = a.severity_completeness === "fatal_only" ? "Fatal crashes only; serious-injury coverage is unavailable."
    : a.severity_completeness === "fatal_injury_only" ? "The source does not separate serious injury from other injury."
    : a.severity_completeness === "kabco_full" ? "The source records distinct severity categories; classification completeness still requires review."
    : "Severity coverage is unknown.";
  const measure = (value: unknown) => typeof value === "number" ? String(value) : "unknown";
  const mismatch = typeof a.stored_count === "number" && a.stored_count !== record.payload.capture.stored ? " The recorded stored count differs from this capture; population coverage remains unassessed." : "";
  return `${typeof a.source_label === "string" ? a.source_label : "Source label unknown"}. ${severity} Acquisition metadata counts: reported ${measure(a.crash_count)}, geocoded ${measure(a.geocoded_count)}, recorded stored ${measure(a.stored_count)}. Current capture examines ${record.payload.capture.stored} stored rows.${mismatch} ${a.truncated === true ? "Source retrieval was truncated." : "An untruncated retrieval does not prove complete observation intervals."} Publication cutoff: ${typeof a.published_through === "string" ? a.published_through : "unknown"}. False involvement flags remain indeterminate without per-crash completeness. No person count is derived.`;
}

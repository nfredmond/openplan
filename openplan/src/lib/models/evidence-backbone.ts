import type { SupabaseClient } from "@supabase/supabase-js";
import type { CountyOnrampManifest } from "@/lib/models/county-onramp";

export const MODELING_EVIDENCE_TRACKS = [
  "assignment",
  "behavioral_demand",
  "multimodal_accessibility",
  "shared",
] as const;

export type ModelingEvidenceTrack = (typeof MODELING_EVIDENCE_TRACKS)[number];

export const MODELING_CLAIM_STATUSES = [
  "claim_grade_passed",
  "screening_grade",
  "prototype_only",
] as const;

export type ModelingClaimStatus = (typeof MODELING_CLAIM_STATUSES)[number];

export type ModelingValidationStatus = "pass" | "warn" | "fail";

export type ModelingValidationComparator = "lte" | "gte" | "between" | "eq" | "exists" | "manual";

export type ModelingValidationResultLike = {
  metricKey: string;
  metricLabel: string;
  status: ModelingValidationStatus;
  detail: string;
  observedValue?: number | null;
  thresholdValue?: number | null;
  thresholdMaxValue?: number | null;
  thresholdComparator?: ModelingValidationComparator;
  blocksClaimGrade?: boolean;
  sourceManifestKey?: string | null;
  metadata?: Record<string, unknown>;
};

export type ModelingClaimDecision = {
  track: ModelingEvidenceTrack;
  claimStatus: ModelingClaimStatus;
  statusReason: string;
  reasons: string[];
  validationSummary: {
    passed: number;
    warned: number;
    failed: number;
    missingRequiredMetricKeys: string[];
    requiredMetricKeys: string[];
  };
};

export type ModelingSourceManifestInput = {
  sourceKey: string;
  sourceKind:
    | "census_acs"
    | "census_tiger"
    | "lodes"
    | "gtfs"
    | "osm"
    | "caltrans_counts"
    | "mobility_database"
    | "ntd"
    | "local_public_counts"
    | "network_package"
    | "activitysim_config"
    | "manual_public"
    | "other_public";
  sourceLabel: string;
  sourceUrl?: string | null;
  sourceVintage?: string | null;
  geographyId?: string | null;
  geographyLabel?: string | null;
  checksumSha256?: string | null;
  licenseNote?: string | null;
  citationText: string;
  metadata?: Record<string, unknown>;
  ingestedAt?: string | null;
};

export type CountyRunModelingEvidenceBundle = {
  sourceManifests: ModelingSourceManifestInput[];
  validationResults: ModelingValidationResultLike[];
  claimDecision: ModelingClaimDecision;
};

export type ModelingEvidenceSupabaseLike = Pick<SupabaseClient, "from">;

export type ModelingEvidenceSnapshot = {
  claimDecision: (ModelingClaimDecision & { decidedAt: string | null }) | null;
  reportLanguage: string | null;
  sourceManifests: Array<{
    id: string;
    sourceKey: string;
    sourceKind: ModelingSourceManifestInput["sourceKind"];
    sourceLabel: string;
    sourceUrl: string | null;
    sourceVintage: string | null;
    geographyId: string | null;
    geographyLabel: string | null;
    licenseNote: string | null;
    citationText: string;
  }>;
  validationResults: Array<{
    id: string;
    track: ModelingEvidenceTrack;
    metricKey: string;
    metricLabel: string;
    observedValue: number | null;
    thresholdValue: number | null;
    thresholdMaxValue: number | null;
    thresholdComparator: ModelingValidationComparator;
    status: ModelingValidationStatus;
    blocksClaimGrade: boolean;
    detail: string;
    sourceManifestId: string | null;
    evaluatedAt: string | null;
  }>;
};

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function statusCount(results: ModelingValidationResultLike[], status: ModelingValidationStatus): number {
  return results.filter((result) => result.status === status).length;
}

export function resolveModelingClaimDecision({
  track,
  validationResults,
  requiredMetricKeys,
  prototypeReasons = [],
  screeningReasons = [],
}: {
  track: ModelingEvidenceTrack;
  validationResults: ModelingValidationResultLike[];
  requiredMetricKeys: string[];
  prototypeReasons?: string[];
  screeningReasons?: string[];
}): ModelingClaimDecision {
  const metricKeys = new Set(validationResults.map((result) => result.metricKey));
  const missingRequiredMetricKeys = requiredMetricKeys.filter((key) => !metricKeys.has(key));
  const blockingResults = validationResults.filter((result) => result.blocksClaimGrade !== false);
  const failures = blockingResults.filter((result) => result.status === "fail");
  const warnings = blockingResults.filter((result) => result.status === "warn");
  const reasons = uniqueStrings([
    ...prototypeReasons,
    ...screeningReasons,
    ...missingRequiredMetricKeys.map((key) => `Missing required validation metric: ${key}`),
    ...failures.map((result) => result.detail),
    ...warnings.map((result) => result.detail),
  ]);

  const validationSummary = {
    passed: statusCount(validationResults, "pass"),
    warned: statusCount(validationResults, "warn"),
    failed: statusCount(validationResults, "fail"),
    missingRequiredMetricKeys,
    requiredMetricKeys,
  };

  if (prototypeReasons.length > 0 || missingRequiredMetricKeys.length > 0 || validationResults.length === 0) {
    return {
      track,
      claimStatus: "prototype_only",
      statusReason:
        prototypeReasons[0] ?? "Required validation evidence is missing, so this output cannot make outward planning claims.",
      reasons: reasons.length > 0 ? reasons : ["Required validation evidence is missing."],
      validationSummary,
    };
  }

  if (failures.length > 0 || warnings.length > 0 || screeningReasons.length > 0) {
    return {
      track,
      claimStatus: "screening_grade",
      statusReason:
        failures[0]?.detail ??
        warnings[0]?.detail ??
        screeningReasons[0] ??
        "Validation evidence exists, but at least one check blocks claim-grade language.",
      reasons,
      validationSummary,
    };
  }

  return {
    track,
    claimStatus: "claim_grade_passed",
    statusReason: "All required public-data validation checks passed.",
    reasons: [],
    validationSummary,
  };
}

export function modelingClaimAllowsOutwardPlanningLanguage(decision: ModelingClaimDecision): boolean {
  return decision.claimStatus === "claim_grade_passed";
}

export function modelingClaimReportLanguage(decision: ModelingClaimDecision): string {
  if (decision.claimStatus === "claim_grade_passed") {
    return "Claim-grade public-data modeling result. Required validation checks passed; cite the source manifest and validation table with any outward planning claim.";
  }

  if (decision.claimStatus === "screening_grade") {
    return "Screening-grade modeling result. Use for planning context only, and include the validation caveats before making any outward claim.";
  }

  return "Prototype-only modeling result. Do not use for outward planning claims until required validation evidence is present.";
}

function validationResult({
  metricKey,
  metricLabel,
  observedValue,
  thresholdValue,
  thresholdMaxValue,
  thresholdComparator,
  status,
  detail,
  sourceManifestKey,
  metadata,
}: ModelingValidationResultLike): ModelingValidationResultLike {
  return {
    metricKey,
    metricLabel,
    observedValue: observedValue ?? null,
    thresholdValue: thresholdValue ?? null,
    thresholdMaxValue: thresholdMaxValue ?? null,
    thresholdComparator: thresholdComparator ?? "manual",
    status,
    detail,
    sourceManifestKey: sourceManifestKey ?? null,
    metadata: metadata ?? {},
    blocksClaimGrade: true,
  };
}

export function buildCountyRunModelingEvidenceBundle({
  workspaceId,
  countyRunId,
  manifest,
  geographyLabel,
}: {
  workspaceId: string;
  countyRunId: string;
  manifest: CountyOnrampManifest;
  geographyLabel?: string | null;
}): CountyRunModelingEvidenceBundle {
  const validation = manifest.summary.validation;
  const screeningGate = asRecord(validation?.screening_gate);
  const validationMetrics = asRecord(validation?.metrics);
  const requiredMatches = asNumber(screeningGate?.required_matches) ?? 3;
  const medianApeThreshold = asNumber(screeningGate?.ready_median_ape_threshold) ?? 30;
  const criticalApeThreshold = asNumber(screeningGate?.ready_critical_ape_threshold) ?? 50;
  const screeningGateReasons = Array.isArray(screeningGate?.reasons)
    ? screeningGate.reasons.filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0)
    : [];
  const countyLabel = geographyLabel ?? manifest.county_fips ?? manifest.county_prefix;
  const generatedYear = asString(manifest.generated_at)?.slice(0, 4) ?? null;

  const sourceManifests: ModelingSourceManifestInput[] = [
    {
      sourceKey: "census_tiger_boundary",
      sourceKind: "census_tiger",
      sourceLabel: "County boundary and tract geography",
      sourceUrl: "https://tigerweb.geo.census.gov/tigerwebmain/TIGERweb_restmapservice.html",
      sourceVintage: generatedYear,
      geographyId: manifest.county_fips,
      geographyLabel: countyLabel,
      licenseNote: "U.S. Census public data.",
      citationText: `U.S. Census TIGER/Line geography for ${countyLabel}.`,
      metadata: { countyRunId, workspaceId, countyPrefix: manifest.county_prefix },
      ingestedAt: manifest.generated_at,
    },
    {
      sourceKey: "census_acs_zone_attributes",
      sourceKind: "census_acs",
      sourceLabel: "Population, household, and worker-resident zone attributes",
      sourceUrl: "https://api.census.gov/data/2024/acs/acs5.html",
      sourceVintage: generatedYear,
      geographyId: manifest.county_fips,
      geographyLabel: countyLabel,
      licenseNote: "U.S. Census public ACS estimates.",
      citationText: `U.S. Census ACS 5-year estimates used to populate public-data zone attributes for ${countyLabel}.`,
      metadata: {
        zoneCount: manifest.summary.run.zone_count,
        populationTotal: manifest.summary.run.population_total,
        jobsTotal: manifest.summary.run.jobs_total,
      },
      ingestedAt: manifest.generated_at,
    },
    {
      sourceKey: "osm_road_network",
      sourceKind: "osm",
      sourceLabel: "OpenStreetMap roadway network",
      sourceUrl: "https://www.openstreetmap.org",
      sourceVintage: generatedYear,
      geographyId: manifest.county_fips,
      geographyLabel: countyLabel,
      licenseNote: "OpenStreetMap data is available under the Open Database License.",
      citationText: `OpenStreetMap roadway network extracted for ${countyLabel}.`,
      metadata: {
        loadedLinks: manifest.summary.run.loaded_links,
        finalGap: manifest.summary.run.final_gap,
      },
      ingestedAt: manifest.generated_at,
    },
  ];

  const countsSource = asString(validation?.counts_source_csv);
  if (countsSource) {
    sourceManifests.push({
      sourceKey: "observed_count_validation",
      sourceKind: countsSource.toLowerCase().includes("caltrans") ? "caltrans_counts" : "local_public_counts",
      sourceLabel: "Observed traffic count validation set",
      sourceUrl: countsSource,
      sourceVintage: generatedYear,
      geographyId: manifest.county_fips,
      geographyLabel: countyLabel,
      licenseNote: "Public observed-count source; verify agency terms before publication.",
      citationText: `Observed traffic count validation set used to compare modeled assignment volumes for ${countyLabel}.`,
      metadata: {
        stationsTotal: validation?.stations_total ?? null,
        stationsMatched: validation?.stations_matched ?? null,
      },
      ingestedAt: manifest.generated_at,
    });
  }

  const validationResults: ModelingValidationResultLike[] = [];
  const finalGap = manifest.summary.run.final_gap;
  if (typeof finalGap === "number") {
    validationResults.push(
      validationResult({
        metricKey: "assignment_final_gap",
        metricLabel: "Assignment final gap",
        observedValue: finalGap,
        thresholdValue: 0.01,
        thresholdMaxValue: 0.05,
        thresholdComparator: "lte",
        status: finalGap <= 0.01 ? "pass" : finalGap <= 0.05 ? "warn" : "fail",
        detail:
          finalGap <= 0.01
            ? "Assignment converged within the claim-grade final-gap threshold."
            : `Assignment final gap ${finalGap} exceeds the claim-grade threshold of 0.01.`,
        sourceManifestKey: "osm_road_network",
      })
    );
  }

  const stationsMatched = asNumber(validation?.stations_matched);
  if (stationsMatched !== null) {
    validationResults.push(
      validationResult({
        metricKey: "count_station_matches",
        metricLabel: "Observed count stations matched",
        observedValue: stationsMatched,
        thresholdValue: requiredMatches,
        thresholdComparator: "gte",
        status: stationsMatched >= requiredMatches ? "pass" : "fail",
        detail:
          stationsMatched >= requiredMatches
            ? `${stationsMatched} observed count stations matched, meeting the required minimum of ${requiredMatches}.`
            : `${stationsMatched} observed count stations matched, below the required minimum of ${requiredMatches}.`,
        sourceManifestKey: "observed_count_validation",
      })
    );
  }

  const medianApe = asNumber(validationMetrics?.median_absolute_percent_error);
  if (medianApe !== null) {
    validationResults.push(
      validationResult({
        metricKey: "median_absolute_percent_error",
        metricLabel: "Median absolute percent error",
        observedValue: medianApe,
        thresholdValue: medianApeThreshold,
        thresholdMaxValue: medianApeThreshold * 1.5,
        thresholdComparator: "lte",
        status: medianApe <= medianApeThreshold ? "pass" : medianApe <= medianApeThreshold * 1.5 ? "warn" : "fail",
        detail:
          medianApe <= medianApeThreshold
            ? `Median APE ${medianApe}% meets the ${medianApeThreshold}% threshold.`
            : `Median APE ${medianApe}% exceeds the ${medianApeThreshold}% claim-grade threshold.`,
        sourceManifestKey: "observed_count_validation",
      })
    );
  }

  const criticalApe = asNumber(validationMetrics?.max_absolute_percent_error);
  if (criticalApe !== null) {
    validationResults.push(
      validationResult({
        metricKey: "critical_absolute_percent_error",
        metricLabel: "Critical facility absolute percent error",
        observedValue: criticalApe,
        thresholdValue: criticalApeThreshold,
        thresholdComparator: "lte",
        status: criticalApe <= criticalApeThreshold ? "pass" : "fail",
        detail:
          criticalApe <= criticalApeThreshold
            ? `Worst matched facility APE ${criticalApe}% stays within the ${criticalApeThreshold}% threshold.`
            : `Worst matched facility APE ${criticalApe}% exceeds the ${criticalApeThreshold}% claim-grade threshold.`,
        sourceManifestKey: "observed_count_validation",
      })
    );
  }

  const spearman = asNumber(validationMetrics?.spearman_rho_facility_ranking);
  if (spearman !== null) {
    validationResults.push(
      validationResult({
        metricKey: "facility_ranking_spearman_rho",
        metricLabel: "Facility ranking Spearman rho",
        observedValue: spearman,
        thresholdValue: 0.7,
        thresholdMaxValue: 0.4,
        thresholdComparator: "gte",
        status: spearman >= 0.7 ? "pass" : spearman >= 0.4 ? "warn" : "fail",
        detail:
          spearman >= 0.7
            ? `Facility ranking correlation ${spearman} meets the claim-grade threshold.`
            : `Facility ranking correlation ${spearman} is below the 0.7 claim-grade threshold.`,
        sourceManifestKey: "observed_count_validation",
      })
    );
  }

  const claimDecision = resolveModelingClaimDecision({
    track: "assignment",
    validationResults,
    requiredMetricKeys: [
      "assignment_final_gap",
      "count_station_matches",
      "median_absolute_percent_error",
      "critical_absolute_percent_error",
    ],
    screeningReasons: screeningGateReasons,
  });

  return { sourceManifests, validationResults, claimDecision };
}

export function isModelingEvidenceSchemaMissing(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache|PGRST205/i.test(message ?? "");
}

function toDbSourceManifestRow(params: {
  workspaceId: string;
  countyRunId: string;
  manifest: ModelingSourceManifestInput;
}) {
  return {
    workspace_id: params.workspaceId,
    county_run_id: params.countyRunId,
    model_run_id: null,
    source_key: params.manifest.sourceKey,
    source_kind: params.manifest.sourceKind,
    source_label: params.manifest.sourceLabel,
    source_url: params.manifest.sourceUrl ?? null,
    source_vintage: params.manifest.sourceVintage ?? null,
    geography_id: params.manifest.geographyId ?? null,
    geography_label: params.manifest.geographyLabel ?? null,
    checksum_sha256: params.manifest.checksumSha256 ?? null,
    license_note: params.manifest.licenseNote ?? null,
    citation_text: params.manifest.citationText,
    metadata_json: params.manifest.metadata ?? {},
    ingested_at: params.manifest.ingestedAt ?? null,
  };
}

export async function refreshCountyRunModelingEvidence({
  supabase,
  workspaceId,
  countyRunId,
  manifest,
  geographyLabel,
}: {
  supabase: ModelingEvidenceSupabaseLike;
  workspaceId: string;
  countyRunId: string;
  manifest: CountyOnrampManifest;
  geographyLabel?: string | null;
}): Promise<{
  bundle: CountyRunModelingEvidenceBundle;
  insertedSourceManifestCount: number;
  insertedValidationResultCount: number;
  error: { message: string; code?: string | null; missingSchema?: boolean } | null;
}> {
  const bundle = buildCountyRunModelingEvidenceBundle({ workspaceId, countyRunId, manifest, geographyLabel });
  const track = bundle.claimDecision.track;

  for (const table of ["modeling_validation_results", "modeling_claim_decisions"]) {
    const deleteResult = await supabase.from(table).delete().eq("county_run_id", countyRunId).eq("track", track);
    if (deleteResult.error) {
      return {
        bundle,
        insertedSourceManifestCount: 0,
        insertedValidationResultCount: 0,
        error: {
          message: deleteResult.error.message,
          code: deleteResult.error.code ?? null,
          missingSchema: isModelingEvidenceSchemaMissing(deleteResult.error.message),
        },
      };
    }
  }

  const sourceInsertResult = await supabase
    .from("modeling_source_manifests")
    .upsert(
      bundle.sourceManifests.map((sourceManifest) => toDbSourceManifestRow({ workspaceId, countyRunId, manifest: sourceManifest })),
      { onConflict: "county_run_id,source_key" }
    )
    .select("id, source_key");

  if (sourceInsertResult.error) {
    return {
      bundle,
      insertedSourceManifestCount: 0,
      insertedValidationResultCount: 0,
      error: {
        message: sourceInsertResult.error.message,
        code: sourceInsertResult.error.code ?? null,
        missingSchema: isModelingEvidenceSchemaMissing(sourceInsertResult.error.message),
      },
    };
  }

  const sourceIdsByKey = new Map(
    ((sourceInsertResult.data ?? []) as Array<{ id: string; source_key: string }>).map((row) => [row.source_key, row.id])
  );

  const validationRows = bundle.validationResults.map((result) => ({
    workspace_id: workspaceId,
    county_run_id: countyRunId,
    model_run_id: null,
    source_manifest_id: result.sourceManifestKey ? sourceIdsByKey.get(result.sourceManifestKey) ?? null : null,
    track: "assignment",
    metric_key: result.metricKey,
    metric_label: result.metricLabel,
    observed_value: result.observedValue ?? null,
    threshold_value: result.thresholdValue ?? null,
    threshold_max_value: result.thresholdMaxValue ?? null,
    threshold_comparator: result.thresholdComparator ?? "manual",
    status: result.status,
    blocks_claim_grade: result.blocksClaimGrade ?? true,
    detail: result.detail,
    metadata_json: result.metadata ?? {},
    evaluated_at: manifest.generated_at,
  }));

  if (validationRows.length > 0) {
    const validationInsertResult = await supabase.from("modeling_validation_results").insert(validationRows);
    if (validationInsertResult.error) {
      return {
        bundle,
        insertedSourceManifestCount: sourceIdsByKey.size,
        insertedValidationResultCount: 0,
        error: {
          message: validationInsertResult.error.message,
          code: validationInsertResult.error.code ?? null,
          missingSchema: isModelingEvidenceSchemaMissing(validationInsertResult.error.message),
        },
      };
    }
  }

  const claimInsertResult = await supabase.from("modeling_claim_decisions").insert({
    workspace_id: workspaceId,
    county_run_id: countyRunId,
    model_run_id: null,
    track: bundle.claimDecision.track,
    claim_status: bundle.claimDecision.claimStatus,
    status_reason: bundle.claimDecision.statusReason,
    reasons_json: bundle.claimDecision.reasons,
    validation_summary_json: bundle.claimDecision.validationSummary,
    decided_at: manifest.generated_at,
  });

  if (claimInsertResult.error) {
    return {
      bundle,
      insertedSourceManifestCount: sourceIdsByKey.size,
      insertedValidationResultCount: validationRows.length,
      error: {
        message: claimInsertResult.error.message,
        code: claimInsertResult.error.code ?? null,
        missingSchema: isModelingEvidenceSchemaMissing(claimInsertResult.error.message),
      },
    };
  }

  return {
    bundle,
    insertedSourceManifestCount: sourceIdsByKey.size,
    insertedValidationResultCount: validationRows.length,
    error: null,
  };
}

function evidenceLoadError(error: { message: string; code?: string | null }) {
  return {
    message: error.message,
    code: error.code ?? null,
    missingSchema: isModelingEvidenceSchemaMissing(error.message),
  };
}

export async function loadCountyRunModelingEvidence({
  supabase,
  countyRunId,
  track = "assignment",
}: {
  supabase: ModelingEvidenceSupabaseLike;
  countyRunId: string;
  track?: ModelingEvidenceTrack;
}): Promise<{
  evidence: ModelingEvidenceSnapshot | null;
  error: { message: string; code?: string | null; missingSchema?: boolean } | null;
}> {
  const claimResult = await supabase
    .from("modeling_claim_decisions")
    .select("track, claim_status, status_reason, reasons_json, validation_summary_json, decided_at")
    .eq("county_run_id", countyRunId)
    .eq("track", track)
    .maybeSingle();

  if (claimResult.error) {
    return { evidence: null, error: evidenceLoadError(claimResult.error) };
  }

  const sourcesResult = await supabase
    .from("modeling_source_manifests")
    .select(
      "id, source_key, source_kind, source_label, source_url, source_vintage, geography_id, geography_label, license_note, citation_text"
    )
    .eq("county_run_id", countyRunId)
    .order("created_at", { ascending: true });

  if (sourcesResult.error) {
    return { evidence: null, error: evidenceLoadError(sourcesResult.error) };
  }

  const validationsResult = await supabase
    .from("modeling_validation_results")
    .select(
      "id, track, metric_key, metric_label, observed_value, threshold_value, threshold_max_value, threshold_comparator, status, blocks_claim_grade, detail, source_manifest_id, evaluated_at"
    )
    .eq("county_run_id", countyRunId)
    .eq("track", track)
    .order("created_at", { ascending: true });

  if (validationsResult.error) {
    return { evidence: null, error: evidenceLoadError(validationsResult.error) };
  }

  const claimRow = claimResult.data as
    | {
        track: ModelingEvidenceTrack;
        claim_status: ModelingClaimStatus;
        status_reason: string;
        reasons_json: unknown;
        validation_summary_json: ModelingClaimDecision["validationSummary"];
        decided_at: string | null;
      }
    | null;
  const claimDecision: ModelingEvidenceSnapshot["claimDecision"] = claimRow
    ? {
        track: claimRow.track,
        claimStatus: claimRow.claim_status,
        statusReason: claimRow.status_reason,
        reasons: Array.isArray(claimRow.reasons_json)
          ? claimRow.reasons_json.filter((reason): reason is string => typeof reason === "string")
          : [],
        validationSummary: claimRow.validation_summary_json,
        decidedAt: claimRow.decided_at,
      }
    : null;

  const sourceManifests = ((sourcesResult.data ?? []) as Array<{
    id: string;
    source_key: string;
    source_kind: ModelingSourceManifestInput["sourceKind"];
    source_label: string;
    source_url: string | null;
    source_vintage: string | null;
    geography_id: string | null;
    geography_label: string | null;
    license_note: string | null;
    citation_text: string;
  }>).map((source) => ({
    id: source.id,
    sourceKey: source.source_key,
    sourceKind: source.source_kind,
    sourceLabel: source.source_label,
    sourceUrl: source.source_url,
    sourceVintage: source.source_vintage,
    geographyId: source.geography_id,
    geographyLabel: source.geography_label,
    licenseNote: source.license_note,
    citationText: source.citation_text,
  }));

  const validationResults = ((validationsResult.data ?? []) as Array<{
    id: string;
    track: ModelingEvidenceTrack;
    metric_key: string;
    metric_label: string;
    observed_value: number | null;
    threshold_value: number | null;
    threshold_max_value: number | null;
    threshold_comparator: ModelingValidationComparator;
    status: ModelingValidationStatus;
    blocks_claim_grade: boolean;
    detail: string;
    source_manifest_id: string | null;
    evaluated_at: string | null;
  }>).map((result) => ({
    id: result.id,
    track: result.track,
    metricKey: result.metric_key,
    metricLabel: result.metric_label,
    observedValue: result.observed_value,
    thresholdValue: result.threshold_value,
    thresholdMaxValue: result.threshold_max_value,
    thresholdComparator: result.threshold_comparator,
    status: result.status,
    blocksClaimGrade: result.blocks_claim_grade,
    detail: result.detail,
    sourceManifestId: result.source_manifest_id,
    evaluatedAt: result.evaluated_at,
  }));

  return {
    evidence: {
      claimDecision,
      reportLanguage: claimDecision ? modelingClaimReportLanguage(claimDecision) : null,
      sourceManifests,
      validationResults,
    },
    error: null,
  };
}

const SUPPORTED_COMPARISON_SCHEMA = "openplan.corridor_agreement.v2";
const SUPPORTED_ASSIGNMENT_PROFILE_SCHEMA = "openplan.assignment-profile.v1";
const SUPPORTED_ASSIGNMENT_PROFILE_ID = "aequilibrae-bfw-bpr-tight-v1";
const SUPPORTED_NETWORK_SETTINGS_SCHEMA = "openplan.network-calibration.v1";
const SUPPORTED_NETWORK_STATE_SCHEMA = "openplan.assignment-network-state.v1";
const SUPPORTED_RETAINED_NETWORK_SCHEMA = "openplan.retained-network-manifest.v1";
const CONSUMER_MAX_LINK_GAP = 0.001;
const PROFILE_MAX_TARGET_GAP = 0.0005;
const PROFILE_MIN_ITERATIONS = 3_000;
const GEH_ROUNDING_TOLERANCE = 0.000_500_001;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const AGREEMENT_VERIFICATION_HEADERS = {
  artifact: "x-openplan-artifact-sha256",
  assignmentProfile: "x-openplan-assignment-profile-sha256",
  networkSettings: "x-openplan-network-settings-sha256",
  networkState: "x-openplan-network-state-sha256",
} as const;

const ASSIGNMENT_PROFILE_KEYS = [
  "algorithm",
  "capacity_field",
  "class_pce",
  "cores",
  "engine",
  "engine_version",
  "max_iterations",
  "profile_id",
  "schema_version",
  "target_gap",
  "time_field",
  "vdf",
  "vdf_parameters",
] as const;

const NETWORK_STATE_KEYS = [
  "schema_version",
  "network_settings_digest",
  "assignment_centroid_count",
  "assignment_centroid_order_digest",
  "block_centroid_flows",
  "penalty_through_centroids",
  "cost_field",
  "capacity_field",
  "graph_row_count",
  "graph_rows_digest",
  "graph_float_dtype",
  "graph_cost_digest",
  "graph_cost_dtype",
  "compact_cost_digest",
  "compact_cost_dtype",
  "solver_free_flow_tt_digest",
  "solver_free_flow_tt_dtype",
  "solver_capacity_digest",
  "solver_capacity_dtype",
  "retained_network_digest",
  "retained_network_manifest",
] as const;

const RETAINED_NETWORK_KEYS = [
  "schema_version",
  "all_link_count",
  "all_link_ids_digest",
  "roadway_link_count",
  "roadway_link_ids_digest",
  "modeling_connector_link_count",
  "modeling_connector_link_ids_digest",
  "excluded_roles",
  "role_definition",
] as const;

const METADATA_KEYS = [
  "schema_version",
  "methods",
  "summary",
  "settings",
  "retained_network_manifest",
  "network_state_digest",
  "excluded_modeling_connectors",
  "network_alignment",
  "network_consistency",
  "attribution_is_supportable",
  "attributable_at",
  "assignment_convergence",
  "assignment_noise_floor",
  "geometry_alignment",
  "what_this_is_not",
] as const;

export type DemandAgreementWithholdingReason =
  | "convergence_missing"
  | "convergence_too_loose"
  | "convergence_inconsistent"
  | "assignment_settings_unverified"
  | "network_identity_unverified"
  | "attribution_unverified"
  | "unsupported_schema"
  | "invalid_artifact";

export type DemandAgreementVerification = {
  artifactSha256: string;
  assignmentProfileSha256: string;
  networkSettingsSha256: string;
  networkStateSha256: string;
};

export type DemandAgreementFeatureProperties = {
  link_id: number;
  name?: string;
  link_type?: string;
  agreement: "agree" | "marginal" | "diverge";
  first_volume: number;
  second_volume: number;
  geh: number;
  carries_meaningful_traffic: boolean;
  [key: string]: unknown;
};

export type RetainedNetworkManifest = Record<string, unknown> & {
  schema_version: "openplan.retained-network-manifest.v1";
  all_link_count: number;
  all_link_ids_digest: string;
  roadway_link_count: number;
  roadway_link_ids_digest: string;
  modeling_connector_link_count: number;
  modeling_connector_link_ids_digest: string;
};

export type DemandAgreementEvidence = {
  assignmentProfile: Record<string, unknown>;
  assignmentProfilePayloadJson: string;
  assignmentProfileDigest: string;
  networkSettings: Record<string, unknown>;
  networkSettingsPayloadJson: string;
  networkSettingsDigest: string;
  networkStateRecord: Record<string, unknown>;
  networkStateDigest: string;
  retainedNetworkManifest: RetainedNetworkManifest;
  roadwayLinkIds: number[];
  convergenceGaps: { first: number | null; second: number | null };
};

export type DemandAgreementCustody = {
  artifact: RenderableDemandAgreementArtifact;
  methods: { first: string; second: string };
  evidence: DemandAgreementEvidence;
};

export type RenderableDemandAgreementArtifact = GeoJSON.FeatureCollection<
  GeoJSON.LineString | GeoJSON.MultiLineString,
  DemandAgreementFeatureProperties
>;

export type DemandAgreementArtifactDecision =
  | {
      status: "render_links";
      artifact: DemandAgreementCustody["artifact"];
      methods: DemandAgreementCustody["methods"];
      evidence: DemandAgreementCustody["evidence"];
    }
  | {
      status: "withhold_links";
      reason: DemandAgreementWithholdingReason;
      plannerMessage: string;
      custody?: DemandAgreementCustody;
    };

const WITHHOLDING_MESSAGES: Record<DemandAgreementWithholdingReason, string> = {
  convergence_missing:
    "Individual road links are not shown because one or both assignments have no recorded convergence result. Corridor-level results remain available in this run's downloadable comparison artifacts.",
  convergence_too_loose:
    "Individual road links are not shown because the assignments did not converge tightly enough for a link-level comparison. Corridor-level results remain available in this run's downloadable comparison artifacts.",
  convergence_inconsistent:
    "Individual road links are not shown because this artifact's convergence record is internally inconsistent. The comparison artifacts remain available for review, but OpenPlan will not draw link-level differences from that record.",
  assignment_settings_unverified:
    "Individual road links are not shown because this artifact does not prove that both assignments used the same complete assignment method. The comparison artifacts remain available for review, but OpenPlan will not attribute link-level differences to the demand models.",
  network_identity_unverified:
    "Individual road links are not shown because this artifact does not prove that both assignments used the same retained network and network settings. The comparison artifacts remain available for review.",
  attribution_unverified:
    "Individual road links are not shown because the combined comparison record does not support demand-model attribution at link level. The comparison artifacts remain available for review.",
  unsupported_schema:
    "Individual road links are not shown because this agreement artifact uses a format this OpenPlan version cannot verify. The comparison artifacts remain available for review.",
  invalid_artifact:
    "Individual road links are not shown because the agreement artifact is incomplete or contains invalid link geometry or values. The other run artifacts remain available for review.",
};

export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function jsonValuesEqual(first: unknown, second: unknown): boolean {
  if (first === second) return true;
  if (Array.isArray(first) || Array.isArray(second)) {
    return (
      Array.isArray(first) &&
      Array.isArray(second) &&
      first.length === second.length &&
      first.every((entry, index) => jsonValuesEqual(entry, second[index]))
    );
  }
  if (isJsonRecord(first) || isJsonRecord(second)) {
    if (!isJsonRecord(first) || !isJsonRecord(second)) return false;
    const firstKeys = Object.keys(first).sort();
    const secondKeys = Object.keys(second).sort();
    return (
      firstKeys.length === secondKeys.length &&
      firstKeys.every(
        (key, index) => key === secondKeys[index] && jsonValuesEqual(first[key], second[key]),
      )
    );
  }
  return false;
}

/** Python-compatible for the validated integer/string/bool network-state record. */
export function sortedCompactJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedCompactJson).join(",")}]`;
  if (isJsonRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${sortedCompactJson(value[key])}`)
      .join(",")}}`;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isSafeInteger(value))
  ) {
    return JSON.stringify(value);
  }
  throw new TypeError("The network-state record contains non-portable JSON");
}

function withhold(
  reason: DemandAgreementWithholdingReason,
  custody?: DemandAgreementCustody,
): DemandAgreementArtifactDecision {
  return {
    status: "withhold_links",
    reason,
    plannerMessage: WITHHOLDING_MESSAGES[reason],
    ...(custody ? { custody } : {}),
  };
}

function isFiniteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isVerification(value: unknown): value is DemandAgreementVerification {
  return (
    isJsonRecord(value) &&
    isSha256(value.artifactSha256) &&
    isSha256(value.assignmentProfileSha256) &&
    isSha256(value.networkSettingsSha256) &&
    isSha256(value.networkStateSha256)
  );
}

function isPosition(value: unknown): value is GeoJSON.Position {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) return false;
  if (!value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))) {
    return false;
  }
  const [longitude, latitude] = value;
  return longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90;
}

function isLineCoordinates(value: unknown): value is GeoJSON.Position[] {
  return Array.isArray(value) && value.length >= 2 && value.every(isPosition);
}

function isRenderableGeometry(
  value: unknown,
): value is GeoJSON.LineString | GeoJSON.MultiLineString {
  if (!isJsonRecord(value)) return false;
  if (value.type === "LineString") return isLineCoordinates(value.coordinates);
  return (
    value.type === "MultiLineString" &&
    Array.isArray(value.coordinates) &&
    value.coordinates.length > 0 &&
    value.coordinates.every(isLineCoordinates)
  );
}

function agreementForGeh(geh: number): DemandAgreementFeatureProperties["agreement"] {
  if (geh < 5) return "agree";
  if (geh < 10) return "marginal";
  return "diverge";
}

function computedGeh(first: number, second: number): number {
  const total = first + second;
  return total <= 0 ? 0 : Math.sqrt((2 * (first - second) ** 2) / total);
}

function isAgreementProperties(
  value: unknown,
  minimumVolume: number,
): value is DemandAgreementFeatureProperties {
  if (!isJsonRecord(value)) return false;
  if (
    !Number.isSafeInteger(value.link_id) ||
    typeof value.link_id !== "number" ||
    value.link_id <= 0 ||
    !isFiniteNonnegative(value.first_volume) ||
    !isFiniteNonnegative(value.second_volume) ||
    !isFiniteNonnegative(value.geh) ||
    Math.abs(computedGeh(value.first_volume, value.second_volume) - value.geh) >
      GEH_ROUNDING_TOLERANCE ||
    value.agreement !== agreementForGeh(value.geh) ||
    value.carries_meaningful_traffic !==
      (Math.max(value.first_volume, value.second_volume) >= minimumVolume) ||
    value.comparison_available !== true
  ) {
    return false;
  }
  if (value.name !== undefined && typeof value.name !== "string") return false;
  if (value.link_type !== undefined && typeof value.link_type !== "string") return false;
  return true;
}

function isAssignmentProfile(value: unknown): value is Record<string, unknown> {
  if (!isJsonRecord(value) || !hasExactKeys(value, ASSIGNMENT_PROFILE_KEYS)) return false;
  const vdfParameters = value.vdf_parameters;
  return (
    value.schema_version === SUPPORTED_ASSIGNMENT_PROFILE_SCHEMA &&
    value.profile_id === SUPPORTED_ASSIGNMENT_PROFILE_ID &&
    value.engine === "aequilibrae" &&
    isNonemptyString(value.engine_version) &&
    value.algorithm === "bfw" &&
    value.vdf === "BPR" &&
    isJsonRecord(vdfParameters) &&
    hasExactKeys(vdfParameters, ["alpha", "beta"]) &&
    vdfParameters.alpha === 0.15 &&
    vdfParameters.beta === 4 &&
    isNonemptyString(value.capacity_field) &&
    isNonemptyString(value.time_field) &&
    value.class_pce === 1 &&
    isSafeNonnegativeInteger(value.cores) &&
    value.cores >= 1 &&
    isFinitePositive(value.target_gap) &&
    value.target_gap <= PROFILE_MAX_TARGET_GAP &&
    isSafeNonnegativeInteger(value.max_iterations) &&
    value.max_iterations >= PROFILE_MIN_ITERATIONS
  );
}

function parsePayloadRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isNetworkSettings(value: unknown): value is Record<string, unknown> {
  if (
    !isJsonRecord(value) ||
    !hasExactKeys(value, ["schema_version", "road_class_factors", "application", "excludes"]) ||
    value.schema_version !== SUPPORTED_NETWORK_SETTINGS_SCHEMA ||
    !isJsonRecord(value.road_class_factors) ||
    !isJsonRecord(value.application) ||
    !hasExactKeys(value.application, ["capacity", "travel_time"]) ||
    value.application.capacity !== "baseline_capacity * factor" ||
    value.application.travel_time !== "baseline_travel_time / factor" ||
    !jsonValuesEqual(value.excludes, ["trip_based_od_adjustments"])
  ) {
    return false;
  }
  return Object.entries(value.road_class_factors).every(
    ([roadClass, factor]) => roadClass.trim().length > 0 && isFinitePositive(factor),
  );
}

function isRetainedNetworkManifest(value: unknown): value is RetainedNetworkManifest {
  if (!isJsonRecord(value) || !hasExactKeys(value, RETAINED_NETWORK_KEYS)) return false;
  if (
    value.schema_version !== SUPPORTED_RETAINED_NETWORK_SCHEMA ||
    !isSafeNonnegativeInteger(value.all_link_count) ||
    !isSafeNonnegativeInteger(value.roadway_link_count) ||
    !isSafeNonnegativeInteger(value.modeling_connector_link_count) ||
    value.all_link_count < 1 ||
    value.roadway_link_count < 1 ||
    value.all_link_count !== value.roadway_link_count + value.modeling_connector_link_count ||
    !isSha256(value.all_link_ids_digest) ||
    !isSha256(value.roadway_link_ids_digest) ||
    !isSha256(value.modeling_connector_link_ids_digest) ||
    !jsonValuesEqual(value.excluded_roles, ["modeling_connector"]) ||
    !jsonValuesEqual(value.role_definition, {
      modeling_connector: "link_type = centroid_connector",
      roadway: "link_type != centroid_connector",
    })
  ) {
    return false;
  }
  return true;
}

function isCanonicalPenalty(value: unknown): boolean {
  return (
    value === "positive_infinity" ||
    (typeof value === "string" &&
      /^(?:0x0\.0p\+0|0x[01]\.[0-9a-f]{13}p[+-](?:0|[1-9][0-9]*))$/.test(value))
  );
}

function isNetworkState(
  value: unknown,
  networkSettingsDigest: string,
): value is Record<string, unknown> {
  if (!isJsonRecord(value) || !hasExactKeys(value, NETWORK_STATE_KEYS)) return false;
  const digestKeys = [
    "network_settings_digest",
    "assignment_centroid_order_digest",
    "graph_rows_digest",
    "graph_cost_digest",
    "compact_cost_digest",
    "solver_free_flow_tt_digest",
    "solver_capacity_digest",
    "retained_network_digest",
  ];
  const stringKeys = [
    "cost_field",
    "capacity_field",
    "graph_float_dtype",
    "graph_cost_dtype",
    "compact_cost_dtype",
    "solver_free_flow_tt_dtype",
    "solver_capacity_dtype",
  ];
  return (
    value.schema_version === SUPPORTED_NETWORK_STATE_SCHEMA &&
    value.network_settings_digest === networkSettingsDigest &&
    digestKeys.every((key) => isSha256(value[key])) &&
    isSafeNonnegativeInteger(value.assignment_centroid_count) &&
    value.assignment_centroid_count >= 1 &&
    isSafeNonnegativeInteger(value.graph_row_count) &&
    value.graph_row_count >= 1 &&
    typeof value.block_centroid_flows === "boolean" &&
    isCanonicalPenalty(value.penalty_through_centroids) &&
    stringKeys.every((key) => isNonemptyString(value[key])) &&
    isRetainedNetworkManifest(value.retained_network_manifest)
  );
}

function hasExactLinkAttribution(value: unknown): boolean {
  return jsonValuesEqual(value, ["corridor", "link"]);
}

function profileEvidence(
  convergence: Record<string, unknown>,
  networkEvidence: Record<string, unknown>,
  verification: DemandAgreementVerification,
): Pick<
  DemandAgreementEvidence,
  "assignmentProfile" | "assignmentProfilePayloadJson" | "assignmentProfileDigest"
> | null {
  const profiles = convergence.assignment_profiles;
  const payloads = convergence.assignment_profile_payloads;
  const digests = convergence.assignment_profile_digests;
  const embeddedEvidence = convergence.assignment_profile_evidence;
  const repeatedEvidence = networkEvidence.assignment_profiles;
  if (
    !isJsonRecord(profiles) ||
    !hasExactKeys(profiles, ["first", "second"]) ||
    !isAssignmentProfile(profiles.first) ||
    !isAssignmentProfile(profiles.second) ||
    !jsonValuesEqual(profiles.first, profiles.second) ||
    !isJsonRecord(payloads) ||
    !hasExactKeys(payloads, ["first", "second"]) ||
    typeof payloads.first !== "string" ||
    payloads.first !== payloads.second ||
    !isJsonRecord(digests) ||
    !hasExactKeys(digests, ["first", "second"]) ||
    digests.first !== verification.assignmentProfileSha256 ||
    digests.second !== verification.assignmentProfileSha256 ||
    !isJsonRecord(embeddedEvidence) ||
    !isJsonRecord(repeatedEvidence)
  ) {
    return null;
  }
  const parsedFirst = parsePayloadRecord(payloads.first);
  const parsedSecond = parsePayloadRecord(payloads.second);
  if (
    !parsedFirst ||
    !parsedSecond ||
    !isAssignmentProfile(parsedFirst) ||
    !isAssignmentProfile(parsedSecond) ||
    !jsonValuesEqual(parsedFirst, profiles.first) ||
    !jsonValuesEqual(parsedSecond, profiles.second)
  ) {
    return null;
  }
  for (const evidenceSet of [embeddedEvidence, repeatedEvidence]) {
    for (const side of ["first", "second"] as const) {
      const item = evidenceSet[side];
      if (
        !isJsonRecord(item) ||
        item.verification_state !== "verified" ||
        item.reason !== null ||
        !jsonValuesEqual(item.profile, profiles[side]) ||
        item.payload_json !== payloads[side] ||
        item.digest !== digests[side]
      ) {
        return null;
      }
    }
  }
  return {
    assignmentProfile: profiles.first,
    assignmentProfilePayloadJson: payloads.first,
    assignmentProfileDigest: verification.assignmentProfileSha256,
  };
}

function networkSettingsEvidence(
  networkEvidence: Record<string, unknown>,
  verification: DemandAgreementVerification,
): Pick<
  DemandAgreementEvidence,
  "networkSettings" | "networkSettingsPayloadJson" | "networkSettingsDigest"
> | null {
  const settingsBySide = networkEvidence.network_settings;
  if (!isJsonRecord(settingsBySide)) return null;
  const verified: Array<{ settings: Record<string, unknown>; payload: string }> = [];
  for (const side of ["first", "second"] as const) {
    const item = settingsBySide[side];
    if (
      !isJsonRecord(item) ||
      item.state !== "verified" ||
      item.reason !== null ||
      !isNetworkSettings(item.settings) ||
      typeof item.payload_json !== "string" ||
      item.digest !== verification.networkSettingsSha256 ||
      item.recorded_payload_json !== item.payload_json ||
      item.recorded_digest !== item.digest
    ) {
      return null;
    }
    const parsed = parsePayloadRecord(item.payload_json);
    if (!parsed || !isNetworkSettings(parsed) || !jsonValuesEqual(parsed, item.settings)) return null;
    verified.push({ settings: item.settings, payload: item.payload_json });
  }
  if (
    verified[0].payload !== verified[1].payload ||
    !jsonValuesEqual(verified[0].settings, verified[1].settings)
  ) {
    return null;
  }
  return {
    networkSettings: verified[0].settings,
    networkSettingsPayloadJson: verified[0].payload,
    networkSettingsDigest: verification.networkSettingsSha256,
  };
}

function networkStateEvidence(
  networkEvidence: Record<string, unknown>,
  manifest: RetainedNetworkManifest,
  verification: DemandAgreementVerification,
): Pick<DemandAgreementEvidence, "networkStateRecord" | "networkStateDigest"> | null {
  const states = networkEvidence.network_states;
  if (!isJsonRecord(states)) return null;
  const verified: Record<string, unknown>[] = [];
  for (const side of ["first", "second"] as const) {
    const item = states[side];
    if (
      !isJsonRecord(item) ||
      item.state !== "verified" ||
      item.reason !== null ||
      !isNetworkState(item.record, verification.networkSettingsSha256) ||
      item.digest !== verification.networkStateSha256 ||
      !jsonValuesEqual(item.manifest, manifest) ||
      !jsonValuesEqual(item.record.retained_network_manifest, manifest) ||
      !jsonValuesEqual(item.recorded_record, item.record) ||
      item.recorded_digest !== item.digest
    ) {
      return null;
    }
    verified.push(item.record);
  }
  if (!jsonValuesEqual(verified[0], verified[1])) return null;
  return { networkStateRecord: verified[0], networkStateDigest: verification.networkStateSha256 };
}

function networkCoverageIsExact(
  metadata: Record<string, unknown>,
  networkEvidence: Record<string, unknown>,
  manifest: RetainedNetworkManifest,
  featureCount: number,
  verification: DemandAgreementVerification,
): boolean {
  const alignment = metadata.network_alignment;
  const geometryAlignment = metadata.geometry_alignment;
  const excluded = metadata.excluded_modeling_connectors;
  const tableCoverage = networkEvidence.table_coverage;
  const geometry = networkEvidence.geometry;
  if (
    !isJsonRecord(alignment) ||
    alignment.exact !== true ||
    alignment.first_links !== manifest.all_link_count ||
    alignment.second_links !== manifest.all_link_count ||
    alignment.shared_links !== manifest.all_link_count ||
    alignment.first_link_ids_digest !== manifest.all_link_ids_digest ||
    alignment.second_link_ids_digest !== manifest.all_link_ids_digest ||
    alignment.only_in_first !== 0 ||
    alignment.only_in_second !== 0 ||
    !isJsonRecord(excluded) ||
    excluded.role !== "modeling_connector" ||
    excluded.count !== manifest.modeling_connector_link_count ||
    excluded.link_ids_digest !== manifest.modeling_connector_link_ids_digest ||
    !isJsonRecord(tableCoverage) ||
    !isJsonRecord(geometryAlignment) ||
    !isJsonRecord(geometry)
  ) {
    return false;
  }
  for (const side of ["first", "second"] as const) {
    const coverage = tableCoverage[side];
    if (
      !isJsonRecord(coverage) ||
      coverage.exact !== true ||
      coverage.table_link_count !== manifest.all_link_count ||
      coverage.retained_all_link_count !== manifest.all_link_count ||
      coverage.table_link_ids_digest !== manifest.all_link_ids_digest ||
      coverage.retained_all_link_ids_digest !== manifest.all_link_ids_digest
    ) {
      return false;
    }
  }
  return (
    metadata.network_state_digest === verification.networkStateSha256 &&
    geometry.exact === true &&
    geometry.reason === null &&
    geometry.network_state_digest === verification.networkStateSha256 &&
    geometry.roadway_link_count === manifest.roadway_link_count &&
    geometry.roadway_link_ids_digest === manifest.roadway_link_ids_digest &&
    geometry.derived_modeling_connector_count === manifest.modeling_connector_link_count &&
    geometry.derived_modeling_connector_link_ids_digest ===
      manifest.modeling_connector_link_ids_digest &&
    jsonValuesEqual(geometry.retained_network_manifest, manifest) &&
    featureCount === manifest.roadway_link_count &&
    geometryAlignment.source_roadway_feature_count === manifest.roadway_link_count &&
    geometryAlignment.manifest_roadway_link_count === manifest.roadway_link_count &&
    geometryAlignment.rendered_roadway_feature_count === manifest.roadway_link_count &&
    geometryAlignment.compared_roadway_link_count === manifest.roadway_link_count &&
    geometryAlignment.roadway_link_ids_digest === manifest.roadway_link_ids_digest &&
    geometryAlignment.comparison_complete === true &&
    geometryAlignment.exact === true
  );
}

/**
 * Decide whether authenticated v2 bytes can support an individual-link map.
 * The server route owns all SHA-256 computation; the browser checks that its
 * same-origin verification headers join exactly to every embedded evidence copy.
 */
export function parseDemandAgreementArtifact(
  value: unknown,
  verification?: DemandAgreementVerification,
): DemandAgreementArtifactDecision {
  if (!isVerification(verification)) return withhold("invalid_artifact");
  if (
    !isJsonRecord(value) ||
    !hasExactKeys(value, ["type", "features", "metadata"]) ||
    value.type !== "FeatureCollection" ||
    !Array.isArray(value.features) ||
    value.features.length === 0 ||
    !isJsonRecord(value.metadata)
  ) {
    return withhold("invalid_artifact");
  }

  const metadata = value.metadata;
  if (metadata.schema_version !== SUPPORTED_COMPARISON_SCHEMA) {
    return withhold("unsupported_schema");
  }
  if (!hasExactKeys(metadata, METADATA_KEYS)) return withhold("invalid_artifact");

  const methods = metadata.methods;
  const summary = metadata.summary;
  const settings = metadata.settings;
  if (
    !isJsonRecord(methods) ||
    !isNonemptyString(methods.first) ||
    !isNonemptyString(methods.second) ||
    !isJsonRecord(summary) ||
    !isSafeNonnegativeInteger(summary.links_compared) ||
    summary.links_compared !== value.features.length ||
    !isJsonRecord(settings) ||
    !isNonemptyString(settings.volume_column) ||
    !isFiniteNonnegative(settings.minimum_volume) ||
    settings.geh_close !== 5 ||
    settings.geh_marginal !== 10
  ) {
    return withhold("invalid_artifact");
  }

  const convergence = metadata.assignment_convergence;
  if (!isJsonRecord(convergence)) return withhold("convergence_missing");
  const gaps = convergence.gaps;

  const consistency = metadata.network_consistency;
  if (
    !isJsonRecord(consistency) ||
    consistency.status !== "verified_same" ||
    consistency.exact_network_alignment !== true ||
    !isJsonRecord(consistency.evidence)
  ) {
    return withhold("network_identity_unverified");
  }
  const networkEvidence = consistency.evidence;
  const profile = profileEvidence(convergence, networkEvidence, verification);
  if (!profile) return withhold("assignment_settings_unverified");
  const networkSettings = networkSettingsEvidence(networkEvidence, verification);
  if (!networkSettings) return withhold("network_identity_unverified");

  const manifest = metadata.retained_network_manifest;
  if (!isRetainedNetworkManifest(manifest)) return withhold("network_identity_unverified");
  const networkState = networkStateEvidence(networkEvidence, manifest, verification);
  if (!networkState) return withhold("network_identity_unverified");
  if (
    !networkCoverageIsExact(
      metadata,
      networkEvidence,
      manifest,
      value.features.length,
      verification,
    )
  ) {
    return withhold("network_identity_unverified");
  }

  const seenLinkIds = new Set<number>();
  for (const feature of value.features) {
    if (
      !isJsonRecord(feature) ||
      feature.type !== "Feature" ||
      !isRenderableGeometry(feature.geometry) ||
      !isAgreementProperties(feature.properties, settings.minimum_volume) ||
      seenLinkIds.has(feature.properties.link_id)
    ) {
      return withhold("invalid_artifact");
    }
    seenLinkIds.add(feature.properties.link_id);
  }

  const custody: DemandAgreementCustody = {
    artifact: value as unknown as RenderableDemandAgreementArtifact,
    methods: { first: methods.first, second: methods.second },
    evidence: {
      ...profile,
      ...networkSettings,
      ...networkState,
      retainedNetworkManifest: manifest,
      roadwayLinkIds: [...seenLinkIds],
      convergenceGaps: {
        first:
          isJsonRecord(gaps) && isFiniteNonnegative(gaps.first)
            ? gaps.first
            : null,
        second:
          isJsonRecord(gaps) && isFiniteNonnegative(gaps.second)
            ? gaps.second
            : null,
      },
    },
  };

  if (
    !isJsonRecord(gaps) ||
    gaps.first === null ||
    gaps.first === undefined ||
    gaps.second === null ||
    gaps.second === undefined
  ) {
    return withhold("convergence_missing", custody);
  }
  if (
    !isFiniteNonnegative(gaps.first) ||
    !isFiniteNonnegative(gaps.second) ||
    !isFinitePositive(convergence.required_gap) ||
    convergence.required_gap > CONSUMER_MAX_LINK_GAP
  ) {
    return withhold("convergence_inconsistent", custody);
  }
  custody.evidence.convergenceGaps = { first: gaps.first, second: gaps.second };
  if (convergence.status === "unknown") return withhold("convergence_missing", custody);
  if (convergence.status === "corridors_only") {
    return withhold("convergence_too_loose", custody);
  }

  if (
    convergence.status !== "tight_enough" ||
    gaps.first > convergence.required_gap ||
    gaps.second > convergence.required_gap
  ) {
    return withhold("convergence_inconsistent", custody);
  }
  if (
    metadata.attribution_is_supportable !== true ||
    !hasExactLinkAttribution(metadata.attributable_at) ||
    !hasExactLinkAttribution(convergence.attributable_at)
  ) {
    return withhold("attribution_unverified", custody);
  }

  return {
    status: "render_links",
    ...custody,
  };
}

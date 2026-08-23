import {
  jsonValuesEqual,
  parseDemandAgreementArtifact,
  type DemandAgreementArtifactDecision,
  type DemandAgreementCustody,
  type DemandAgreementFeatureProperties,
  type DemandAgreementVerification,
} from "@/lib/models/demand-agreement-artifact";

export const DUAL_DEMAND_AGREEMENT_SCHEMA_VERSION =
  "openplan.corridor_agreement.v2" as const;
export const DUAL_DEMAND_AGREEMENT_SNAPSHOT_SCHEMA_VERSION =
  "openplan.dual-demand-agreement-snapshot.v1" as const;

export const AGREEMENT_METHOD_SENSITIVITY_STATEMENT =
  "Agreement measures sensitivity to the demand method. It does not measure accuracy, and neither method is ground truth.";
export const AGREEMENT_NO_AVERAGE_STATEMENT =
  "The two model volumes are never averaged.";

const JSON_ARTIFACT_KEYS = [
  "schema_version",
  "methods",
  "attribution_is_supportable",
  "attributable_at",
  "assignment_convergence",
  "summary",
  "network_alignment",
  "network_consistency",
  "settings",
  "retained_network",
  "assignment_noise_floor",
  "corridors",
  "links",
  "what_this_is_not",
  "sources",
  "generated_at_utc",
] as const;
const SNAPSHOT_KEYS = [
  "schemaVersion",
  "modelRunId",
  "artifactId",
  "artifactSha256",
  "assignmentProfileSha256",
  "networkSettingsSha256",
  "networkStateSha256",
  "methods",
  "permittedAttributionScale",
  "thresholds",
  "aggregate",
  "selectedCorridors",
  "mandatoryCaveats",
  "isAverage",
] as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FLOAT_TOLERANCE = 0.000_500_001;

export type DualDemandAgreementClassification = "agree" | "marginal" | "diverge";
export type DualDemandAgreementAttributionScale = "corridor" | "link";

export type DualDemandAgreementCorridor = {
  corridor: string;
  links: number;
  firstVolume: number;
  secondVolume: number;
  geh: number;
  classification: DualDemandAgreementClassification;
};

export type DualDemandAgreementAggregate = {
  linksCompared: number;
  linksCarryingMeaningfulTraffic: number;
  agreeShareAllLinks: number | null;
  agreeShareMeaningfulLinks: number | null;
  divergeShareMeaningfulLinks: number | null;
  agreeShareByVolume: number | null;
  medianGehMeaningfulLinks: number | null;
};

/** Country-neutral evidence that both the report and grant lanes may consume. */
export type VerifiedDualDemandAgreement = {
  schemaVersion: typeof DUAL_DEMAND_AGREEMENT_SCHEMA_VERSION;
  modelRunId: string;
  artifactId: string;
  artifactSha256: string;
  assignmentProfileSha256: string;
  networkSettingsSha256: string;
  networkStateSha256: string;
  methods: { first: string; second: string };
  permittedAttributionScale: DualDemandAgreementAttributionScale;
  thresholds: { minimumVolume: number; gehClose: number; gehMarginal: number };
  aggregate: DualDemandAgreementAggregate;
  namedCorridors: DualDemandAgreementCorridor[];
  mandatoryCaveats: string[];
  isAverage: false;
};

export type DualDemandAgreementSnapshotV1 = Omit<
  VerifiedDualDemandAgreement,
  "schemaVersion" | "namedCorridors"
> & {
  schemaVersion: typeof DUAL_DEMAND_AGREEMENT_SNAPSHOT_SCHEMA_VERSION;
  selectedCorridors: DualDemandAgreementCorridor[];
};

export type DualDemandAgreementVerificationState =
  | { status: "absent"; reason: string }
  | { status: "unreadable"; reason: string }
  | { status: "invalid"; reason: string }
  | {
      status: "verified";
      agreement: VerifiedDualDemandAgreement;
      custody?: DemandAgreementCustody;
    };

type ArtifactVerificationInput = {
  source: "registered_artifact";
  payload: unknown;
  verification: DemandAgreementVerification;
  modelRunId: string;
  artifactId: string;
  isAverage: unknown;
  artifactType: "demand_model_agreement" | "demand_model_agreement_geojson";
};

type SnapshotVerificationInput = {
  source: "frozen_snapshot";
  snapshot: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function nonemptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function safeNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function geh(first: number, second: number): number {
  const total = first + second;
  return total <= 0 ? 0 : Math.sqrt((2 * (first - second) ** 2) / total);
}

function classification(gehValue: number): DualDemandAgreementClassification {
  if (gehValue < 5) return "agree";
  if (gehValue < 10) return "marginal";
  return "diverge";
}

function sameNumber(first: unknown, second: number | null): boolean {
  if (second === null) return first === null;
  return typeof first === "number" && Math.abs(first - second) <= FLOAT_TOLERANCE;
}

function share(
  links: DemandAgreementFeatureProperties[],
  wanted: DualDemandAgreementClassification,
): number | null {
  if (links.length === 0) return null;
  return round(links.filter((link) => link.agreement === wanted).length / links.length, 4);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return round(
    ordered.length % 2 === 1
      ? ordered[middle]
      : (ordered[middle - 1] + ordered[middle]) / 2,
    3,
  );
}

function aggregateFromLinks(
  links: DemandAgreementFeatureProperties[],
): DualDemandAgreementAggregate {
  const meaningful = links.filter((link) => link.carries_meaningful_traffic);
  const volumeTotal = links.reduce(
    (total, link) => total + Math.max(link.first_volume, link.second_volume),
    0,
  );
  const agreeingVolume = links
    .filter((link) => link.agreement === "agree")
    .reduce((total, link) => total + Math.max(link.first_volume, link.second_volume), 0);
  return {
    linksCompared: links.length,
    linksCarryingMeaningfulTraffic: meaningful.length,
    agreeShareAllLinks: share(links, "agree"),
    agreeShareMeaningfulLinks: share(meaningful, "agree"),
    divergeShareMeaningfulLinks: share(meaningful, "diverge"),
    agreeShareByVolume: volumeTotal > 0 ? round(agreeingVolume / volumeTotal, 4) : null,
    medianGehMeaningfulLinks: median(meaningful.map((link) => link.geh)),
  };
}

function parsedAggregate(
  summary: unknown,
  links: DemandAgreementFeatureProperties[],
): DualDemandAgreementAggregate | null {
  if (!isRecord(summary)) return null;
  const computed = aggregateFromLinks(links);
  if (
    summary.links_compared !== computed.linksCompared ||
    summary.links_carrying_meaningful_traffic !== computed.linksCarryingMeaningfulTraffic ||
    !sameNumber(summary.agree_share_all_links, computed.agreeShareAllLinks) ||
    !sameNumber(summary.agree_share_meaningful_links, computed.agreeShareMeaningfulLinks) ||
    !sameNumber(summary.diverge_share_meaningful_links, computed.divergeShareMeaningfulLinks) ||
    !sameNumber(summary.agree_share_by_volume, computed.agreeShareByVolume) ||
    !sameNumber(summary.median_geh_meaningful_links, computed.medianGehMeaningfulLinks) ||
    !nonemptyText(summary.note)
  ) {
    return null;
  }
  return computed;
}

function corridorRowsFromLinks(
  links: DemandAgreementFeatureProperties[],
): DualDemandAgreementCorridor[] {
  const grouped = new Map<string, DemandAgreementFeatureProperties[]>();
  for (const link of links) {
    const name = link.name?.trim() ?? "";
    if (!name || !link.carries_meaningful_traffic) continue;
    grouped.set(name, [...(grouped.get(name) ?? []), link]);
  }
  return [...grouped.entries()]
    .map(([corridor, rows]) => {
      const firstVolume = round(rows.reduce((total, row) => total + row.first_volume, 0), 2);
      const secondVolume = round(rows.reduce((total, row) => total + row.second_volume, 0), 2);
      const corridorGeh = round(geh(firstVolume, secondVolume), 3);
      return {
        corridor,
        links: rows.length,
        firstVolume,
        secondVolume,
        geh: corridorGeh,
        classification: classification(corridorGeh),
      };
    })
    .sort((left, right) => right.geh - left.geh || left.corridor.localeCompare(right.corridor));
}

function parseCorridorRow(value: unknown): DualDemandAgreementCorridor | null {
  if (!isRecord(value)) return null;
  const corridor = value.corridor;
  const links = value.links;
  const firstVolume = value.firstVolume ?? value.first_volume;
  const secondVolume = value.secondVolume ?? value.second_volume;
  const gehValue = value.geh;
  const rowClassification = value.classification ?? value.agreement;
  if (
    !nonemptyText(corridor) ||
    !safeNonnegativeInteger(links) ||
    links < 1 ||
    !finiteNonnegative(firstVolume) ||
    !finiteNonnegative(secondVolume) ||
    !finiteNonnegative(gehValue) ||
    Math.abs(round(geh(firstVolume, secondVolume), 3) - gehValue) > FLOAT_TOLERANCE ||
    rowClassification !== classification(gehValue)
  ) {
    return null;
  }
  return {
    corridor: corridor.trim(),
    links,
    firstVolume,
    secondVolume,
    geh: gehValue,
    classification: rowClassification as DualDemandAgreementClassification,
  };
}

function parseCorridorRows(value: unknown): DualDemandAgreementCorridor[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.map(parseCorridorRow);
  if (rows.some((row) => row === null)) return null;
  const parsed = rows as DualDemandAgreementCorridor[];
  if (new Set(parsed.map((row) => row.corridor)).size !== parsed.length) return null;
  return parsed;
}

function caveatsAreMandatory(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length < 3 || !value.every(nonemptyText)) return false;
  const joined = value.join(" ");
  return (
    /neither method is ground truth/i.test(joined) &&
    /does not (?:mean|predict).*?(?:correct|accuracy)/i.test(joined) &&
    /never averaged|never average|not averaged/i.test(joined) &&
    /GEH thresholds.*(?:borrowed|measured|validation)/i.test(joined)
  );
}

function methodsFrom(value: unknown): { first: string; second: string } | null {
  if (!isRecord(value) || !nonemptyText(value.first) || !nonemptyText(value.second)) return null;
  if (value.first.trim() === value.second.trim()) return null;
  return { first: value.first.trim(), second: value.second.trim() };
}

function thresholdsFrom(value: unknown): VerifiedDualDemandAgreement["thresholds"] | null {
  if (
    !isRecord(value) ||
    !finiteNonnegative(value.minimum_volume ?? value.minimumVolume) ||
    (value.geh_close ?? value.gehClose) !== 5 ||
    (value.geh_marginal ?? value.gehMarginal) !== 10
  ) {
    return null;
  }
  return {
    minimumVolume: (value.minimum_volume ?? value.minimumVolume) as number,
    gehClose: 5,
    gehMarginal: 10,
  };
}

function maximumPermittedScale(
  decision: DemandAgreementArtifactDecision,
): DualDemandAgreementAttributionScale | null {
  if (decision.status === "render_links") return "link";
  if (decision.reason === "convergence_too_loose" && decision.custody) return "corridor";
  return null;
}

function toSyntheticGeoJson(value: Record<string, unknown>): unknown {
  const retained = isRecord(value.retained_network) ? value.retained_network : null;
  const consistency = isRecord(value.network_consistency) ? value.network_consistency : null;
  const evidence = consistency && isRecord(consistency.evidence) ? consistency.evidence : null;
  const geometry = evidence && isRecord(evidence.geometry) ? evidence.geometry : null;
  const manifest = retained?.manifest;
  const links = Array.isArray(value.links) ? value.links : [];
  const manifestRecord = isRecord(manifest) ? manifest : {};
  return {
    type: "FeatureCollection",
    features: links.map((link) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[0, 0], [0, 0]] },
      properties: isRecord(link) ? { ...link, comparison_available: true } : link,
    })),
    metadata: {
      schema_version: value.schema_version,
      methods: value.methods,
      summary: value.summary,
      settings: value.settings,
      retained_network_manifest: manifest,
      network_state_digest: retained?.network_state_digest,
      excluded_modeling_connectors: {
        role: "modeling_connector",
        count: retained?.excluded_modeling_connector_count,
        link_ids_digest: manifestRecord.modeling_connector_link_ids_digest,
      },
      network_alignment: value.network_alignment,
      network_consistency: value.network_consistency,
      attribution_is_supportable: value.attribution_is_supportable,
      attributable_at: value.attributable_at,
      assignment_convergence: value.assignment_convergence,
      assignment_noise_floor: value.assignment_noise_floor,
      geometry_alignment: {
        source_roadway_feature_count: geometry?.roadway_link_count,
        manifest_roadway_link_count: manifestRecord.roadway_link_count,
        rendered_roadway_feature_count: links.length,
        compared_roadway_link_count: links.length,
        roadway_link_ids_digest: manifestRecord.roadway_link_ids_digest,
        comparison_complete: links.length === manifestRecord.roadway_link_count,
        exact: geometry?.exact,
      },
      what_this_is_not: value.what_this_is_not,
    },
  };
}

function verifiedFromArtifact(
  input: ArtifactVerificationInput,
): DualDemandAgreementVerificationState {
  if (input.isAverage !== false) {
    return { status: "invalid", reason: "The registered agreement artifact is averaged." };
  }
  if (!UUID_PATTERN.test(input.modelRunId) || !UUID_PATTERN.test(input.artifactId)) {
    return { status: "invalid", reason: "The registered agreement artifact has no stable identity." };
  }

  const payload = input.payload;
  if (!isRecord(payload)) {
    return { status: "invalid", reason: "The agreement artifact is not a JSON object." };
  }
  if (input.artifactType === "demand_model_agreement" && !hasExactKeys(payload, JSON_ARTIFACT_KEYS)) {
    return { status: "invalid", reason: "The agreement JSON fields do not match the supported schema." };
  }
  if (input.artifactType === "demand_model_agreement") {
    const sources = isRecord(payload.sources) ? payload.sources : null;
    if (
      !sources ||
      !nonemptyText(sources.first) ||
      !nonemptyText(sources.second) ||
      !nonemptyText(payload.generated_at_utc) ||
      Number.isNaN(Date.parse(payload.generated_at_utc))
    ) {
      return { status: "invalid", reason: "The agreement JSON provenance fields are invalid." };
    }
  }

  const geoJson =
    input.artifactType === "demand_model_agreement_geojson" ? payload : toSyntheticGeoJson(payload);
  const decision = parseDemandAgreementArtifact(geoJson, input.verification);
  const custody = decision.status === "render_links" ? decision : decision.custody;
  const permittedAttributionScale = maximumPermittedScale(decision);
  if (!custody || !permittedAttributionScale) {
    return {
      status: "invalid",
      reason:
        decision.status === "withhold_links"
          ? `The agreement artifact failed verification: ${decision.reason}.`
          : "The agreement artifact failed verification.",
    };
  }

  const metadata = (geoJson as { metadata: Record<string, unknown> }).metadata;
  const methods = methodsFrom(metadata.methods);
  const thresholds = thresholdsFrom(metadata.settings);
  const links = custody.artifact.features.map((feature) => feature.properties);
  const aggregate = parsedAggregate(metadata.summary, links);
  const mandatoryCaveats = metadata.what_this_is_not;
  if (!methods || !thresholds || !aggregate || !caveatsAreMandatory(mandatoryCaveats)) {
    return { status: "invalid", reason: "The agreement summary or mandatory caveats are invalid." };
  }

  const recomputedCorridors = corridorRowsFromLinks(links);
  let namedCorridors = recomputedCorridors;
  if (input.artifactType === "demand_model_agreement") {
    const storedCorridors = parseCorridorRows(payload.corridors);
    if (!storedCorridors || !jsonValuesEqual(storedCorridors, recomputedCorridors)) {
      return { status: "invalid", reason: "The named-corridor table does not match the verified links." };
    }
    namedCorridors = storedCorridors;
  }

  return {
    status: "verified",
    custody,
    agreement: {
      schemaVersion: DUAL_DEMAND_AGREEMENT_SCHEMA_VERSION,
      modelRunId: input.modelRunId,
      artifactId: input.artifactId,
      artifactSha256: input.verification.artifactSha256,
      assignmentProfileSha256: input.verification.assignmentProfileSha256,
      networkSettingsSha256: input.verification.networkSettingsSha256,
      networkStateSha256: input.verification.networkStateSha256,
      methods,
      permittedAttributionScale,
      thresholds,
      aggregate,
      namedCorridors,
      mandatoryCaveats: [...mandatoryCaveats],
      isAverage: false,
    },
  };
}

function aggregateFromSnapshot(value: unknown): DualDemandAgreementAggregate | null {
  if (!isRecord(value)) return null;
  const result: DualDemandAgreementAggregate = {
    linksCompared: value.linksCompared as number,
    linksCarryingMeaningfulTraffic: value.linksCarryingMeaningfulTraffic as number,
    agreeShareAllLinks: value.agreeShareAllLinks as number | null,
    agreeShareMeaningfulLinks: value.agreeShareMeaningfulLinks as number | null,
    divergeShareMeaningfulLinks: value.divergeShareMeaningfulLinks as number | null,
    agreeShareByVolume: value.agreeShareByVolume as number | null,
    medianGehMeaningfulLinks: value.medianGehMeaningfulLinks as number | null,
  };
  const shares = [
    result.agreeShareAllLinks,
    result.agreeShareMeaningfulLinks,
    result.divergeShareMeaningfulLinks,
    result.agreeShareByVolume,
  ];
  if (
    !safeNonnegativeInteger(result.linksCompared) ||
    !safeNonnegativeInteger(result.linksCarryingMeaningfulTraffic) ||
    result.linksCarryingMeaningfulTraffic > result.linksCompared ||
    !shares.every((entry) => entry === null || (finiteNonnegative(entry) && entry <= 1)) ||
    !(result.medianGehMeaningfulLinks === null || finiteNonnegative(result.medianGehMeaningfulLinks))
  ) {
    return null;
  }
  return result;
}

function verifiedFromSnapshot(
  snapshot: unknown,
): DualDemandAgreementVerificationState {
  if (!isRecord(snapshot) || !hasExactKeys(snapshot, SNAPSHOT_KEYS)) {
    return { status: "invalid", reason: "The frozen agreement snapshot fields are invalid." };
  }
  const methods = methodsFrom(snapshot.methods);
  const thresholds = thresholdsFrom(snapshot.thresholds);
  const aggregate = aggregateFromSnapshot(snapshot.aggregate);
  const selectedCorridors = parseCorridorRows(snapshot.selectedCorridors);
  if (
    snapshot.schemaVersion !== DUAL_DEMAND_AGREEMENT_SNAPSHOT_SCHEMA_VERSION ||
    !UUID_PATTERN.test(String(snapshot.modelRunId)) ||
    !UUID_PATTERN.test(String(snapshot.artifactId)) ||
    !sha256(snapshot.artifactSha256) ||
    !sha256(snapshot.assignmentProfileSha256) ||
    !sha256(snapshot.networkSettingsSha256) ||
    !sha256(snapshot.networkStateSha256) ||
    (snapshot.permittedAttributionScale !== "corridor" &&
      snapshot.permittedAttributionScale !== "link") ||
    snapshot.isAverage !== false ||
    !methods ||
    !thresholds ||
    !aggregate ||
    !selectedCorridors ||
    !caveatsAreMandatory(snapshot.mandatoryCaveats)
  ) {
    return { status: "invalid", reason: "The frozen agreement snapshot failed verification." };
  }
  return {
    status: "verified",
    agreement: {
      schemaVersion: DUAL_DEMAND_AGREEMENT_SCHEMA_VERSION,
      modelRunId: snapshot.modelRunId as string,
      artifactId: snapshot.artifactId as string,
      artifactSha256: snapshot.artifactSha256,
      assignmentProfileSha256: snapshot.assignmentProfileSha256,
      networkSettingsSha256: snapshot.networkSettingsSha256,
      networkStateSha256: snapshot.networkStateSha256,
      methods,
      permittedAttributionScale: snapshot.permittedAttributionScale,
      thresholds,
      aggregate,
      namedCorridors: selectedCorridors,
      mandatoryCaveats: [...(snapshot.mandatoryCaveats as string[])],
      isAverage: false,
    },
  };
}

/** One verifier for live registered artifacts and frozen report snapshots. */
export function verifyDualDemandAgreementEvidence(
  input: ArtifactVerificationInput | SnapshotVerificationInput,
): DualDemandAgreementVerificationState {
  return input.source === "registered_artifact"
    ? verifiedFromArtifact(input)
    : verifiedFromSnapshot(input.snapshot);
}

export function freezeDualDemandAgreementSnapshot(
  agreement: VerifiedDualDemandAgreement,
  selectedCorridors: readonly string[],
): DualDemandAgreementSnapshotV1 {
  const selected = new Set(selectedCorridors);
  return {
    schemaVersion: DUAL_DEMAND_AGREEMENT_SNAPSHOT_SCHEMA_VERSION,
    modelRunId: agreement.modelRunId,
    artifactId: agreement.artifactId,
    artifactSha256: agreement.artifactSha256,
    assignmentProfileSha256: agreement.assignmentProfileSha256,
    networkSettingsSha256: agreement.networkSettingsSha256,
    networkStateSha256: agreement.networkStateSha256,
    methods: agreement.methods,
    permittedAttributionScale: agreement.permittedAttributionScale,
    thresholds: agreement.thresholds,
    aggregate: agreement.aggregate,
    selectedCorridors: agreement.namedCorridors.filter((row) => selected.has(row.corridor)),
    mandatoryCaveats: agreement.mandatoryCaveats,
    isAverage: false,
  };
}

export function verifyFrozenDualDemandAgreementSnapshots(
  metadata: unknown,
): DualDemandAgreementVerificationState[] {
  if (!isRecord(metadata) || !("dualDemandAgreementSnapshotsV1" in metadata)) return [];
  if (!Array.isArray(metadata.dualDemandAgreementSnapshotsV1)) {
    return [{ status: "invalid", reason: "The frozen agreement snapshot list is invalid." }];
  }
  return metadata.dualDemandAgreementSnapshotsV1.map((snapshot) =>
    verifyDualDemandAgreementEvidence({ source: "frozen_snapshot", snapshot }),
  );
}

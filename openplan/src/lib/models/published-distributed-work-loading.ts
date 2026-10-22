import "server-only";

import { createHash } from "node:crypto";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { open, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

const gunzipAsync = promisify(gunzip);
const STUDY_DIRECTORY = "data/modeling/distributed-work-loading-study-2026-08-31";
const STUDY_SCHEMA = "openplan.distributed-work-loading-study-result.v1";
const STUDY_ID = "seven-county-distributed-work-loading-development-v1";
const REGISTRY_PATH = "scripts/modeling/development/california_distributed_work_loading_study.v1.json";
const REGISTRY_LIMIT = 64 * 1024;
const METHODS = ["aequilibrae", "activitysim"] as const;

export type DistributedWorkLoadingMethod = typeof METHODS[number];

export type PublishedDistributedWorkLoadingRecord = {
  geographyId: string;
  geographyName: string;
  method: DistributedWorkLoadingMethod;
  inputPath: string;
  inputStoredPath: string;
  inputSha256: string;
  auditPath: string;
  auditSha256: string;
  comparisonPath: string;
  comparisonStoredPath: string;
  comparisonSha256: string;
  accessPointCount: number;
  retainedAccessPointCount: number;
  originalWorkTrips: number;
  distributedWorkTrips: number;
  retainedWorkTrips: number;
  baselineCoverage: Record<string, number>;
  candidateCoverage: Record<string, number>;
  advanced: boolean;
};

export type PublishedDistributedWorkLoadingStudy = {
  version: string;
  releaseSha: string;
  createdAt: string;
  scientificOutcome: "inconclusive";
  candidateAdvanced: boolean;
  recordedConfiguration: {
    registryPath: string;
    registrySha256: string;
    arbitraryPointCap: null;
    arbitraryGatewayCap: null;
    aggregateOnlySameRoutableNode: true;
    preserveMethodWorkTotals: true;
    nonWorkUnchanged: true;
    acceptanceHoldoutOpened: false;
    legacyPathNote: string;
    sourceRelease: string;
    sourceYear: number;
    sourceLimitation: string;
  };
  records: PublishedDistributedWorkLoadingRecord[];
};

function root(): string {
  return path.resolve(process.cwd(), "..");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function evidenceNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Published distributed work-loading study has missing or invalid numeric evidence.");
  }
  return value;
}

function numbers(value: unknown): Record<string, number> {
  if (!isObject(value)) throw new Error("Published distributed work-loading study omitted coverage.");
  for (const key of ["loaded", "unloaded", "unreachable", "unsupported", "ambiguous", "excluded", "missing_output"]) evidenceNumber(value[key]);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, evidenceNumber(item)]));
}

function exactRecord(value: unknown, label: string): { path: string; stored_path: string; sha256: string } {
  if (!isObject(value) || typeof value.path !== "string" || typeof value.stored_path !== "string" || typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.sha256)) {
    throw new Error(`Published distributed work-loading study omitted ${label}.`);
  }
  return { path: value.path, stored_path: value.stored_path, sha256: value.sha256 };
}

async function logicalBytes(relativePath: string, storedPath?: string): Promise<Buffer> {
  const target = path.resolve(root(), storedPath ?? relativePath);
  if (!target.startsWith(path.join(root(), STUDY_DIRECTORY) + path.sep)) throw new Error("Published distributed work-loading artifact is outside its study.");
  const stored = await readFile(target);
  return (storedPath ?? relativePath).endsWith(".gz") ? gunzipAsync(stored) : stored;
}

async function verifiedObject(record: { path: string; stored_path: string; sha256: string }): Promise<Record<string, unknown>> {
  const bytes = await logicalBytes(record.path, record.stored_path);
  if (createHash("sha256").update(bytes).digest("hex") !== record.sha256) throw new Error("Published distributed work-loading bytes changed.");
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  if (!isObject(value)) throw new Error("Published distributed work-loading artifact is not an object.");
  return value;
}

/** Read only the fixed metadata file, never any source or holdout it describes. */
async function recordedConfiguration(value: Record<string, unknown>): Promise<PublishedDistributedWorkLoadingStudy["recordedConfiguration"]> {
  const descriptor = value.registry;
  if (!isObject(descriptor) || descriptor.path !== REGISTRY_PATH || descriptor.stored_path !== REGISTRY_PATH ||
      typeof descriptor.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(descriptor.sha256) || descriptor.stored_sha256 !== descriptor.sha256 ||
      typeof descriptor.bytes !== "number" || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes <= 0 || descriptor.bytes > REGISTRY_LIMIT || descriptor.stored_bytes !== descriptor.bytes) {
    throw new Error("Published distributed work-loading registry descriptor is invalid.");
  }
  const file = await open(path.join(root(), REGISTRY_PATH), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes: Buffer;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== descriptor.bytes) throw new Error("Published distributed work-loading registry length changed.");
    const buffer = Buffer.alloc(REGISTRY_LIMIT + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await file.read(buffer, length, buffer.length - length, length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    bytes = buffer.subarray(0, length);
  } finally {
    await file.close();
  }
  if (bytes.length !== descriptor.bytes || createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256) {
    throw new Error("Published distributed work-loading registry bytes changed.");
  }
  const registry: unknown = JSON.parse(bytes.toString("utf8"));
  if (!isObject(registry) || registry.schema !== "openplan.development-distributed-work-loading-study.v1" || registry.study_id !== STUDY_ID || value.study_id !== STUDY_ID ||
      !isDeepStrictEqual(registry.methods, METHODS) || !Array.isArray(registry.geographies) || !Array.isArray(value.counties) ||
      !isDeepStrictEqual(registry.geographies.map((item: unknown) => isObject(item) ? [item.geography_id, item.name] : null), value.counties.map((item: unknown) => isObject(item) ? [item.geography_id, item.name] : null))) {
    throw new Error("Published distributed work-loading registry study, methods or geographies disagree.");
  }
  const policy = registry.policy;
  const custody = registry.partition_custody;
  const source = registry.source_release;
  if (!isObject(policy) || policy.arbitrary_point_cap !== null || policy.arbitrary_gateway_cap !== null ||
      policy.aggregate_only_same_routable_node !== true || policy.preserve_method_work_totals !== true || policy.non_work_unchanged !== true ||
      policy.freeze_all_audits_before_output !== true || policy.retain_unroutable_demand !== true || policy.average_methods !== false || policy.open_holdout !== false ||
      policy.change_defaults !== false || policy.promote_candidate !== false || policy.county_gate_no_national_rescue !== true || policy.scientific_outcome !== "inconclusive" ||
      !isObject(custody) || custody.acceptance_holdout_opened !== false || custody.purpose !== "development candidate diagnosis only" ||
      typeof custody.legacy_path_note !== "string" || !custody.legacy_path_note.trim() ||
      !isObject(source) || source.release !== "LODES 8.4" || source.year !== 2023 || source.jobs_type !== "JT00" || source.segment !== "S000" ||
      !Array.isArray(source.limitations) || !source.limitations.every((item: unknown) => typeof item === "string" && item.trim()) ||
      source.limitations[0] !== "LODES describes jobs and home-to-work relationships. It does not describe all-purpose travel or vehicle trips.") {
    throw new Error("Published distributed work-loading registry disclosure policy, custody or source is invalid.");
  }
  return {
    registryPath: descriptor.path, registrySha256: descriptor.sha256,
    arbitraryPointCap: policy.arbitrary_point_cap, arbitraryGatewayCap: policy.arbitrary_gateway_cap,
    aggregateOnlySameRoutableNode: policy.aggregate_only_same_routable_node,
    preserveMethodWorkTotals: policy.preserve_method_work_totals, nonWorkUnchanged: policy.non_work_unchanged,
    acceptanceHoldoutOpened: custody.acceptance_holdout_opened, legacyPathNote: custody.legacy_path_note,
    sourceRelease: source.release, sourceYear: source.year, sourceLimitation: source.limitations[0],
  };
}

/** Load the immutable development checkpoint without promoting it to a model default. */
export async function loadPublishedDistributedWorkLoadingStudy(): Promise<PublishedDistributedWorkLoadingStudy> {
  const value = JSON.parse(await readFile(path.join(root(), STUDY_DIRECTORY, "study-result.json"), "utf8")) as Record<string, unknown>;
  if (value.schema !== STUDY_SCHEMA || value.scientific_outcome !== "inconclusive" || value.method_aggregation !== "separate" || value.method_records !== 14 || !Array.isArray(value.counties) || value.defaults_changed !== false || value.holdout_accessed !== false || typeof value.candidate_advanced !== "boolean") {
    throw new Error("Published distributed work-loading study has an invalid contract.");
  }
  const configuration = await recordedConfiguration(value);
  const records: PublishedDistributedWorkLoadingRecord[] = [];
  const geographyIds = new Set<string>();
  for (const county of value.counties) {
    if (!isObject(county) || typeof county.geography_id !== "string" || typeof county.name !== "string" || !isObject(county.methods)) {
      throw new Error("Published distributed work-loading study has an invalid geography record.");
    }
    if (geographyIds.has(county.geography_id)) throw new Error("Published distributed work-loading study repeats a geography.");
    geographyIds.add(county.geography_id);
    for (const method of METHODS) {
      const methodValue = county.methods[method];
      if (!isObject(methodValue) || !isObject(methodValue.development_gate) || !isObject(methodValue.coverage)) {
        throw new Error(`Published distributed work-loading study omitted ${county.geography_id}/${method}.`);
      }
      const input = exactRecord(methodValue.input, `${county.geography_id}/${method} input`);
      const audit = exactRecord(methodValue.audit, `${county.geography_id}/${method} audit`);
      const comparison = exactRecord(methodValue.comparison, `${county.geography_id}/${method} comparison`);
      const auditValue = await verifiedObject(audit);
      const comparisonValue = await verifiedObject(comparison);
      for (const artifact of [auditValue, comparisonValue]) {
        if (artifact.method !== method || !isObject(artifact.geography) || artifact.geography.geography_id !== county.geography_id) throw new Error("Published distributed work-loading artifact has a different method or geography.");
      }
      if (auditValue.schema !== "openplan.pre-output-audit.v1" || comparisonValue.schema !== "openplan.development-comparison.v1" || !isObject(comparisonValue.bindings) || comparisonValue.bindings.pre_output_audit_sha256 !== audit.sha256 || !isObject(auditValue.bindings) || !isObject(auditValue.bindings.loading_input) || auditValue.bindings.loading_input.sha256 !== input.sha256) throw new Error("Published distributed work-loading artifact bindings disagree.");
      if (!isDeepStrictEqual(comparisonValue.coverage, methodValue.coverage) || !isDeepStrictEqual(comparisonValue.development_gate, methodValue.development_gate)) throw new Error("Published distributed work-loading summaries disagree with verified comparison evidence.");
      if (auditValue.holdout_accessed !== false || auditValue.study_id !== STUDY_ID || comparisonValue.study_id !== STUDY_ID || comparisonValue.scientific_outcome !== "inconclusive" || comparisonValue.defaults_changed !== false || comparisonValue.holdout_accessed !== false || typeof methodValue.development_gate.advanced !== "boolean") throw new Error("Published distributed work-loading comparison or audit has an invalid claim boundary.");
      const accounting = isObject(auditValue.demand_accounting) ? auditValue.demand_accounting : {};
      records.push({
        geographyId: county.geography_id,
        geographyName: county.name,
        method,
        inputPath: input.path,
        inputStoredPath: input.stored_path,
        inputSha256: input.sha256,
        auditPath: audit.path,
        auditSha256: audit.sha256,
        comparisonPath: comparison.path,
        comparisonStoredPath: comparison.stored_path,
        comparisonSha256: comparison.sha256,
        accessPointCount: evidenceNumber(auditValue.access_point_count),
        retainedAccessPointCount: evidenceNumber(auditValue.retained_unroutable_access_point_count),
        originalWorkTrips: evidenceNumber(accounting.original_work_total),
        distributedWorkTrips: evidenceNumber(accounting.work_loaded_at_access_points),
        retainedWorkTrips: evidenceNumber(accounting.work_retained_at_original_centroids),
        baselineCoverage: numbers(methodValue.coverage.baseline),
        candidateCoverage: numbers(methodValue.coverage.candidate),
        advanced: methodValue.development_gate.advanced === true,
      });
    }
  }
  if (records.length !== 14) throw new Error("Published distributed work-loading study must retain fourteen separate records.");
  if (value.candidate_advanced !== records.every((record) => record.advanced)) throw new Error("Published distributed work-loading overall disposition disagrees with its methods.");
  const release = isObject(value.release) ? value.release : {};
  return {
    version: String(release.version ?? "unknown"),
    releaseSha: String(release.sha ?? "unknown"),
    createdAt: String(value.created_at ?? "unknown"),
    scientificOutcome: "inconclusive",
    candidateAdvanced: value.candidate_advanced === true,
    recordedConfiguration: configuration,
    records,
  };
}

export async function readPublishedDistributedWorkLoadingDownload(parts: string[]) {
  const study = await loadPublishedDistributedWorkLoadingStudy();
  let relativePath: string | null = null;
  let storedPath: string | undefined;
  let expected: string | null = null;
  let contentType = "application/json";
  let filename = "distributed-work-loading-artifact.json";
  if (parts.length === 1 && parts[0] === "study-result.json") {
    relativePath = `${STUDY_DIRECTORY}/study-result.json`;
    filename = "distributed-work-loading-study-result.json";
  } else if (parts.length === 1 && parts[0] === "study-report.md") {
    relativePath = `${STUDY_DIRECTORY}/study-report.md`;
    contentType = "text/markdown; charset=utf-8";
    filename = "distributed-work-loading-study-report.md";
  } else if (parts.length === 3 && METHODS.includes(parts[1] as DistributedWorkLoadingMethod)) {
    const record = study.records.find((item) => item.geographyId === parts[0] && item.method === parts[1]);
    if (record && parts[2] === "distributed-work-loading-input-v1.json") {
      relativePath = record.inputPath; storedPath = record.inputStoredPath; expected = record.inputSha256;
    } else if (record && parts[2] === "pre-output-audit-v1.json") {
      relativePath = record.auditPath; expected = record.auditSha256;
    } else if (record && parts[2] === "development-comparison-v1.json") {
      relativePath = record.comparisonPath; storedPath = record.comparisonStoredPath; expected = record.comparisonSha256;
    }
    filename = `${parts[0]}-${parts[1]}-${parts[2]}`;
  }
  if (!relativePath) return null;
  const bytes = await logicalBytes(relativePath, storedPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (expected && sha256 !== expected) throw new Error("Published distributed work-loading bytes changed.");
  return { bytes, contentType, filename, sha256 };
}

import "server-only";

import { createHash } from "node:crypto";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

const gunzipAsync = promisify(gunzip);
const STUDY_DIRECTORY = "data/modeling/distributed-work-loading-study-2026-08-31";
const STUDY_SCHEMA = "openplan.distributed-work-loading-study-result.v1";
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

/** Load the immutable development checkpoint without promoting it to a model default. */
export async function loadPublishedDistributedWorkLoadingStudy(): Promise<PublishedDistributedWorkLoadingStudy> {
  const value = JSON.parse(await readFile(path.join(root(), STUDY_DIRECTORY, "study-result.json"), "utf8")) as Record<string, unknown>;
  if (value.schema !== STUDY_SCHEMA || value.scientific_outcome !== "inconclusive" || value.method_aggregation !== "separate" || value.method_records !== 14 || !Array.isArray(value.counties) || value.defaults_changed !== false || value.holdout_accessed !== false || typeof value.candidate_advanced !== "boolean") {
    throw new Error("Published distributed work-loading study has an invalid contract.");
  }
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
      if (comparisonValue.scientific_outcome !== "inconclusive" || comparisonValue.defaults_changed !== false || comparisonValue.holdout_accessed !== false || typeof methodValue.development_gate.advanced !== "boolean") throw new Error("Published distributed work-loading comparison has an invalid claim boundary.");
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

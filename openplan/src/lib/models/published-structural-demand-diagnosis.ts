import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

export const STRUCTURAL_DEMAND_STUDY_SCHEMA = "openplan.structural-demand-diagnosis-study-result.v1";
const STUDY_DIRECTORY = "data/modeling/structural-demand-diagnosis-study-2026-08-28";
const METHODS = ["aequilibrae", "activitysim"] as const;
const gunzipAsync = promisify(gunzip);

export type StructuralDemandMethod = (typeof METHODS)[number];
export type StructuralDemandRecord = {
  geographyId: string;
  geographyName: string;
  method: StructuralDemandMethod;
  inputAuditPath: string;
  inputAuditSha256: string;
  diagnosisPath: string;
  diagnosisStoredPath: string;
  diagnosisSha256: string;
  coverage: Record<string, number>;
};

export type PublishedStructuralDemandDiagnosis = {
  version: string;
  releaseSha: string;
  createdAt: string;
  scientificOutcome: "inconclusive";
  records: StructuralDemandRecord[];
};

function root(): string {
  return path.resolve(process.cwd(), "..");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numericRecord(value: unknown): Record<string, number> {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function exactBytes(relativePath: string, storedPath?: string): Promise<Buffer> {
  if (storedPath?.endsWith(".gz")) return gunzipAsync(await readFile(path.join(root(), storedPath)));
  try {
    return await readFile(path.join(root(), relativePath));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    return gunzipAsync(await readFile(path.join(root(), `${relativePath}.gz`)));
  }
}

/** Load the committed diagnosis while retaining v0.40 and v0.41 through their loaders. */
export async function loadPublishedStructuralDemandDiagnosis(): Promise<PublishedStructuralDemandDiagnosis> {
  const result = JSON.parse(await readFile(path.join(root(), STUDY_DIRECTORY, "study-result.json"), "utf8")) as Record<string, unknown>;
  if (result.schema !== STRUCTURAL_DEMAND_STUDY_SCHEMA || result.scientific_outcome !== "inconclusive" || result.method_aggregation !== "separate" || result.method_records !== 14 || !Array.isArray(result.counties)) {
    throw new Error("Published structural demand diagnosis has an invalid contract.");
  }
  const records: StructuralDemandRecord[] = [];
  for (const county of result.counties) {
    if (!isObject(county) || typeof county.geography_id !== "string" || typeof county.name !== "string" || !isObject(county.methods)) {
      throw new Error("Published structural demand diagnosis has an invalid geography record.");
    }
    for (const method of METHODS) {
      const value = county.methods[method];
      if (!isObject(value) || typeof value.input_audit_path !== "string" || typeof value.input_audit_sha256 !== "string" || typeof value.diagnosis_path !== "string" || typeof value.diagnosis_stored_path !== "string" || typeof value.diagnosis_sha256 !== "string") {
        throw new Error(`Published structural demand diagnosis omitted ${county.geography_id}/${method}.`);
      }
      records.push({
        geographyId: county.geography_id,
        geographyName: county.name,
        method,
        inputAuditPath: value.input_audit_path,
        inputAuditSha256: value.input_audit_sha256,
        diagnosisPath: value.diagnosis_path,
        diagnosisStoredPath: value.diagnosis_stored_path,
        diagnosisSha256: value.diagnosis_sha256,
        coverage: numericRecord(value.record_coverage),
      });
    }
  }
  if (records.length !== 14) throw new Error("Published structural demand diagnosis must retain fourteen separate records.");
  const release = isObject(result.release) ? result.release : {};
  return { version: String(release.version ?? "unknown"), releaseSha: String(release.sha ?? "unknown"), createdAt: String(result.created_at ?? "unknown"), scientificOutcome: "inconclusive", records };
}

export async function readPublishedStructuralDemandDownload(parts: string[]) {
  const study = await loadPublishedStructuralDemandDiagnosis();
  let relativePath: string | null = null;
  let stored: string | undefined;
  let expected: string | null = null;
  const filename = parts.at(-1) ?? "artifact.json";
  let contentType = "application/json";
  if (parts.length === 1 && parts[0] === "study-result.json") {
    relativePath = `${STUDY_DIRECTORY}/study-result.json`;
  } else if (parts.length === 1 && parts[0] === "study-report.md") {
    relativePath = `${STUDY_DIRECTORY}/study-report.md`;
    contentType = "text/markdown; charset=utf-8";
  } else if (parts.length === 3 && METHODS.includes(parts[1] as StructuralDemandMethod)) {
    const record = study.records.find((item) => item.geographyId === parts[0] && item.method === parts[1]);
    if (record && parts[2] === "model-structural-input-audit-v1.json") {
      relativePath = record.inputAuditPath;
      expected = record.inputAuditSha256;
    } else if (record && parts[2] === "model-validation-structural-diagnosis-v3.json") {
      relativePath = record.diagnosisPath;
      stored = record.diagnosisStoredPath;
      expected = record.diagnosisSha256;
    }
  }
  if (!relativePath) return null;
  const bytes = await exactBytes(relativePath, stored);
  const sha256 = digest(bytes);
  if (expected && sha256 !== expected) throw new Error("Published structural demand bytes changed.");
  return { bytes, contentType, filename, sha256 };
}

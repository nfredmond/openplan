import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import { gunzip } from "node:zlib";

export const COMPARABLE_STUDY_SCHEMA = "openplan.comparable-observation-study-result.v1";
const STUDY_DIRECTORY = "data/modeling/comparable-observation-study-2026-08-28";
const METHODS = ["aequilibrae", "activitysim"] as const;
const gunzipAsync = promisify(gunzip);

export type ComparableMethod = (typeof METHODS)[number];

export type ComparableDiagnosis = {
  geographyId: string;
  method: ComparableMethod;
  path: string;
  sha256: string;
  coverage: Record<string, number>;
  bindings: Record<string, string>;
};

export type PublishedComparableObservationStudy = {
  version: string;
  releaseSha: string;
  createdAt: string;
  scientificOutcome: "inconclusive";
  diagnoses: ComparableDiagnosis[];
};

function root(): string {
  return path.resolve(process.cwd(), "..");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numericRecord(value: unknown): Record<string, number> {
  if (!isObject(value) || !["matched", "ambiguous", "excluded"].every(key => key in value)) {
    throw new Error("Published comparable-observation study has invalid coverage.");
  }
  return Object.fromEntries(Object.entries(value).map(([key, count]) => {
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new Error("Published comparable-observation study has invalid coverage.");
    }
    return [key, count];
  }));
}

function stringRecord(value: unknown): Record<string, string> {
  const required = ["input_bundle", "match_audit", "comparison_basis", "assessment", "observation_package", "network", "model_output", "matcher", "registry"];
  if (!isObject(value) || !required.every(key => typeof value[`${key}_sha256`] === "string" && /^[0-9a-f]{64}$/.test(value[`${key}_sha256`] as string))) {
    throw new Error("Published comparable-observation study has invalid bindings.");
  }
  return Object.fromEntries(Object.entries(value).map(([key, hash]) => {
    if (typeof hash !== "string") throw new Error("Published comparable-observation study has invalid bindings.");
    return [key, hash];
  }));
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readPublishedArtifact(relativePath: string): Promise<Buffer> {
  const absolutePath = path.resolve(root(), relativePath);
  if (!absolutePath.startsWith(path.join(root(), STUDY_DIRECTORY) + path.sep)) {
    throw new Error("Published comparable-observation artifact is outside its study.");
  }
  try {
    return await readFile(absolutePath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    return gunzipAsync(await readFile(`${absolutePath}.gz`));
  }
}

/** Refuse manifest-selected bytes unless their committed hash is present and exact. */
export function verifyPublishedComparableObservationHash(
  bytes: Buffer,
  expected: string | null,
  requiresManifestHash: boolean,
): string {
  if (requiresManifestHash && !expected) {
    throw new Error("Published comparable-observation manifest omitted an artifact hash.");
  }
  const sha256 = digest(bytes);
  if (expected && sha256 !== expected) {
    throw new Error("Published comparable-observation bytes changed.");
  }
  return sha256;
}

/** Load the committed v0.41 result while retaining v0.40 through its separate loader. */
export async function loadPublishedComparableObservationStudy(): Promise<PublishedComparableObservationStudy> {
  const result = JSON.parse(
    await readFile(path.join(root(), STUDY_DIRECTORY, "study-result.json"), "utf8"),
  ) as Record<string, unknown>;
  if (
    result.schema !== COMPARABLE_STUDY_SCHEMA ||
    result.scientific_outcome !== "inconclusive" ||
    result.model_accuracy_claim !== "not made" ||
    !Array.isArray(result.diagnoses) ||
    result.diagnoses.length !== 14
  ) {
    throw new Error("Published comparable-observation study has an invalid contract.");
  }
  const identities = new Set<string>();
  const diagnoses = await Promise.all(result.diagnoses.map(async (value) => {
    if (!isObject(value) || typeof value.geography_id !== "string" || !METHODS.includes(value.method as ComparableMethod) || typeof value.path !== "string" || typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.sha256)) {
      throw new Error("Published comparable-observation study has an invalid diagnosis record.");
    }
    const identity = `${value.geography_id}/${value.method}`;
    if (identities.has(identity)) throw new Error("Published comparable-observation study repeats a method and geography.");
    identities.add(identity);
    const bytes = await readPublishedArtifact(value.path);
    verifyPublishedComparableObservationHash(bytes, value.sha256, true);
    const diagnosis: unknown = JSON.parse(bytes.toString("utf8"));
    if (!isObject(diagnosis) || diagnosis.schema !== "openplan.model-validation-structural-diagnosis.v2" || diagnosis.scientific_outcome !== "inconclusive") {
      throw new Error("Published comparable-observation diagnosis has an invalid claim boundary.");
    }
    if (diagnosis.geography_id !== value.geography_id || diagnosis.method !== value.method) {
      throw new Error("Published comparable-observation diagnosis has a different method or geography.");
    }
    if (!isDeepStrictEqual(diagnosis.coverage, value.coverage) || !isDeepStrictEqual(diagnosis.bindings, value.bindings)) {
      throw new Error("Published comparable-observation summaries disagree with verified diagnosis evidence.");
    }
    return {
      geographyId: value.geography_id,
      method: value.method as ComparableMethod,
      path: value.path,
      sha256: value.sha256,
      coverage: numericRecord(value.coverage),
      bindings: stringRecord(value.bindings),
    };
  }));
  if (diagnoses.some(record => METHODS.some(method => !identities.has(`${record.geographyId}/${method}`)))) {
    throw new Error("Published comparable-observation study omitted a separate method.");
  }
  const release = isObject(result.release) ? result.release : {};
  return {
    version: String(release.version ?? "unknown"),
    releaseSha: String(release.sha ?? "unknown"),
    createdAt: String(result.created_at ?? "unknown"),
    scientificOutcome: "inconclusive",
    diagnoses,
  };
}

export async function readPublishedComparableObservationDownload(parts: string[]) {
  const study = await loadPublishedComparableObservationStudy();
  let relativePath: string | null = null;
  let expected: string | null = null;
  let requiresManifestHash = false;
  let contentType = "application/json";
  let filename = parts.at(-1) ?? "artifact.json";
  if (parts.length === 1 && parts[0] === "study-result.json") {
    relativePath = `${STUDY_DIRECTORY}/study-result.json`;
    filename = "comparable-observation-study-result.json";
  } else if (parts.length === 1 && parts[0] === "study-report.md") {
    relativePath = `${STUDY_DIRECTORY}/study-report.md`;
    contentType = "text/markdown; charset=utf-8";
    filename = "comparable-observation-study-report.md";
  } else if (parts.length === 3 && /^06\d{3}$/.test(parts[0]) && METHODS.includes(parts[1] as ComparableMethod)) {
    requiresManifestHash = true;
    const record = study.diagnoses.find((item) => item.geographyId === parts[0] && item.method === parts[1]);
    const files: Record<string, [string, string | null]> = record ? {
      "validation-input-bundle-v2.json": [`${STUDY_DIRECTORY}/results/${parts[0]}/${parts[1]}/validation-input-bundle-v2.json`, record.bindings.input_bundle_sha256 ?? null],
      "comparison-basis-v2.json": [`${STUDY_DIRECTORY}/results/${parts[0]}/${parts[1]}/comparison-basis-v2.json`, record.bindings.comparison_basis_sha256 ?? null],
      "assessment-v2.json": [`${STUDY_DIRECTORY}/results/${parts[0]}/${parts[1]}/assessment-v2.json`, record.bindings.assessment_sha256 ?? null],
      "structural-diagnosis-v2.json": [record.path, record.sha256],
    } : {};
    const selected = files[parts[2]];
    if (selected) [relativePath, expected] = selected;
    filename = `${parts[0]}-${parts[1]}-${parts[2]}`;
  } else if (parts.length === 3 && parts[1] === "instrument" && /^06\d{3}$/.test(parts[0])) {
    requiresManifestHash = true;
    const record = study.diagnoses.find((item) => item.geographyId === parts[0]);
    const files: Record<string, [string, string | null]> = record ? {
      "observation-package-v2.json": [`${STUDY_DIRECTORY}/instruments/${parts[0]}/observation-package-v2.json`, record.bindings.observation_package_sha256 ?? null],
      "pre-volume-match-audit-v2.json": [`${STUDY_DIRECTORY}/instruments/${parts[0]}/pre-volume-match-audit-v2.json`, record.bindings.match_audit_sha256 ?? null],
    } : {};
    const selected = files[parts[2]];
    if (selected) [relativePath, expected] = selected;
  }
  if (!relativePath) return null;
  const bytes = await readPublishedArtifact(relativePath);
  const sha256 = verifyPublishedComparableObservationHash(bytes, expected, requiresManifestHash);
  return { bytes, contentType, filename, sha256 };
}

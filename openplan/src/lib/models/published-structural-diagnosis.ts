import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const PUBLISHED_DIAGNOSIS_SCHEMA =
  "openplan.model-validation-structural-diagnosis-study-result.v1";
const STUDY_DIRECTORY = "data/modeling/model-validation-structural-diagnosis-2026-08-28";
const METHODS = ["aequilibrae", "activitysim"] as const;

export type PublishedDiagnosisMethod = (typeof METHODS)[number];

export type PublishedDiagnosisRecord = {
  geographyId: string;
  method: PublishedDiagnosisMethod;
  diagnosisPath: string;
  diagnosisSha256: string;
  findingCounts: Record<string, number>;
};

export type PublishedStructuralDiagnosisStudy = {
  appVersion: string;
  createdAt: string;
  gitSha: string;
  scientificOutcome: "inconclusive";
  records: PublishedDiagnosisRecord[];
};

function repositoryRoot(): string {
  return path.resolve(process.cwd(), "..");
}

// Deliberately no `server-only` marker: Models page contract tests import the
// page module in Vitest. The Node built-ins keep this loader out of client
// bundles, while the missing marker lets those tests inspect the real page.

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Read the committed release study. A malformed or partial result fails closed. */
export async function loadPublishedStructuralDiagnosisStudy(): Promise<PublishedStructuralDiagnosisStudy> {
  const resultPath = path.join(repositoryRoot(), STUDY_DIRECTORY, "study-result.json");
  const result = JSON.parse(await readFile(resultPath, "utf8")) as Record<string, unknown>;
  if (
    result.schema !== PUBLISHED_DIAGNOSIS_SCHEMA ||
    result.scientific_outcome !== "inconclusive" ||
    result.method_aggregation !== "separate" ||
    !Array.isArray(result.counties)
  ) {
    throw new Error("Published structural diagnosis has an invalid study contract.");
  }

  const records: PublishedDiagnosisRecord[] = [];
  for (const countyValue of result.counties) {
    if (!isObject(countyValue) || typeof countyValue.geography_id !== "string" || !isObject(countyValue.methods)) {
      throw new Error("Published structural diagnosis has an invalid county record.");
    }
    for (const method of METHODS) {
      const methodValue = countyValue.methods[method];
      if (!isObject(methodValue) || typeof methodValue.diagnosis_path !== "string" || typeof methodValue.diagnosis_sha256 !== "string") {
        throw new Error(`Published structural diagnosis omitted ${countyValue.geography_id}/${method}.`);
      }
      const findingCounts = isObject(methodValue.finding_counts)
        ? Object.fromEntries(
            Object.entries(methodValue.finding_counts).filter(
              (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]),
            ),
          )
        : {};
      records.push({
        geographyId: countyValue.geography_id,
        method,
        diagnosisPath: methodValue.diagnosis_path,
        diagnosisSha256: methodValue.diagnosis_sha256,
        findingCounts,
      });
    }
  }
  if (records.length !== 14) {
    throw new Error(`Published structural diagnosis has ${records.length} method records; expected 14.`);
  }
  return {
    appVersion: String(result.app_version ?? "unknown"),
    createdAt: String(result.created_at ?? "unknown"),
    gitSha: String(result.git_sha ?? "unknown"),
    scientificOutcome: "inconclusive",
    records,
  };
}

export type PublishedDiagnosisDownload = {
  bytes: Buffer;
  contentType: string;
  filename: string;
  sha256: string;
};

/** Resolve only manifest-selected release files; caller path text never becomes a filesystem path. */
export async function readPublishedStructuralDiagnosisDownload(
  parts: string[],
): Promise<PublishedDiagnosisDownload | null> {
  const study = await loadPublishedStructuralDiagnosisStudy();
  let relativePath: string | null = null;
  let expectedSha256: string | null = null;
  let contentType = "application/json";
  let filename = parts.at(-1) ?? "structural-diagnosis.json";
  if (parts.length === 1 && parts[0] === "study-result.json") {
    relativePath = `${STUDY_DIRECTORY}/study-result.json`;
  } else if (parts.length === 1 && parts[0] === "study-report.md") {
    relativePath = `${STUDY_DIRECTORY}/study-report.md`;
    contentType = "text/markdown; charset=utf-8";
  } else if (parts.length === 3 && parts[2] === "structural-diagnosis.json") {
    const record = study.records.find(
      (item) => item.geographyId === parts[0] && item.method === parts[1],
    );
    if (record) {
      relativePath = record.diagnosisPath;
      expectedSha256 = record.diagnosisSha256;
      filename = `${record.geographyId}-${record.method}-structural-diagnosis.json`;
    }
  }
  if (!relativePath) return null;
  const bytes = await readFile(path.join(repositoryRoot(), relativePath));
  const digest = sha256(bytes);
  if (expectedSha256 && digest !== expectedSha256) {
    throw new Error("Published structural diagnosis bytes do not match the study result.");
  }
  return {
    bytes,
    contentType,
    filename,
    sha256: digest,
  };
}

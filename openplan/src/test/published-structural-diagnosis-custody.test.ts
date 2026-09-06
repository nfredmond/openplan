import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const intercepted = vi.hoisted(() => new Map<string, Buffer | string | Error>());
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = vi.fn(async (...args: Parameters<typeof actual.readFile>) => {
    const replacement = intercepted.get(String(args[0]));
    if (replacement instanceof Error) throw replacement;
    return replacement ?? actual.readFile(...args);
  });
  return { ...actual, readFile, default: { ...actual, readFile } };
});

import { loadPublishedStructuralDiagnosisStudy } from "@/lib/models/published-structural-diagnosis";

const root = path.resolve(process.cwd(), "..");
const manifestPath = path.join(root, "data/modeling/model-validation-structural-diagnosis-2026-08-28/study-result.json");
const original = readFileSync(manifestPath, "utf8");
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

// Substitute reads only. The committed scientific artifacts are never edited.
function alteredSource(change: (diagnosis: Record<string, unknown>) => void, rehash = true) {
  const manifest = JSON.parse(original);
  const method = manifest.counties[0].methods.aequilibrae;
  const sourcePath = path.join(root, method.diagnosis_path);
  const diagnosis = JSON.parse(readFileSync(sourcePath, "utf8"));
  change(diagnosis);
  const bytes = Buffer.from(JSON.stringify(diagnosis));
  intercepted.set(sourcePath, bytes);
  if (rehash) method.diagnosis_sha256 = digest(bytes);
  intercepted.set(manifestPath, JSON.stringify(manifest));
}

afterEach(() => intercepted.clear());

describe("published diagnosis pre-render custody", () => {
  it("loads the exact diagnosis belonging to every frozen county and method", async () => {
    const study = await loadPublishedStructuralDiagnosisStudy();
    for (const record of study.records) {
      const bytes = readFileSync(path.join(root, record.diagnosisPath));
      expect(record.diagnosis).toEqual(JSON.parse(bytes.toString("utf8")));
      expect(digest(bytes)).toBe(record.diagnosisSha256);
      expect(record.diagnosis).toMatchObject({ geography_id: record.geographyId, method: record.method });
    }
  });

  it("refuses altered bytes before rendering even valid JSON", async () => {
    alteredSource((diagnosis) => { diagnosis.findings = []; }, false);
    await expect(loadPublishedStructuralDiagnosisStudy()).rejects.toThrow("bytes do not match");
  });

  it.each([
    ["schema", "another.schema"], ["geography_id", "different-geography"],
    ["method", "activitysim"], ["scientific_outcome", "passed"],
    ["method_aggregation", "averaged"], ["match_changes", 1],
    ["calibrated", true], ["candidate_selected", true], ["claim_tier_changed", true],
    ["acceptance_rule_created", true], ["acceptance_holdout_opened", true],
  ])("refuses changed %s even when its replacement hash agrees", async (field, value) => {
    alteredSource((diagnosis) => { diagnosis[field] = value; });
    await expect(loadPublishedStructuralDiagnosisStudy()).rejects.toThrow("frozen county, method, and scientific boundaries");
  });

  it("refuses missing source evidence rather than displaying a partial study", async () => {
    const manifest = JSON.parse(original);
    intercepted.set(path.join(root, manifest.counties[0].methods.aequilibrae.diagnosis_path), new Error("Source unavailable"));
    await expect(loadPublishedStructuralDiagnosisStudy()).rejects.toThrow("Source unavailable");
  });

  it("refuses an outside-results path before attempting to read it", async () => {
    const manifest = JSON.parse(original);
    manifest.counties[0].methods.aequilibrae.diagnosis_path = "data/modeling/unopened-holdout.json";
    intercepted.set(path.join(root, "data/modeling/unopened-holdout.json"), new Error("Outside source was accessed"));
    intercepted.set(manifestPath, JSON.stringify(manifest));
    await expect(loadPublishedStructuralDiagnosisStudy()).rejects.toThrow("outside the frozen results directory");
  });
});

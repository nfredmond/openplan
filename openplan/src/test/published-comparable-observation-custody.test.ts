import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile, default: { readFile } }));
import { loadPublishedComparableObservationStudy } from "@/lib/models/published-comparable-observation-study";

const directory = "data/modeling/comparable-observation-study-2026-08-28";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
type Json = Record<string, unknown>;

function fixture(change?: (diagnosis: Json) => void) {
  const files = new Map<string, Buffer>();
  const diagnoses = Array.from({ length: 7 }, (_, index) => ["aequilibrae", "activitysim"].map(method => {
    const value: Json = {
      schema: "openplan.model-validation-structural-diagnosis.v2",
      geography_id: `0600${index}`, method, scientific_outcome: "inconclusive",
      coverage: { matched: 1, ambiguous: 0, excluded: 2 },
      bindings: Object.fromEntries(["input_bundle", "match_audit", "comparison_basis", "assessment", "observation_package", "network", "model_output", "matcher", "registry"].map(key => [`${key}_sha256`, "a".repeat(64)])),
    };
    if (index === 0 && method === "aequilibrae") change?.(value);
    const path = `${directory}/results/0600${index}/${method}/structural-diagnosis-v2.json`;
    const bytes = Buffer.from(JSON.stringify(value));
    files.set(`${path}.gz`, gzipSync(bytes));
    return { ...structuredClone(value), path, sha256: hash(bytes) } as Json & { path: string; sha256: string };
  })).flat();
  const manifest = { schema: "openplan.comparable-observation-study-result.v1", scientific_outcome: "inconclusive", model_accuracy_claim: "not made", diagnoses };
  const save = () => files.set(`${directory}/study-result.json`, Buffer.from(JSON.stringify(manifest)));
  save();
  readFile.mockImplementation(async (filename: string, encoding?: string) => {
    const bytes = files.get(filename.slice(filename.indexOf(directory)));
    if (!bytes) throw Object.assign(new Error("Missing synthetic file"), { code: "ENOENT" });
    return encoding ? bytes.toString("utf8") : bytes;
  });
  return { files, manifest, save };
}

beforeEach(() => { readFile.mockReset(); });
describe("published comparable observation display custody", () => {
  it("loads separate methods from verified compressed diagnosis bytes and preserves zero", async () => {
    fixture();
    const study = await loadPublishedComparableObservationStudy();
    expect(study.diagnoses).toHaveLength(14);
    expect(study.diagnoses[0].coverage.ambiguous).toBe(0);
    expect(readFile.mock.calls.some(([filename]) => String(filename).endsWith(".json.gz"))).toBe(true);
  });
  it("rejects changed diagnosis bytes before displaying coverage", async () => {
    const { files, manifest } = fixture();
    files.set(`${manifest.diagnoses[0].path}.gz`, gzipSync(Buffer.from('{"changed":true}')));
    await expect(loadPublishedComparableObservationStudy()).rejects.toThrow("bytes changed");
  });
  it.each(["coverage", "bindings"])("rejects manifest %s inconsistent with diagnosis bytes", async key => {
    const { manifest, save } = fixture();
    manifest.diagnoses[0][key] = key === "coverage" ? { matched: 999 } : { input_bundle_sha256: "b".repeat(64) };
    save();
    await expect(loadPublishedComparableObservationStudy()).rejects.toThrow("summaries disagree");
  });
  it("rejects a diagnosis relabeled as another method", async () => {
    const { manifest, save } = fixture();
    [manifest.diagnoses[0].path, manifest.diagnoses[1].path] = [manifest.diagnoses[1].path, manifest.diagnoses[0].path];
    [manifest.diagnoses[0].sha256, manifest.diagnoses[1].sha256] = [manifest.diagnoses[1].sha256, manifest.diagnoses[0].sha256];
    save();
    await expect(loadPublishedComparableObservationStudy()).rejects.toThrow("different method or geography");
  });
  it("rejects duplicate method and geography records", async () => {
    const { manifest, save } = fixture();
    manifest.diagnoses[1] = manifest.diagnoses[0]; save();
    await expect(loadPublishedComparableObservationStudy()).rejects.toThrow("repeats a method and geography");
  });
  it.each([null, "3", -1])("rejects hash-bound invalid coverage %s", async invalid => {
    fixture(value => { (value.coverage as Json).matched = invalid; });
    await expect(loadPublishedComparableObservationStudy()).rejects.toThrow("invalid coverage");
  });
  it("rejects a hash-bound promoted scientific outcome", async () => {
    fixture(value => { value.scientific_outcome = "validated"; });
    await expect(loadPublishedComparableObservationStudy()).rejects.toThrow("invalid claim boundary");
  });
  it("rejects omitted coverage instead of silently displaying an incomplete summary", async () => {
    fixture(value => { delete (value.coverage as Json).matched; });
    await expect(loadPublishedComparableObservationStudy()).rejects.toThrow("invalid coverage");
  });
  it("rejects an omitted hash even when the diagnosis and manifest agree", async () => {
    fixture(value => { delete (value.bindings as Json).match_audit_sha256; });
    await expect(loadPublishedComparableObservationStudy()).rejects.toThrow("invalid bindings");
  });
  it("rejects an invalid diagnosis hash", async () => {
    const { manifest, save } = fixture();
    manifest.diagnoses[0].sha256 = "invalid"; save();
    await expect(loadPublishedComparableObservationStudy()).rejects.toThrow("invalid diagnosis record");
  });
  it("rejects a missing method partner despite fourteen distinct records", async () => {
    const { files, manifest, save } = fixture();
    const value = manifest.diagnoses[0];
    value.geography_id = "06999";
    const { path, sha256: _oldHash, ...diagnosis } = value;
    const bytes = Buffer.from(JSON.stringify(diagnosis));
    files.set(`${path}.gz`, gzipSync(bytes)); value.sha256 = hash(bytes); save();
    await expect(loadPublishedComparableObservationStudy()).rejects.toThrow("omitted a separate method");
  });
  it("refuses an out-of-study path before reading it", async () => {
    const { manifest, save } = fixture();
    manifest.diagnoses[0].path = "data/modeling/unopened-fixture.json"; save();
    await expect(loadPublishedComparableObservationStudy()).rejects.toThrow("outside its study");
    expect(readFile.mock.calls.some(([filename]) => String(filename).endsWith("unopened-fixture.json"))).toBe(false);
  });
});

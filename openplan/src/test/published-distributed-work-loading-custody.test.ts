import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile, default: { readFile } }));
import { loadPublishedDistributedWorkLoadingStudy } from "@/lib/models/published-distributed-work-loading";

const directory = "data/modeling/distributed-work-loading-study-2026-08-31";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
type Json = Record<string, unknown>;

function fixture(change?: (audit: Json, comparison: Json) => void) {
  const files = new Map<string, Buffer>();
  const coverage = { loaded: 1, unloaded: 0, unreachable: 0, unsupported: 0, ambiguous: 0, excluded: 0, missing_output: 0 };
  const counties = Array.from({ length: 7 }, (_, index) => {
    const geography_id = `fixture-${index}`;
    const methods = Object.fromEntries(["aequilibrae", "activitysim"].map((method) => {
      const base = `${directory}/${geography_id}/${method}`;
      const input = { path: `${base}/input.json`, stored_path: `${base}/input.json`, sha256: "a".repeat(64) };
      const auditValue: Json = { schema: "openplan.pre-output-audit.v1", method, geography: { geography_id }, bindings: { loading_input: input }, access_point_count: 2, retained_unroutable_access_point_count: 0, demand_accounting: { original_work_total: 10, work_loaded_at_access_points: 10, work_retained_at_original_centroids: 0 } };
      const comparisonValue: Json = { schema: "openplan.development-comparison.v1", method, geography: { geography_id }, scientific_outcome: "inconclusive", defaults_changed: false, holdout_accessed: false, coverage: { baseline: { ...coverage }, candidate: { ...coverage } }, development_gate: { advanced: false } };
      if (index === 0 && method === "aequilibrae") change?.(auditValue, comparisonValue);
      const auditBytes = Buffer.from(JSON.stringify(auditValue));
      const audit = { path: `${base}/audit.json`, stored_path: `${base}/audit.json`, sha256: hash(auditBytes) };
      comparisonValue.bindings = { pre_output_audit_sha256: audit.sha256 };
      const comparisonBytes = Buffer.from(JSON.stringify(comparisonValue));
      const comparison = { path: `${base}/comparison.json`, stored_path: `${base}/comparison.json.gz`, sha256: hash(comparisonBytes) };
      files.set(audit.path, auditBytes);
      files.set(comparison.stored_path, gzipSync(comparisonBytes));
      return [method, { input, audit, comparison, coverage: structuredClone(comparisonValue.coverage), development_gate: structuredClone(comparisonValue.development_gate) }];
    }));
    return { geography_id, name: `Fixture ${index}`, methods };
  });
  const manifest = { schema: "openplan.distributed-work-loading-study-result.v1", scientific_outcome: "inconclusive", method_aggregation: "separate", method_records: 14, defaults_changed: false, holdout_accessed: false, candidate_advanced: false, counties };
  const saveManifest = () => files.set(`${directory}/study-result.json`, Buffer.from(JSON.stringify(manifest)));
  saveManifest();
  readFile.mockImplementation(async (filename: string, encoding?: string) => {
    const relative = filename.slice(filename.indexOf(directory));
    const bytes = files.get(relative);
    if (!bytes) throw new Error("Missing fixture artifact");
    return encoding ? bytes.toString("utf8") : bytes;
  });
  return { files, manifest, saveManifest };
}

beforeEach(() => { readFile.mockReset(); });

describe("published study display custody", () => {
  it("retains separate methods and genuine zero with verified compressed comparisons", async () => {
    fixture();
    const result = await loadPublishedDistributedWorkLoadingStudy();
    expect(result.records).toHaveLength(14);
    expect(result.records[0].originalWorkTrips).toBe(10);
    expect(result.records[0].retainedWorkTrips).toBe(0);
    expect(result.candidateAdvanced).toBe(false);
  });

  it("rejects altered audit bytes before displaying their numbers", async () => {
    const { files, manifest } = fixture();
    const auditPath = manifest.counties[0].methods.aequilibrae.audit.path;
    const audit = JSON.parse(files.get(auditPath)!.toString());
    audit.access_point_count = 999;
    files.set(auditPath, Buffer.from(JSON.stringify(audit)));
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("bytes changed");
  });

  it("rejects altered compressed comparison bytes", async () => {
    const { files, manifest } = fixture();
    const comparisonPath = manifest.counties[0].methods.aequilibrae.comparison.stored_path;
    const comparison = JSON.parse(gunzipSync(files.get(comparisonPath)!).toString());
    comparison.unverified_extra_note = "Changed after publication";
    files.set(comparisonPath, gzipSync(Buffer.from(JSON.stringify(comparison))));
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("bytes changed");
  });

  it.each([undefined, null, "10", -1])("rejects hash-bound invalid work totals: %s", async (value) => {
    fixture((audit) => { (audit.demand_accounting as Json).original_work_total = value; });
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("numeric evidence");
  });

  it("rejects missing loaded coverage even when both summaries agree", async () => {
    fixture((_audit, comparison) => { delete ((comparison.coverage as Json).baseline as Json).loaded; });
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("numeric evidence");
  });

  it.each(["coverage", "development_gate"] as const)("rejects a changed manifest %s summary", async (key) => {
    const { manifest, saveManifest } = fixture();
    const record = manifest.counties[0].methods.aequilibrae;
    if (key === "coverage") (record.coverage as { baseline: { loaded: number } }).baseline.loaded = 99;
    else (record.development_gate as { advanced: boolean }).advanced = true;
    saveManifest();
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("summaries disagree");
  });

  it("rejects a hash-bound swapped method", async () => {
    fixture((audit) => { audit.method = "activitysim"; });
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("different method or geography");
  });

  it("rejects a duplicate geography instead of counting it twice", async () => {
    const { manifest, saveManifest } = fixture();
    manifest.counties[1] = manifest.counties[0];
    saveManifest();
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("repeats a geography");
  });

  it("rejects an overall advance contradicted by retained method outcomes", async () => {
    const { manifest, saveManifest } = fixture();
    manifest.candidate_advanced = true;
    saveManifest();
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("overall disposition");
  });

  it("rejects a changed loading input binding", async () => {
    const { manifest, saveManifest } = fixture();
    manifest.counties[0].methods.aequilibrae.input.sha256 = "b".repeat(64);
    saveManifest();
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("bindings disagree");
  });

  it("refuses paths outside the published study before reading them", async () => {
    const { manifest, saveManifest } = fixture();
    manifest.counties[0].methods.aequilibrae.audit.stored_path = "data/modeling/unopened-fixture.json";
    saveManifest();
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("outside its study");
    expect(readFile.mock.calls.some(([filename]) => String(filename).endsWith("unopened-fixture.json"))).toBe(false);
  });

  it("rejects malformed artifact hashes before reading evidence", async () => {
    const { manifest, saveManifest } = fixture();
    manifest.counties[0].methods.aequilibrae.audit.sha256 = "invalid";
    saveManifest();
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("omitted fixture-0/aequilibrae audit");
  });

  it("rejects a manifest that promotes the frozen scientific claim", async () => {
    const { manifest, saveManifest } = fixture();
    manifest.defaults_changed = true;
    saveManifest();
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("invalid contract");
  });

  it("rejects a hash-bound comparison that claims changed defaults", async () => {
    fixture((_audit, comparison) => { comparison.defaults_changed = true; });
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("invalid claim boundary");
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { readFile, open } = vi.hoisted(() => ({ readFile: vi.fn(), open: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile, open, default: { readFile, open } }));
import nextConfig from "../../next.config";
import { loadPublishedDistributedWorkLoadingStudy } from "@/lib/models/published-distributed-work-loading";

const directory = "data/modeling/distributed-work-loading-study-2026-08-31";
const registryPath = "scripts/modeling/development/california_distributed_work_loading_study.v1.json";
const studyId = "seven-county-distributed-work-loading-development-v1";
type RegistryFixture = {
  schema: string; study_id: string; methods: string[];
  geographies: { geography_id: string; name: string }[];
  policy: Record<string, unknown>; partition_custody: Record<string, unknown>; source_release: Record<string, unknown>;
};
const realRegistry: RegistryFixture = JSON.parse(readFileSync(path.resolve(process.cwd(), "..", registryPath), "utf8"));
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
      const auditValue: Json = { schema: "openplan.pre-output-audit.v1", study_id: studyId, holdout_accessed: false, method, geography: { geography_id }, bindings: { loading_input: input }, access_point_count: 2, retained_unroutable_access_point_count: 0, demand_accounting: { original_work_total: 10, work_loaded_at_access_points: 10, work_retained_at_original_centroids: 0 } };
      const comparisonValue: Json = { schema: "openplan.development-comparison.v1", study_id: studyId, method, geography: { geography_id }, scientific_outcome: "inconclusive", defaults_changed: false, holdout_accessed: false, coverage: { baseline: { ...coverage }, candidate: { ...coverage } }, development_gate: { advanced: false } };
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
  const registry = structuredClone(realRegistry);
  registry.geographies = counties.map((county) => ({ geography_id: county.geography_id, name: county.name }));
  const registryBytes = Buffer.from(JSON.stringify(registry));
  const descriptor = { path: registryPath, stored_path: registryPath, bytes: registryBytes.length, stored_bytes: registryBytes.length, sha256: hash(registryBytes), stored_sha256: hash(registryBytes) };
  files.set(registryPath, registryBytes);
  const manifest = { study_id: studyId, registry: descriptor, schema: "openplan.distributed-work-loading-study-result.v1", scientific_outcome: "inconclusive", method_aggregation: "separate", method_records: 14, defaults_changed: false, holdout_accessed: false, candidate_advanced: false, counties };
  const saveManifest = () => files.set(`${directory}/study-result.json`, Buffer.from(JSON.stringify(manifest)));
  saveManifest();
  readFile.mockImplementation(async (filename: string, encoding?: string) => {
    const relative = filename.slice(filename.indexOf(directory));
    const bytes = files.get(relative);
    if (!bytes) throw new Error("Missing fixture artifact");
    return encoding ? bytes.toString("utf8") : bytes;
  });
  open.mockImplementation(async (filename: string) => {
    if (filename !== path.resolve(process.cwd(), "..", registryPath)) throw new Error("Unregistered metadata read");
    const bytes = files.get(registryPath);
    if (!bytes) throw new Error("Missing fixture registry");
    return {
      stat: async () => ({ isFile: () => true, size: bytes.length }),
      read: async (buffer: Buffer, offset: number, length: number, position: number) => ({ bytesRead: bytes.copy(buffer, offset, position, position + length) }),
      close: vi.fn().mockResolvedValue(undefined),
    };
  });
  const saveRegistry = () => {
    const bytes = Buffer.from(JSON.stringify(registry));
    files.set(registryPath, bytes);
    Object.assign(descriptor, { bytes: bytes.length, stored_bytes: bytes.length, sha256: hash(bytes), stored_sha256: hash(bytes) });
    saveManifest();
  };
  return { files, manifest, saveManifest, registry, saveRegistry };
}

beforeEach(() => { readFile.mockReset(); open.mockReset(); });

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
    const { manifest, registry, saveRegistry } = fixture();
    manifest.counties[1] = manifest.counties[0];
    registry.geographies[1] = registry.geographies[0];
    saveRegistry();
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


describe("fixed registry disclosure custody", () => {
  it("traces only the fixed registry for model pages and downloads", () => {
    for (const route of ["/models", "/models/*", "/api/models/distributed-work-loading/*"]) {
      const includes = nextConfig.outputFileTracingIncludes?.[route];
      expect(includes).toContain(`../${registryPath}`);
      expect(includes?.filter((item) => item.includes("scripts/"))).toEqual([`../${registryPath}`]);
    }
  });

  it("limits registry reads to 64 KiB plus an overflow byte even if the file grows", async () => {
    const { manifest } = fixture();
    const read = vi.fn().mockImplementation(async (_buffer: Buffer, _offset: number, length: number) => ({ bytesRead: length }));
    const close = vi.fn().mockResolvedValue(undefined);
    open.mockResolvedValue({ stat: async () => ({ isFile: () => true, size: manifest.registry.bytes }), read, close });
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("registry bytes changed");
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][0]).toHaveLength(65537);
    expect(read.mock.calls[0][2]).toBe(65537);
    expect(close).toHaveBeenCalledOnce();
  });

  it("refuses a non-regular registry without reading and closes its handle", async () => {
    fixture();
    const read = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    open.mockResolvedValue({ stat: async () => ({ isFile: () => false }), read, close });
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("registry length changed");
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(["policy", "partition_custody", "source_release"])("refuses missing registry %s", async (key) => {
    const { registry, saveRegistry } = fixture();
    Reflect.deleteProperty(registry, key);
    saveRegistry();
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("registry disclosure policy, custody or source is invalid");
  });

  it("returns recorded metadata and opens only the fixed registry", async () => {
    fixture();
    const result = await loadPublishedDistributedWorkLoadingStudy();
    expect(result.recordedConfiguration).toMatchObject({ arbitraryPointCap: null, arbitraryGatewayCap: null, aggregateOnlySameRoutableNode: true, preserveMethodWorkTotals: true, nonWorkUnchanged: true, acceptanceHoldoutOpened: false, sourceRelease: "LODES 8.4", sourceYear: 2023 });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe(path.resolve(process.cwd(), "..", registryPath));
    expect(readFile.mock.calls.every(([filename]) => String(filename).includes(directory))).toBe(true);
  });

  it.each(["path", "stored_path"])("refuses registry descriptor %s redirection before opening", async (key) => {
    const { manifest, saveManifest } = fixture();
    manifest.registry[key as "path" | "stored_path"] = "data/agreement-study/runs/holdout/unopened.json";
    saveManifest();
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("registry descriptor is invalid");
    expect(open).not.toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it.each(["missing", "malformed", "oversize", "stored length", "stored hash"])("refuses %s registry descriptor", async (kind) => {
    const { manifest, saveManifest } = fixture();
    if (kind === "missing") Reflect.deleteProperty(manifest, "registry");
    if (kind === "malformed") manifest.registry.sha256 = "invalid";
    if (kind === "oversize") manifest.registry.bytes = manifest.registry.stored_bytes = 65537;
    if (kind === "stored length") manifest.registry.stored_bytes++;
    if (kind === "stored hash") manifest.registry.stored_sha256 = "b".repeat(64);
    saveManifest();
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("registry descriptor is invalid");
    expect(open).not.toHaveBeenCalled();
  });

  it.each(["missing", "length", "hash", "json"])("refuses %s registry bytes", async (kind) => {
    const { files, manifest, saveManifest } = fixture();
    if (kind === "missing") files.delete(registryPath);
    if (kind === "length") files.set(registryPath, Buffer.from("{}"));
    if (kind === "hash") files.set(registryPath, Buffer.alloc(manifest.registry.bytes, 32));
    if (kind === "json") {
      const bytes = Buffer.from("invalid JSON");
      files.set(registryPath, bytes);
      Object.assign(manifest.registry, { bytes: bytes.length, stored_bytes: bytes.length, sha256: hash(bytes), stored_sha256: hash(bytes) });
      saveManifest();
    }
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow(kind === "missing" ? "Missing fixture registry" : kind === "length" ? "registry length changed" : kind === "hash" ? "registry bytes changed" : /JSON/);
  });

  it.each(["schema", "study_id", "manifest study", "methods", "geography", "geography name", "missing geography"])("refuses hash-bound registry %s mismatch", async (key) => {
    const { registry, manifest, saveRegistry } = fixture();
    if (key === "schema" || key === "study_id") registry[key] = "wrong";
    if (key === "manifest study") manifest.study_id = "wrong";
    if (key === "methods") registry.methods = ["aequilibrae"];
    if (key === "geography") registry.geographies[0].geography_id = "wrong";
    if (key === "geography name") registry.geographies[0].name = "wrong";
    if (key === "missing geography") registry.geographies.pop();
    saveRegistry();
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("registry study, methods or geographies disagree");
  });

  it.each(["arbitrary_point_cap", "arbitrary_gateway_cap"])("requires typed null %s", async (key) => {
    for (const value of [undefined, "null", false, 0, 12]) {
      const { registry, saveRegistry } = fixture();
      registry.policy[key] = value;
      saveRegistry();
      await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("registry disclosure policy, custody or source is invalid");
    }
  });

  it.each(Object.keys(realRegistry.policy).filter((key) => !key.startsWith("arbitrary_")))("refuses contradicted policy %s", async (key) => {
    const { registry, saveRegistry } = fixture();
    registry.policy[key] = typeof registry.policy[key] === "boolean" ? !registry.policy[key] : "validated";
    saveRegistry();
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("registry disclosure policy, custody or source is invalid");
  });

  it.each(["holdout", "holdout type", "purpose", "legacy note", "release", "year", "year type", "jobs_type", "segment", "limitations"])("refuses hash-bound %s disclosure mismatch", async (key) => {
    const { registry, saveRegistry } = fixture();
    if (key === "holdout") registry.partition_custody.acceptance_holdout_opened = true;
    if (key === "holdout type") registry.partition_custody.acceptance_holdout_opened = "false";
    if (key === "purpose") registry.partition_custody.purpose = "independent acceptance";
    if (key === "legacy note") delete registry.partition_custody.legacy_path_note;
    if (key === "release" || key === "year" || key === "jobs_type" || key === "segment") registry.source_release[key] = null;
    if (key === "year type") registry.source_release.year = "2023";
    if (key === "limitations") registry.source_release.limitations = ["Observed vehicle trips"];
    saveRegistry();
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("registry disclosure policy, custody or source is invalid");
  });

  it.each([true, undefined, "false"])("refuses an audit holdout flag of %s", async (flag) => {
    fixture((audit) => { audit.holdout_accessed = flag; });
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("invalid claim boundary");
  });

  it.each(["audit", "comparison"])("refuses %s study identity mismatch", async (kind) => {
    fixture((audit, comparison) => { (kind === "audit" ? audit : comparison).study_id = "wrong"; });
    await expect(loadPublishedDistributedWorkLoadingStudy()).rejects.toThrow("invalid claim boundary");
  });
});

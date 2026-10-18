import { afterEach, describe, expect, it, vi } from "vitest";
import { readSafetyCrashEvidenceIngest, SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION } from "@/lib/safety/crash-evidence";
import { retainedCrashRoadProvider } from "@/lib/safety/road-provider";
import * as registry from "@/lib/safety/sources/registry";
import { ccrsAdapter } from "@/lib/safety/sources/ccrs";

const scope = { min_lon: -121.2, min_lat: 39.1, max_lon: -120.8, max_lat: 39.5 };
const ingest = (overrides: Record<string, unknown> = {}) =>
  readSafetyCrashEvidenceIngest({ id: "acquisition", source_id: "ccrs-ca", ...scope, ...overrides })!;
afterEach(() => vi.restoreAllMocks());

describe("road-provider capability retained with crash sources", () => {
  it("projects and parses source identity and exact acquisition scope", () => {
    expect(SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION.split(", ")).toContain("source_id");
    expect(ingest()).toMatchObject({ sourceId: "ccrs-ca", scopeBounds: {
      minLon: -121.2, minLat: 39.1, maxLon: -120.8, maxLat: 39.5,
    } });
    expect(retainedCrashRoadProvider([ingest()], ["acquisition"])).toBe("us-census-tiger-line");
  });

  it("accepts the national source's records without declaring the whole geometry's country", () => {
    // This coarse source envelope also covers Canadian corridors. The provider
    // is suitable for FARS records, never evidence that the geometry is US land.
    expect(retainedCrashRoadProvider([ingest({ source_id: "fars-national",
      min_lon: -80, max_lon: -79.9, min_lat: 43.6, max_lat: 43.7,
    })], ["acquisition"])).toBe("us-census-tiger-line");
  });

  it.each([
    { source_id: undefined }, { source_id: null }, { source_id: "unknown" },
    { source_id: "" }, { source_id: 6 }, { min_lon: undefined }, { min_lon: null },
    { min_lon: "-121.2" }, { min_lat: NaN }, { min_lon: -181 },
    { max_lat: 91 }, { max_lon: -122 }, { min_lon: 0, max_lon: 1, min_lat: 0, max_lat: 1 },
  ])("refuses missing provenance or invalid/unsupported retained scope %j", (overrides) => {
    expect(retainedCrashRoadProvider([ingest(overrides)], ["acquisition"])).toBeNull();
  });

  it("requires all exact selected acquisitions, without duplicating or ignoring one", () => {
    const one = ingest();
    expect(retainedCrashRoadProvider([], [])).toBeNull();
    expect(retainedCrashRoadProvider([one], ["acquisition", "missing"])).toBeNull();
    expect(retainedCrashRoadProvider([one], ["other"])).toBeNull();
    expect(retainedCrashRoadProvider([one, ingest({ id: "other" })], ["acquisition", "acquisition"])).toBeNull();
    expect(retainedCrashRoadProvider([one, one], ["acquisition", "acquisition"])).toBeNull();
    expect(retainedCrashRoadProvider([one, ingest({ id: "other", source_id: "unknown" })], ["acquisition", "other"])).toBeNull();
    expect(retainedCrashRoadProvider([one, ingest({ id: "other", source_id: "fars-national" })], ["acquisition", "other"])).toBe("us-census-tiger-line");
  });

  it("refuses unassessed or mixed provider capabilities, and preserves another provider's identity", () => {
    const get = vi.spyOn(registry, "getCrashSourceById");
    get.mockReturnValue({ ...ccrsAdapter, roadContextProvider: undefined });
    expect(retainedCrashRoadProvider([ingest()], ["acquisition"])).toBeNull();
    get.mockReturnValue({ ...ccrsAdapter, roadContextProvider: "other-country-roads" });
    expect(retainedCrashRoadProvider([ingest()], ["acquisition"])).toBe("other-country-roads");
    get.mockImplementation((id) => ({ ...ccrsAdapter, roadContextProvider: id === "ccrs-ca" ? "us-census-tiger-line" : "other-country-roads" }));
    expect(retainedCrashRoadProvider([ingest(), ingest({ id: "other", source_id: "foreign" })], ["acquisition", "other"])).toBeNull();
  });
});

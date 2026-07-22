import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aggregateWacByTract,
  fetchLODESForCorridor,
  fetchLODESWacForTracts,
  lodesWacUrl,
} from "@/lib/data-sources/lodes";

const WAC_HEADER =
  "w_geocode,C000,CE01,CE02,CE03," +
  Array.from({ length: 20 }, (_, i) => `CNS${String(i + 1).padStart(2, "0")}`).join(",");

// A block row: all jobs low-earning (CE01) and Construction (CNS04, index 3 →
// a "goods" segment), so goods == C000 and earnLow == C000 for easy assertions.
function wacRow(geocode: string, c000: number): string {
  const cns = Array.from({ length: 20 }, (_, i) => (i === 3 ? c000 : 0));
  return [geocode, c000, c000, 0, 0, ...cns].join(",");
}

const WAC_CSV = [
  WAC_HEADER,
  wacRow("060010001001000", 100), // tract 06001000100 block 1
  wacRow("060010001002000", 50), //  tract 06001000100 block 2 → tract total 150
  wacRow("060010002001000", 200), // tract 06001000200
  wacRow("060010003001000", 999), // tract 06001000300 (NOT in study area)
].join("\n");

function stubGzFetch(csv: string) {
  const gz = gzipSync(Buffer.from(csv, "utf-8"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength),
    }))
  );
}

describe("lodesWacUrl", () => {
  it("builds the keyless per-state WAC url", () => {
    expect(lodesWacUrl("CA", "2022")).toBe(
      "https://lehd.ces.census.gov/data/lodes/LODES8/ca/wac/ca_wac_S000_JT00_2022.csv.gz"
    );
  });
});

describe("aggregateWacByTract", () => {
  it("sums block C000 (and earnings/industry) to 11-digit tracts", () => {
    const byTract = aggregateWacByTract(WAC_CSV);
    expect(byTract.get("06001000100")?.totalJobs).toBe(150);
    expect(byTract.get("06001000100")?.earnLow).toBe(150);
    expect(byTract.get("06001000100")?.goods).toBe(150);
    expect(byTract.get("06001000200")?.totalJobs).toBe(200);
    expect(byTract.get("06001000300")?.totalJobs).toBe(999);
  });

  it("returns empty on a malformed header (no fabrication)", () => {
    expect(aggregateWacByTract("garbage\n1,2,3").size).toBe(0);
  });
});

describe("fetchLODESWacForTracts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("totals REAL jobs over the study-area tracts only, tagged lodes-wac", async () => {
    stubGzFetch(WAC_CSV);
    const summary = await fetchLODESWacForTracts(["06001000100", "06001000200"], 1000);

    expect(summary.source).toBe("lodes-wac");
    expect(summary.totalJobs).toBe(350); // 150 + 200; tract 300 (999) excluded
    expect(summary.jobsPerResident).toBe(0.35);
    expect(summary.jobsByIndustry.goods).toBe(350);
    expect(summary.jobsByEarnings.low).toBe(350);
  });
});

describe("fetchLODESForCorridor", () => {
  afterEach(() => vi.unstubAllGlobals());

  const geom = { type: "Polygon", coordinates: [] };

  it("uses real WAC when tract GEOIDs are supplied", async () => {
    stubGzFetch(WAC_CSV);
    const summary = await fetchLODESForCorridor(geom, 1000, 400, ["06001000100", "06001000200"]);
    expect(summary.source).toBe("lodes-wac");
    expect(summary.totalJobs).toBe(350);
  });

  it("falls back to the ACS estimate when no tracts are supplied", async () => {
    const summary = await fetchLODESForCorridor(geom, 1000, 400);
    expect(summary.source).toBe("acs-estimate");
    expect(summary.totalJobs).toBe(470); // round(1000 * 0.47)
  });

  it("falls back to the ACS estimate when the WAC file can't be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    // Texas tract → a state not touched by the success test (avoids the cache).
    const summary = await fetchLODESForCorridor(geom, 1000, 400, ["48001000100"]);
    expect(summary.source).toBe("acs-estimate");
    expect(summary.totalJobs).toBe(470);
  });
});

import { describe, expect, it } from "vitest";

import { screenEquity } from "@/lib/data-sources/equity";
import {
  resolveJustice40ForTracts,
  resolveEquityDesignation,
  DESIGNATION_SOURCE_IDS,
  getEquityDesignationById,
} from "@/lib/data-sources/equity-designation/registry";
import { cejstNationalAdapter } from "@/lib/data-sources/equity-designation/cejst-national";
import { federalJustice40NarrativeLine } from "@/lib/data-sources/equity-designation/disclosure";
import { notDeterminedJustice40 } from "@/lib/data-sources/equity-designation/types";
import cejstAsset from "@/lib/data-sources/equity-designation/data/cejst-v1.0-communities.json";

// GEOIDs sampled from the bundled v1.0 asset:
const DISADVANTAGED_GEOID = "01003010100"; // present, flagged disadvantaged
const NOT_DISADVANTAGED_GEOID = "01001020100"; // present, NOT flagged
const ABSENT_GEOID = "99999999999"; // no CEJST record (vintage gap analog)

// Alabama bbox (inside CONUS envelope) so CEJST covers the study area.
const AL_BBOX = { minLon: -88, minLat: 30, maxLon: -87.9, maxLat: 30.1 };
// Mid-Atlantic Ocean — outside every US envelope.
const OCEAN_BBOX = { minLon: 10, minLat: 40, maxLon: 11, maxLat: 41 };

describe("CEJST v1.0 bundled asset integrity", () => {
  const asset = cejstAsset as unknown as {
    coveredGeoids: string[];
    disadvantagedGeoids: string[];
    meta: { totalTracts: number; disadvantagedTracts: number };
  };

  it("matches the documented v1.0 figures exactly", () => {
    expect(asset.coveredGeoids.length).toBe(74134);
    expect(asset.disadvantagedGeoids.length).toBe(27248);
    expect(asset.meta.totalTracts).toBe(74134);
    expect(asset.meta.disadvantagedTracts).toBe(27248);
  });

  it("keeps disadvantaged a subset of covered, all 11-digit GEOIDs", () => {
    const covered = new Set(asset.coveredGeoids);
    // spot-check subset without materializing a 27k comparison on every run
    for (const g of asset.disadvantagedGeoids.slice(0, 500)) {
      expect(covered.has(g)).toBe(true);
    }
    for (const g of asset.coveredGeoids.slice(0, 500)) {
      expect(g).toMatch(/^\d{11}$/);
    }
  });
});

describe("cejstNationalAdapter.lookup", () => {
  it("distinguishes disadvantaged / not-disadvantaged / undetermined", async () => {
    const result = await cejstNationalAdapter.lookup([
      DISADVANTAGED_GEOID,
      NOT_DISADVANTAGED_GEOID,
      ABSENT_GEOID,
    ]);
    // Only the two covered tracts are "determined"; the absent one is left out.
    expect(result.determinedTotal).toBe(2);
    expect(result.disadvantagedTotal).toBe(1);
    expect(result.byGeoid.get(DISADVANTAGED_GEOID)).toBe(true);
    expect(result.byGeoid.get(NOT_DISADVANTAGED_GEOID)).toBe(false);
    expect(result.byGeoid.has(ABSENT_GEOID)).toBe(false); // undetermined, NOT false
  });

  it("is read-only (not persistable) and national", () => {
    expect(cejstNationalAdapter.persistable).toBe(false);
    expect(cejstNationalAdapter.covers(AL_BBOX)).toBe(true);
    expect(cejstNationalAdapter.covers(OCEAN_BBOX)).toBe(false);
  });

  it("keeps disadvantaged ≤ determined even with duplicate / whitespace geoids", async () => {
    const result = await cejstNationalAdapter.lookup([
      DISADVANTAGED_GEOID,
      DISADVANTAGED_GEOID,
      ` ${DISADVANTAGED_GEOID} `,
    ]);
    // All three collapse to one determined tract — the count cannot exceed it.
    expect(result.determinedTotal).toBe(1);
    expect(result.disadvantagedTotal).toBe(1);
    expect(result.disadvantagedTotal).toBeLessThanOrEqual(result.determinedTotal);
  });
});

describe("federalJustice40NarrativeLine — honest not_determined cause", () => {
  it("blames the 2010/2020 vintage gap ONLY when a source actually covered the area", () => {
    const line = federalJustice40NarrativeLine({
      status: "not_determined",
      source: "cejst-national",
      datasetLabel: "CEJST v1.0",
      version: "1.0",
      vintage: "2010",
      coverage: { totalTracts: 3, determinedTracts: 0, undeterminedTracts: 3, disadvantagedTracts: 0 },
    });
    expect(line).toMatch(/2010-vintage/);
    expect(line).toMatch(/renumbered/);
  });

  it("does NOT invent a vintage cause when no source covered the area (source null)", () => {
    const line = federalJustice40NarrativeLine(notDeterminedJustice40(3));
    expect(line).not.toMatch(/renumbered/);
    expect(line).not.toMatch(/2010-vintage/);
    expect(line).toMatch(/No official disadvantaged-community designation source covered/i);
  });
});

describe("resolveJustice40ForTracts", () => {
  it("returns a real 'disadvantaged' determination naming the source", async () => {
    const det = await resolveJustice40ForTracts(AL_BBOX, [DISADVANTAGED_GEOID, NOT_DISADVANTAGED_GEOID]);
    expect(det.status).toBe("disadvantaged");
    expect(det.source).toBe("cejst-national");
    expect(det.coverage).toEqual({
      totalTracts: 2,
      determinedTracts: 2,
      undeterminedTracts: 0,
      disadvantagedTracts: 1,
    });
  });

  it("returns 'not_disadvantaged' when covered tracts carry no flag", async () => {
    const det = await resolveJustice40ForTracts(AL_BBOX, [NOT_DISADVANTAGED_GEOID]);
    expect(det.status).toBe("not_disadvantaged");
    expect(det.source).toBe("cejst-national");
    expect(det.coverage.disadvantagedTracts).toBe(0);
  });

  it("returns 'not_determined' (source named) when no tract matches — vintage gap", async () => {
    const det = await resolveJustice40ForTracts(AL_BBOX, [ABSENT_GEOID, ABSENT_GEOID]);
    expect(det.status).toBe("not_determined");
    // A covered study area whose tracts simply aren't in the 2010 list still names
    // the source so disclosure can explain the vintage gap.
    expect(det.source).toBe("cejst-national");
    expect(det.coverage.undeterminedTracts).toBe(2);
  });

  it("returns 'not_determined' (source null) when out of coverage", async () => {
    const det = await resolveJustice40ForTracts(OCEAN_BBOX, [DISADVANTAGED_GEOID]);
    expect(det.status).toBe("not_determined");
    expect(det.source).toBeNull();
    expect(resolveEquityDesignation(OCEAN_BBOX).kind).toBe("out_of_coverage");
  });

  it("keeps the persistable/DB allowlist empty until a migration opens it", () => {
    // The bundled asset is read-only; nothing may be written to a designation table yet.
    expect(DESIGNATION_SOURCE_IDS).toEqual([]);
    expect(getEquityDesignationById("cejst-national")?.persistable).toBe(false);
    expect(getEquityDesignationById("nope")).toBeNull();
  });
});

describe("screenEquity separates the proxy from the federal determination", () => {
  // Low income (<$50k) + high poverty (>=30%) trips the ACS income+burden proxy.
  const disadvantagedTract = (geoid: string) => ({
    geoid,
    pctMinority: 60,
    pctBelowPoverty: 35,
    medianIncome: 40000,
    zeroVehicleHouseholds: 12,
    totalHouseholds: 100,
    transitCommuters: 20,
    totalCommuters: 100,
  });
  const census = {
    pctMinority: 60,
    pctBelowPoverty: 35,
    pctZeroVehicle: 12,
    pctTransit: 20,
    medianIncomeWeighted: 40000,
    tracts: [disadvantagedTract("06001400100"), disadvantagedTract("06001400200")],
  };

  it("defaults federalJustice40 to not_determined and never fabricates it from the proxy", () => {
    const screen = screenEquity(census);
    // The income+burden proxy tripped, but that MUST NOT become a Justice40 designation.
    expect(screen.proxyDisadvantagedFlag).toBe(true);
    expect(screen.federalJustice40.status).toBe("not_determined");
    expect(screen.federalJustice40.source).toBeNull();
    expect(screen.source).toBe("proxy-census");
  });

  it("carries an injected real determination through unchanged", () => {
    const det = {
      status: "disadvantaged" as const,
      source: "cejst-national",
      datasetLabel: "CEJST v1.0 (2022-11-22) — discontinued-program snapshot",
      version: "1.0",
      vintage: "2010",
      coverage: { totalTracts: 2, determinedTracts: 2, undeterminedTracts: 0, disadvantagedTracts: 2 },
    };
    const screen = screenEquity(census, det);
    expect(screen.federalJustice40).toEqual(det);
    // The proxy signal is independent of the federal determination.
    expect(screen.proxyDisadvantagedFlag).toBe(true);
  });
});

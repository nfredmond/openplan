import { describe, expect, it } from "vitest";
import {
  ESTIMATED_BADGE_LABEL,
  describeEstimatedAccessibilityInputs,
  estimatedSourceNote,
  isEstimatedSource,
  resolveEstimatedDomains,
} from "@/lib/analysis/estimated-source";

describe("estimated source detection", () => {
  it("flags the known estimated fallback source tokens", () => {
    expect(isEstimatedSource({ source: "fars-estimate" })).toBe(true);
    expect(isEstimatedSource({ source: "estimate" })).toBe(true);
    expect(isEstimatedSource({ source: "acs-estimate" })).toBe(true);
  });

  it("does not flag measured sources", () => {
    expect(isEstimatedSource({ source: "switrs-local" })).toBe(false);
    expect(isEstimatedSource({ source: "fars-api" })).toBe(false);
    expect(isEstimatedSource({ source: "osm-overpass" })).toBe(false);
    expect(isEstimatedSource({ source: "lodes-api" })).toBe(false);
    expect(isEstimatedSource({ source: "census-acs5-2023" })).toBe(false);
  });

  it("treats missing or malformed provenance as not estimated", () => {
    expect(isEstimatedSource(undefined)).toBe(false);
    expect(isEstimatedSource(null)).toBe(false);
    expect(isEstimatedSource({})).toBe(false);
    expect(isEstimatedSource({ source: null })).toBe(false);
    expect(isEstimatedSource({ source: "" })).toBe(false);
  });

  it("normalizes casing and whitespace before matching", () => {
    expect(isEstimatedSource({ source: " FARS-Estimate " })).toBe(true);
    expect(isEstimatedSource({ source: "Estimate" })).toBe(true);
  });
});

describe("resolveEstimatedDomains", () => {
  it("resolves all domains from source snapshots when present", () => {
    expect(
      resolveEstimatedDomains({
        sourceSnapshots: {
          crashes: { source: "fars-estimate" },
          transit: { source: "estimate" },
          lodes: { source: "acs-estimate" },
        },
      })
    ).toEqual({ crashes: true, transit: true, lodes: true });

    expect(
      resolveEstimatedDomains({
        sourceSnapshots: {
          crashes: { source: "switrs-local" },
          transit: { source: "osm-overpass" },
          lodes: { source: "lodes-api" },
        },
      })
    ).toEqual({ crashes: false, transit: false, lodes: false });
  });

  it("prefers snapshots over dataQuality when both are present", () => {
    expect(
      resolveEstimatedDomains({
        sourceSnapshots: { crashes: { source: "fars-api" }, lodes: { source: "lodes-api" } },
        dataQuality: { crashDataAvailable: false, lodesSource: "acs-estimate" },
      })
    ).toEqual({ crashes: false, transit: false, lodes: false });
  });

  it("falls back to dataQuality for historical runs without snapshots", () => {
    expect(
      resolveEstimatedDomains({
        dataQuality: { crashDataAvailable: false, lodesSource: "acs-estimate" },
      })
    ).toEqual({ crashes: true, transit: false, lodes: true });

    expect(
      resolveEstimatedDomains({
        dataQuality: { crashDataAvailable: true, lodesSource: "lodes-api" },
      })
    ).toEqual({ crashes: false, transit: false, lodes: false });
  });

  it("returns all-false for empty or missing metrics", () => {
    expect(resolveEstimatedDomains(null)).toEqual({ crashes: false, transit: false, lodes: false });
    expect(resolveEstimatedDomains(undefined)).toEqual({ crashes: false, transit: false, lodes: false });
    expect(resolveEstimatedDomains({})).toEqual({ crashes: false, transit: false, lodes: false });
  });
});

describe("estimated source labels", () => {
  it("uses a title-cased badge label", () => {
    expect(ESTIMATED_BADGE_LABEL).toBe("Estimated");
  });

  it("provides a one-line explanation per estimated domain", () => {
    expect(estimatedSourceNote("crashes")).toBe("Crash source API unavailable — area-based estimate.");
    expect(estimatedSourceNote("transit")).toBe("Transit stop inventory unavailable — area-based estimate.");
    expect(estimatedSourceNote("lodes")).toBe("LODES employment not yet ingested — ACS-based estimate.");
  });

  it("describes estimated accessibility inputs only when present", () => {
    expect(describeEstimatedAccessibilityInputs({ transit: false, lodes: false })).toBeNull();
    expect(describeEstimatedAccessibilityInputs({ transit: true, lodes: false })).toBe(
      "Includes estimated inputs (transit stops) — source data unavailable or not yet ingested."
    );
    expect(describeEstimatedAccessibilityInputs({ transit: false, lodes: true })).toBe(
      "Includes estimated inputs (employment) — source data unavailable or not yet ingested."
    );
    expect(describeEstimatedAccessibilityInputs({ transit: true, lodes: true })).toBe(
      "Includes estimated inputs (transit stops, employment) — source data unavailable or not yet ingested."
    );
  });
});

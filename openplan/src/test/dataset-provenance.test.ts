import { describe, expect, it } from "vitest";
import { resolveDatasetTrustLabel, toneForDatasetTrustLevel } from "@/lib/data-sources/dataset-provenance";

describe("dataset provenance trust labels", () => {
  it("marks datasets with complete audit metadata as verified", () => {
    const trust = resolveDatasetTrustLabel({
      connectorId: "connector-1",
      citationText: "ACS 2023 5-year table B01003",
      licenseLabel: "Public domain",
      schemaVersion: "acs-2023-v1",
      checksum: "sha256:abc123",
      lastRefreshedAt: "2026-05-09T12:00:00.000Z",
    });

    expect(trust).toMatchObject({
      level: "verified",
      label: "Verified provenance",
      missing: [],
    });
    expect(toneForDatasetTrustLevel(trust.level)).toBe("success");
  });

  it("keeps source-url datasets traceable when one audit artifact remains missing", () => {
    const trust = resolveDatasetTrustLabel({
      sourceUrl: "https://example.test/feed.geojson",
      licenseLabel: "CC BY 4.0",
      vintageLabel: "Fall 2025",
      lastRefreshedAt: "2026-05-09T12:00:00.000Z",
    });

    expect(trust.level).toBe("traceable");
    expect(trust.missing).toContain("citation");
    expect(trust.missing).toContain("checksum");
    expect(toneForDatasetTrustLevel(trust.level)).toBe("info");
  });

  it("separates partial and unverified provenance", () => {
    expect(resolveDatasetTrustLabel({ licenseLabel: "Vendor restricted" }).level).toBe("partial");
    expect(resolveDatasetTrustLabel({}).level).toBe("unverified");
    expect(toneForDatasetTrustLevel("partial")).toBe("warning");
    expect(toneForDatasetTrustLevel("unverified")).toBe("neutral");
  });
});

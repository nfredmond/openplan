import { describe, expect, it } from "vitest";
import {
  resolveDatasetLineageReadiness,
  toneForDatasetLineageReadiness,
} from "@/lib/data-sources/dataset-lineage-readiness";

describe("dataset lineage readiness", () => {
  it("marks datasets complete only when every lineage field is captured", () => {
    const readiness = resolveDatasetLineageReadiness({
      citationText: "Nevada County Transportation Commission RTP project list, 2026.",
      sourceUrl: "https://example.test/nctc/projects.geojson",
      licenseLabel: "Public agency source",
      vintageLabel: "2026 RTP update",
      schemaVersion: "openplan.data_hub.dataset.v1",
      checksum: "sha256:abc123",
      rowCount: 42,
      lastRefreshedAt: "2026-05-10T07:00:00.000Z",
      geographyScope: "corridor",
      geometryAttachment: "analysis_corridor",
    });

    expect(readiness).toMatchObject({
      level: "complete",
      label: "Lineage complete",
      readyCount: 10,
      totalCount: 10,
      missing: [],
    });
    expect(toneForDatasetLineageReadiness(readiness.level)).toBe("success");
  });

  it("keeps core-traceable datasets usable when two completion fields remain open", () => {
    const readiness = resolveDatasetLineageReadiness({
      citationText: "ACS 2023 5-year table B01003.",
      sourceUrl: "https://api.census.gov/data/2023/acs/acs5",
      licenseLabel: "Public domain",
      vintageLabel: "2023 ACS 5-year",
      rowCount: 0,
      lastRefreshedAt: "2026-05-10T07:00:00.000Z",
      geographyScope: "tract",
      geometryAttachment: "analysis_tracts",
    });

    expect(readiness.level).toBe("usable");
    expect(readiness.readyCount).toBe(8);
    expect(readiness.missing).toEqual(["Schema", "Checksum"]);
    expect(toneForDatasetLineageReadiness(readiness.level)).toBe("info");
  });

  it("does not count registry-only geometry attachment as complete lineage", () => {
    const readiness = resolveDatasetLineageReadiness({
      citationText: "Local project inventory.",
      sourceUrl: "https://example.test/inventory.csv",
      licenseLabel: "Agency use",
      vintageLabel: "Spring 2026",
      schemaVersion: "inventory.v1",
      checksum: "sha256:def456",
      rowCount: 12,
      lastRefreshedAt: "2026-05-10T07:00:00.000Z",
      geographyScope: "county",
      geometryAttachment: "none",
    });

    expect(readiness.level).toBe("usable");
    expect(readiness.missing).toContain("Geometry attachment");
  });

  it("separates partial and not-ready lineage", () => {
    expect(
      resolveDatasetLineageReadiness({
        citationText: "Source memo.",
        licenseLabel: "Unknown reuse",
        vintageLabel: "2025",
        geographyScope: "region",
      }).level
    ).toBe("partial");

    expect(resolveDatasetLineageReadiness({ sourceUrl: "https://example.test/data.csv" }).level).toBe("not_ready");
    expect(toneForDatasetLineageReadiness("partial")).toBe("warning");
    expect(toneForDatasetLineageReadiness("not_ready")).toBe("neutral");
  });
});

import { describe, expect, it } from "vitest";
import { buildSourceTransparency } from "@/lib/analysis/source-transparency";

function findItem(items: ReturnType<typeof buildSourceTransparency>, key: string) {
  return items.find((item) => item.key === key);
}

describe("buildSourceTransparency", () => {
  it("reports live statuses when measured sources backed the run", () => {
    const items = buildSourceTransparency(
      {
        dataQuality: {
          censusAvailable: true,
          crashDataAvailable: true,
          lodesSource: "lodes-api",
          equitySource: "cejst-proxy-census",
        },
        sourceSnapshots: {
          crashes: { source: "switrs-local" },
          transit: { source: "osm-overpass" },
          lodes: { source: "lodes-api" },
        },
      },
      "ai"
    );

    expect(findItem(items, "crashes")).toMatchObject({ status: "Live", tone: "success" });
    expect(findItem(items, "transit")).toMatchObject({ status: "Osm Overpass", tone: "info" });
    expect(findItem(items, "lodes")).toMatchObject({ status: "Lodes Api", tone: "info" });
  });

  it("labels estimated fallback sources as Estimated with a provenance note", () => {
    const items = buildSourceTransparency(
      {
        dataQuality: {
          censusAvailable: true,
          crashDataAvailable: false,
          lodesSource: "acs-estimate",
          equitySource: "cejst-proxy-census",
        },
        sourceSnapshots: {
          crashes: { source: "fars-estimate" },
          transit: { source: "estimate" },
          lodes: { source: "acs-estimate" },
        },
      },
      "ai"
    );

    const crashes = findItem(items, "crashes");
    expect(crashes?.status).toBe("Estimated");
    expect(crashes?.detail).toContain("Crash source API unavailable — area-based estimate.");

    const transit = findItem(items, "transit");
    expect(transit?.status).toBe("Estimated");
    expect(transit?.detail).toContain("Transit stop inventory unavailable — area-based estimate.");

    const lodes = findItem(items, "lodes");
    expect(lodes?.status).toBe("Estimated");
    expect(lodes?.detail).toContain("LODES employment not yet ingested — ACS-based estimate.");
  });

  it("marks unverifiable provenance as Unknown instead of claiming a live source", () => {
    const items = buildSourceTransparency({}, "fallback");

    expect(findItem(items, "crashes")).toMatchObject({ status: "Unknown", tone: "neutral" });
    expect(findItem(items, "transit")).toMatchObject({ status: "Unknown", tone: "neutral" });
    expect(findItem(items, "lodes")).toMatchObject({ status: "Unknown", tone: "neutral" });
  });

  it("supports historical runs that only carry dataQuality metadata", () => {
    const items = buildSourceTransparency(
      {
        dataQuality: {
          censusAvailable: true,
          crashDataAvailable: false,
          lodesSource: "acs-estimate",
        },
      },
      "fallback"
    );

    expect(findItem(items, "crashes")?.status).toBe("Estimated");
    expect(findItem(items, "lodes")?.status).toBe("Estimated");
    expect(findItem(items, "transit")?.status).toBe("Unknown");
  });
});

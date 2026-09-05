import { describe, expect, it } from "vitest";
import { buildCrashSourceSnapshot, describeCrashSafety, summarizeCrashFetch } from "@/lib/data-sources/crashes";
import { farsAdapter } from "@/lib/safety/sources/fars";
import { buildSafetyCrashEvidence, readSafetyCrashEvidenceIngest } from "@/lib/safety/crash-evidence";
import { readCrashPublicationEvidence } from "@/lib/safety/publication-evidence";

const observed = {
  observed: true as const,
  source: "fars-national",
  sourceLabel: "NHTSA Fatality Analysis Reporting System (FARS)",
  attribution: "NHTSA FARS",
  severityCompleteness: "fatal_only" as const,
  totalFatalCrashes: 1,
  totalFatalities: 1,
  pedestrianFatalities: 0,
  bicyclistFatalities: 0,
  severeInjuryCrashes: null,
  totalInjuryCrashes: null,
  yearsQueried: [2024],
  crashesPerSquareMile: 0.1,
  crashDensityBasis: "fatal_only" as const,
  unclassifiedCrashes: 0,
  reportedTotal: 1,
  mappedTotal: 1,
  truncated: false,
  points: [],
  checkedSources: ["fars-national"],
  unavailableReason: null,
};

describe("exact crash-source publication cutoffs", () => {
  it("can reread legacy evidence without losing its update date or changing the input", () => {
    const provenance = { label: "Resource last-modified metadata" };
    const first = readCrashPublicationEvidence("2026-09-05", provenance);
    const second = readCrashPublicationEvidence(first.publishedThrough, first.provenance);
    expect(second).toEqual(first);
    expect(second.resourceUpdateNote).toContain("Recorded file update: 2026-09-05");
    expect(provenance).toEqual({ label: "Resource last-modified metadata" });
  });

  it("retains source resource updates in Explore without presenting a cutoff", () => {
    const resourceUpdates = {
      basis: "resource_updates" as const,
      sourceUrl: "https://example.org/crashes",
      label: "Resource updates",
      retrievedAt: "2026-09-05T00:00:00Z",
      resources: [{ year: 2022, resourceId: "year-2022", lastModified: "2026-09-04T12:00:00Z" }],
    };
    const summary = summarizeCrashFetch(farsAdapter, {
      records: [], matchedTotal: 0, geocodedTotal: 0, yearsCovered: [2022], truncated: false, resourceUpdates,
    }, { minLon: 1, maxLon: 2, minLat: 1, maxLat: 2 }, [2022]);
    const snapshot = buildCrashSourceSnapshot(summary, "2026-09-05T00:00:00Z");
    expect(snapshot.publishedThrough).toBeUndefined();
    expect(snapshot.sourceResourceUpdates).toEqual(resourceUpdates);
    expect(snapshot.note).toContain("2022: 2026-09-04T12:00:00Z");
    expect(snapshot.note).toContain("not a crash-coverage cutoff");
  });

  it("does not revive a legacy resource update when rebuilding an analysis snapshot", () => {
    const legacy = { ...observed, publishedCutoff: {
      publishedThrough: "2026-09-05",
      provenance: { basis: "source_metadata" as const, label: "Resource last-modified metadata", sourceUrl: "https://example.org/data", retrievedAt: "2026-09-05T00:00:00Z" },
    } };
    const snapshot = buildCrashSourceSnapshot(legacy, "2026-09-05T00:00:00Z");
    expect(snapshot.publishedThrough).toBeUndefined();
    expect(snapshot.sourceResourceUpdates).toMatchObject({ legacyPublishedThrough: "2026-09-05" });
    expect(describeCrashSafety(legacy)).not.toContain("Source publication cutoff: 2026-09-05");
    expect(describeCrashSafety(legacy)).toContain("not a crash-coverage cutoff");
  });

  it("withholds a legacy last-modified date as coverage while retaining its evidence", () => {
    const row = {
      id: "legacy-resource-update",
      status: "ready",
      published_through: "2026-09-05",
      published_through_provenance: {
        basis: "source_metadata",
        label: "Yearly crash-resource last-modified metadata",
        sourceUrl: "https://example.org/crashes",
      },
    };
    const ingest = readSafetyCrashEvidenceIngest(row)!;
    const evidence = buildSafetyCrashEvidence(ingest, { severity: null, role: null });
    expect(evidence.publishedThrough).toBeNull();
    expect(evidence.caveats.join(" ")).toContain("2026-09-05");
    expect(evidence.caveats.join(" ")).toContain("not a crash-coverage cutoff");
    expect(evidence.caveats.join(" ")).not.toContain("published through 2026-09-05");
    expect(row.published_through).toBe("2026-09-05");
  });

  it("carries a source-published cutoff and provenance into the analysis snapshot", () => {
    const snapshot = buildCrashSourceSnapshot({
      ...observed,
      publishedCutoff: {
        publishedThrough: "2024-12-31",
        provenance: {
          basis: "source_metadata",
          sourceUrl: "https://www.nhtsa.gov/example",
          label: "2024 annual release",
          retrievedAt: "2026-08-24T00:00:00.000Z",
        },
      },
    }, "2026-08-24T20:00:00.000Z");
    expect(snapshot.publishedThrough).toBe("2024-12-31");
    expect(snapshot.publishedThroughProvenance).toMatchObject({ basis: "source_metadata" });
    expect(snapshot.publishedThroughNote).toBeUndefined();
    expect(snapshot.note).toContain("Source publication cutoff: 2024-12-31");
    expect(describeCrashSafety({ ...observed, publishedCutoff: {
      publishedThrough: "2024-12-31",
      provenance: {
        basis: "source_metadata",
        sourceUrl: "https://www.nhtsa.gov/example",
        label: "2024 annual release",
        retrievedAt: "2026-08-24T00:00:00.000Z",
      },
    } })).toContain("Source publication cutoff: 2024-12-31");
  });

  it("says the source supplied no exact cutoff instead of inferring one", () => {
    const snapshot = buildCrashSourceSnapshot(observed, "2026-08-24T20:00:00.000Z");
    expect(snapshot.publishedThrough).toBeUndefined();
    expect(snapshot.publishedThroughNote).toBe("The source supplied no exact publication cutoff.");
    expect(snapshot.note).toContain("source supplied no exact publication cutoff");
    expect(describeCrashSafety(observed)).toContain("source supplied no exact publication cutoff");
  });

  it("carries persisted cutoff metadata into Safety evidence and its caveats", () => {
    const ingest = readSafetyCrashEvidenceIngest({
      id: "11111111-1111-4111-8111-111111111111",
      project_id: null,
      status: "ready",
      source_label: observed.sourceLabel,
      attribution: observed.attribution,
      severity_completeness: "fatal_only",
      crash_count: 1,
      geocoded_count: 1,
      truncated: false,
      years_requested: [2024],
      created_at: "2026-08-24T20:00:00.000Z",
      dimension_coverage: {},
      party_completeness: "not_supported",
      party_count: null,
      involvement_basis: null,
      published_through: "2024-12-31",
      published_through_provenance: { basis: "source_metadata" },
    });
    expect(ingest).not.toBeNull();
    const evidence = buildSafetyCrashEvidence(ingest!, { severity: null, role: null });
    expect(evidence.publishedThrough).toBe("2024-12-31");
    expect(evidence.caveats.join(" ")).toContain("published through 2024-12-31");
  });
});

import { describe, expect, it } from "vitest";
import { buildCrashSourceSnapshot, describeCrashSafety } from "@/lib/data-sources/crashes";
import { buildSafetyCrashEvidence, readSafetyCrashEvidenceIngest } from "@/lib/safety/crash-evidence";

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

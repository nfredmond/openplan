import { describe, expect, it } from "vitest";
import {
  buildProjectGrantModelingEvidenceByProjectId,
  compareProjectGrantModelingEvidenceForQueue,
  describeProjectGrantModelingReadiness,
  getProjectGrantModelingQueuePriority,
  resolveProjectGrantModelingQueuePosture,
  type ProjectGrantModelingEvidence,
} from "@/lib/grants/modeling-evidence";

function buildEvidence(args: {
  title: string;
  freshnessLabel?: "Packet current" | "Refresh recommended" | "No packet";
  readyComparisons?: number;
  indicatorDeltas?: number;
  comparisonBackedCount?: number;
}): ProjectGrantModelingEvidence {
  const freshnessLabel = args.freshnessLabel ?? "Packet current";
  return {
    projectId: `${args.title.toLowerCase().replace(/\s+/g, "-")}-project`,
    comparisonBackedCount: args.comparisonBackedCount ?? 1,
    leadComparisonReport: {
      id: `${args.title.toLowerCase().replace(/\s+/g, "-")}-report`,
      title: args.title,
      href: "/reports/report-1#packet-release-review",
      packetFreshness: {
        label: freshnessLabel,
        tone: freshnessLabel === "Packet current" ? "success" : "warning",
        detail:
          freshnessLabel === "Packet current"
            ? "Packet is current."
            : "Packet refresh is recommended before operators lean on it.",
      },
      comparisonAggregate: {
        comparisonSnapshotCount: args.readyComparisons ?? 1,
        readyComparisonSnapshotCount: args.readyComparisons ?? 1,
        indicatorDeltaCount: args.indicatorDeltas ?? 3,
        latestComparisonSnapshotUpdatedAt: "2026-04-14T17:30:00.000Z",
      },
      comparisonDigest: {
        headline: `${args.readyComparisons ?? 1} saved comparison · ${args.readyComparisons ?? 1} ready`,
        detail: `${args.indicatorDeltas ?? 3} indicator deltas are already summarized.`,
      },
    },
  };
}

describe("buildProjectGrantModelingEvidenceByProjectId", () => {
  it("surfaces the lead comparison-backed packet for each project", () => {
    const evidenceByProjectId = buildProjectGrantModelingEvidenceByProjectId(
      [
        {
          id: "report-1",
          project_id: "project-1",
          title: "Mobility Grant Packet",
          updated_at: "2026-04-14T18:00:00.000Z",
          generated_at: "2026-04-14T18:00:00.000Z",
          latest_artifact_kind: "html",
        },
        {
          id: "report-2",
          project_id: "project-1",
          title: "Older Packet",
          updated_at: "2026-04-10T18:00:00.000Z",
          generated_at: "2026-04-10T18:00:00.000Z",
          latest_artifact_kind: "html",
        },
        {
          id: "report-3",
          project_id: "project-2",
          title: "No Comparison Packet",
          updated_at: "2026-04-14T18:00:00.000Z",
          generated_at: "2026-04-14T18:00:00.000Z",
          latest_artifact_kind: "html",
        },
      ],
      [
        {
          report_id: "report-1",
          generated_at: "2026-04-14T18:00:00.000Z",
          metadata_json: {
            sourceContext: {
              scenarioSetLinks: [
                {
                  comparisonSnapshots: [
                    {
                      status: "ready",
                      indicatorDeltaCount: 3,
                      updatedAt: "2026-04-14T17:30:00.000Z",
                    },
                  ],
                },
              ],
            },
          },
        },
        {
          report_id: "report-2",
          generated_at: "2026-04-10T18:00:00.000Z",
          metadata_json: {
            sourceContext: {
              scenarioSetLinks: [
                {
                  comparisonSnapshots: [
                    {
                      status: "ready",
                      indicatorDeltaCount: 1,
                      updatedAt: "2026-04-10T17:30:00.000Z",
                    },
                  ],
                },
              ],
            },
          },
        },
        {
          report_id: "report-3",
          generated_at: "2026-04-14T18:00:00.000Z",
          metadata_json: {
            sourceContext: {
              scenarioSetLinks: [],
            },
          },
        },
      ]
    );

    expect(evidenceByProjectId.size).toBe(1);
    const projectOneEvidence = evidenceByProjectId.get("project-1");

    expect(projectOneEvidence).toMatchObject({
      comparisonBackedCount: 2,
      leadComparisonReport: {
        id: "report-1",
        title: "Mobility Grant Packet",
        href: "/reports/report-1#packet-release-review",
        comparisonAggregate: {
          comparisonSnapshotCount: 1,
          readyComparisonSnapshotCount: 1,
          indicatorDeltaCount: 3,
        },
        comparisonDigest: {
          headline: "1 saved comparison · 1 ready",
        },
        packetFreshness: {
          label: "Packet current",
        },
      },
    });
    expect(projectOneEvidence?.leadComparisonReport.comparisonDigest.detail).toContain("3 indicator deltas");
    expect(evidenceByProjectId.has("project-2")).toBe(false);
  });

  it("prefers a fresher packet posture when choosing the lead supporting report", () => {
    const evidenceByProjectId = buildProjectGrantModelingEvidenceByProjectId(
      [
        {
          id: "report-refresh",
          project_id: "project-1",
          title: "Needs Refresh",
          updated_at: "2026-04-14T18:30:00.000Z",
          generated_at: "2026-04-14T18:00:00.000Z",
          latest_artifact_kind: "html",
        },
        {
          id: "report-current",
          project_id: "project-1",
          title: "Current Packet",
          updated_at: "2026-04-14T17:00:00.000Z",
          generated_at: "2026-04-14T17:00:00.000Z",
          latest_artifact_kind: "html",
        },
      ],
      [
        {
          report_id: "report-refresh",
          generated_at: "2026-04-14T18:00:00.000Z",
          metadata_json: {
            sourceContext: {
              scenarioSetLinks: [
                {
                  comparisonSnapshots: [{ status: "ready", indicatorDeltaCount: 2 }],
                },
              ],
            },
          },
        },
        {
          report_id: "report-current",
          generated_at: "2026-04-14T17:00:00.000Z",
          metadata_json: {
            sourceContext: {
              scenarioSetLinks: [
                {
                  comparisonSnapshots: [{ status: "ready", indicatorDeltaCount: 1 }],
                },
              ],
            },
          },
        },
      ]
    );

    expect(evidenceByProjectId.get("project-1")?.leadComparisonReport.title).toBe("Current Packet");
    expect(evidenceByProjectId.get("project-1")?.leadComparisonReport.packetFreshness.label).toBe("Packet current");
  });

  it("classifies grant modeling readiness as decision-ready, stale, or thin", () => {
    const decisionReadyEvidence = buildProjectGrantModelingEvidenceByProjectId(
      [
        {
          id: "report-current",
          project_id: "project-1",
          title: "Current Packet",
          updated_at: "2026-04-14T18:00:00.000Z",
          generated_at: "2026-04-14T18:00:00.000Z",
          latest_artifact_kind: "html",
        },
      ],
      [
        {
          report_id: "report-current",
          generated_at: "2026-04-14T18:00:00.000Z",
          metadata_json: {
            sourceContext: {
              scenarioSetLinks: [
                {
                  comparisonSnapshots: [
                    { status: "ready", indicatorDeltaCount: 2, updatedAt: "2026-04-14T17:30:00.000Z" },
                  ],
                },
              ],
            },
          },
        },
      ]
    ).get("project-1");

    const staleEvidence = buildProjectGrantModelingEvidenceByProjectId(
      [
        {
          id: "report-stale",
          project_id: "project-2",
          title: "Stale Packet",
          updated_at: "2026-04-14T19:00:00.000Z",
          generated_at: "2026-04-14T18:00:00.000Z",
          latest_artifact_kind: "html",
        },
      ],
      [
        {
          report_id: "report-stale",
          generated_at: "2026-04-14T18:00:00.000Z",
          metadata_json: {
            sourceContext: {
              scenarioSetLinks: [
                {
                  comparisonSnapshots: [
                    { status: "ready", indicatorDeltaCount: 1, updatedAt: "2026-04-14T17:30:00.000Z" },
                  ],
                },
              ],
            },
          },
        },
      ]
    ).get("project-2");

    const thinEvidence = buildProjectGrantModelingEvidenceByProjectId(
      [
        {
          id: "report-thin",
          project_id: "project-3",
          title: "Thin Packet",
          updated_at: "2026-04-14T18:00:00.000Z",
          generated_at: "2026-04-14T18:00:00.000Z",
          latest_artifact_kind: "html",
        },
      ],
      [
        {
          report_id: "report-thin",
          generated_at: "2026-04-14T18:00:00.000Z",
          metadata_json: {
            sourceContext: {
              scenarioSetLinks: [
                {
                  comparisonSnapshots: [
                    { status: "draft", indicatorDeltaCount: 0, updatedAt: "2026-04-14T17:30:00.000Z" },
                  ],
                },
              ],
            },
          },
        },
      ]
    ).get("project-3");

    expect(describeProjectGrantModelingReadiness(decisionReadyEvidence)).toMatchObject({
      key: "decision-ready",
      label: "Appears decision-ready",
      tone: "success",
    });
    expect(describeProjectGrantModelingReadiness(staleEvidence)).toMatchObject({
      key: "stale",
      label: "Refresh recommended",
      tone: "warning",
    });
    expect(describeProjectGrantModelingReadiness(thinEvidence)).toMatchObject({
      key: "thin",
      label: "Appears thin",
      tone: "neutral",
    });
  });
});

describe("grants modeling evidence queue posture", () => {
  it("maps readiness into queue posture in grants order", () => {
    const decisionReady = buildEvidence({ title: "Decision-ready packet" });
    const refreshRecommended = buildEvidence({
      title: "Stale packet",
      freshnessLabel: "Refresh recommended",
    });
    const thin = buildEvidence({
      title: "Thin packet",
      readyComparisons: 0,
      indicatorDeltas: 0,
    });

    expect(resolveProjectGrantModelingQueuePosture(decisionReady)).toBe("decision-ready");
    expect(resolveProjectGrantModelingQueuePosture(refreshRecommended)).toBe("refresh-recommended");
    expect(resolveProjectGrantModelingQueuePosture(thin)).toBe("thin");
    expect(resolveProjectGrantModelingQueuePosture(null)).toBe("no-visible-support");

    expect(getProjectGrantModelingQueuePriority(decisionReady)).toBeLessThan(
      getProjectGrantModelingQueuePriority(refreshRecommended)
    );
    expect(getProjectGrantModelingQueuePriority(refreshRecommended)).toBeLessThan(
      getProjectGrantModelingQueuePriority(thin)
    );
    expect(getProjectGrantModelingQueuePriority(thin)).toBeLessThan(
      getProjectGrantModelingQueuePriority(null)
    );
  });

  it("prefers stronger modeling evidence when two queue items share the same posture", () => {
    const stronger = buildEvidence({
      title: "Stronger packet",
      comparisonBackedCount: 2,
      readyComparisons: 2,
      indicatorDeltas: 5,
    });
    const weaker = buildEvidence({
      title: "Weaker packet",
      comparisonBackedCount: 1,
      readyComparisons: 1,
      indicatorDeltas: 2,
    });

    expect(compareProjectGrantModelingEvidenceForQueue(stronger, weaker)).toBeLessThan(0);
    expect(compareProjectGrantModelingEvidenceForQueue(weaker, stronger)).toBeGreaterThan(0);
  });
});

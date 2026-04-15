import { describe, expect, it } from "vitest";
import {
  buildProjectGrantModelingEvidenceByProjectId,
  describeProjectGrantModelingReadiness,
} from "@/lib/grants/modeling-evidence";

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

import { describe, expect, it } from "vitest";
import { buildProjectSpineReadinessRollup } from "@/lib/projects/spine-readiness";

const baseInput = {
  projectUpdatedAt: "2026-05-01T09:00:00.000Z",
  latestPacketGeneratedAt: "2026-05-03T12:00:00.000Z",
  rtp: { count: 1, latestUpdatedAt: "2026-05-01T10:00:00.000Z", postureUpdatedAt: "2026-05-02T10:00:00.000Z" },
  reports: {
    count: 2,
    latestUpdatedAt: "2026-05-02T11:00:00.000Z",
    refreshRecommendedCount: 0,
    noPacketCount: 0,
    governanceHoldCount: 0,
    evidenceBackedCount: 1,
    comparisonBackedCount: 1,
  },
  grants: { count: 2, latestUpdatedAt: "2026-05-02T10:00:00.000Z" },
  engagement: { count: 1, latestUpdatedAt: "2026-05-02T09:00:00.000Z" },
  analysis: { count: 1, latestUpdatedAt: "2026-05-02T08:00:00.000Z", evidenceBackedReportCount: 1 },
  aerial: {
    count: 2,
    latestUpdatedAt: "2026-05-02T07:00:00.000Z",
    missionCount: 1,
    packageCount: 1,
    readyPackageCount: 1,
    verificationReadiness: "ready",
  },
};

describe("project spine readiness rollup", () => {
  it("marks the shared planning spine ready/current when all visible lanes are linked and reviewed", () => {
    const rollup = buildProjectSpineReadinessRollup(baseInput);

    expect(rollup.status).toBe("ready_current");
    expect(rollup.readyCount).toBe(6);
    expect(rollup.staleCount).toBe(0);
    expect(rollup.missingCount).toBe(0);
    expect(rollup.lanes.map((lane) => lane.key)).toEqual([
      "rtp",
      "reports",
      "grants",
      "engagement",
      "analysis",
      "aerial",
    ]);
  });

  it("flags stale/needs review when connected records changed after the latest generated packet", () => {
    const rollup = buildProjectSpineReadinessRollup({
      ...baseInput,
      grants: { count: 2, latestUpdatedAt: "2026-05-04T10:00:00.000Z" },
      engagement: { count: 1, latestUpdatedAt: "2026-05-04T09:00:00.000Z" },
      reports: {
        ...baseInput.reports,
        refreshRecommendedCount: 1,
      },
    });

    expect(rollup.status).toBe("stale_needs_review");
    expect(rollup.staleCount).toBe(3);
    expect(rollup.lanes.find((lane) => lane.key === "grants")?.status).toBe("stale_needs_review");
    expect(rollup.lanes.find((lane) => lane.key === "engagement")?.detail).toContain("latest campaign status");
    expect(rollup.detail).toContain("not automatically certifying");
  });

  it("keeps missing/not linked separate from stale records", () => {
    const rollup = buildProjectSpineReadinessRollup({
      ...baseInput,
      rtp: { count: 0, latestUpdatedAt: null, postureUpdatedAt: null },
      reports: {
        count: 0,
        latestUpdatedAt: null,
        refreshRecommendedCount: 0,
        noPacketCount: 0,
        evidenceBackedCount: 0,
        comparisonBackedCount: 0,
      },
      engagement: { count: 0, latestUpdatedAt: null },
      analysis: { count: 0, latestUpdatedAt: null, evidenceBackedReportCount: 0 },
      aerial: {
        count: 0,
        latestUpdatedAt: null,
        missionCount: 0,
        packageCount: 0,
        readyPackageCount: 0,
        verificationReadiness: "none",
      },
    });

    expect(rollup.status).toBe("missing_not_linked");
    expect(rollup.missingCount).toBe(5);
    expect(rollup.staleCount).toBe(0);
    expect(rollup.lanes.find((lane) => lane.key === "grants")?.status).toBe("ready_current");
    expect(rollup.lanes.find((lane) => lane.key === "analysis")?.headline).toContain("No linked analysis evidence");
  });

  it("flags aerial evidence as needs review until packages are ready and verification is explicit", () => {
    const rollup = buildProjectSpineReadinessRollup({
      ...baseInput,
      aerial: {
        count: 1,
        latestUpdatedAt: "2026-05-02T07:00:00.000Z",
        missionCount: 1,
        packageCount: 1,
        readyPackageCount: 0,
        verificationReadiness: "pending",
      },
    });

    const aerial = rollup.lanes.find((lane) => lane.key === "aerial");
    expect(aerial?.status).toBe("stale_needs_review");
    expect(aerial?.detail).toContain("0/1 packages are ready");
  });

  it("keeps report governance holds visible in the shared project spine", () => {
    const rollup = buildProjectSpineReadinessRollup({
      ...baseInput,
      reports: {
        ...baseInput.reports,
        governanceHoldCount: 1,
      },
    });

    const reports = rollup.lanes.find((lane) => lane.key === "reports");
    expect(rollup.status).toBe("stale_needs_review");
    expect(reports?.status).toBe("stale_needs_review");
    expect(reports?.detail).toContain("1 governance hold");
  });
});

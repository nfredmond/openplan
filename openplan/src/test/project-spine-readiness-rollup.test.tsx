import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectSpineReadinessRollup } from "@/app/(app)/projects/[projectId]/_components/project-spine-readiness-rollup";
import { buildProjectSpineReadinessRollup, type BuildProjectSpineReadinessInput } from "@/lib/projects/spine-readiness";

const baseInput: BuildProjectSpineReadinessInput = {
  projectUpdatedAt: "2026-05-02T09:00:00.000Z",
  latestPacketGeneratedAt: "2026-05-02T12:00:00.000Z",
  rtp: {
    count: 1,
    latestUpdatedAt: "2026-05-02T10:00:00.000Z",
    postureUpdatedAt: "2026-05-02T11:00:00.000Z",
  },
  reports: {
    count: 2,
    latestUpdatedAt: "2026-05-02T11:00:00.000Z",
    refreshRecommendedCount: 0,
    noPacketCount: 0,
    governanceHoldCount: 0,
    evidenceBackedCount: 1,
    comparisonBackedCount: 1,
  },
  grants: {
    count: 1,
    latestUpdatedAt: "2026-05-02T11:00:00.000Z",
  },
  engagement: {
    count: 1,
    latestUpdatedAt: "2026-05-02T11:00:00.000Z",
  },
  analysis: {
    count: 1,
    latestUpdatedAt: "2026-05-02T11:00:00.000Z",
    evidenceBackedReportCount: 1,
  },
  aerial: {
    count: 1,
    latestUpdatedAt: "2026-05-02T11:00:00.000Z",
    missionCount: 1,
    packageCount: 1,
    readyPackageCount: 1,
    verificationReadiness: "ready",
  },
};

describe("ProjectSpineReadinessRollup", () => {
  it("surfaces the first stale lane as the operator check", () => {
    const rollup = buildProjectSpineReadinessRollup({
      ...baseInput,
      reports: {
        ...baseInput.reports,
        governanceHoldCount: 1,
      },
    });

    render(<ProjectSpineReadinessRollup rollup={rollup} />);

    expect(screen.getByText("First operator check")).toBeInTheDocument();
    expect(screen.getAllByText("Report packets").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 governance hold.").length).toBeGreaterThan(0);
    expect(screen.getByText("At least one report packet has a governance hold to review.")).toBeInTheDocument();
  });

  it("falls back to the first missing lane when no lane is stale", () => {
    const rollup = buildProjectSpineReadinessRollup({
      ...baseInput,
      rtp: {
        ...baseInput.rtp,
        count: 0,
      },
    });

    render(<ProjectSpineReadinessRollup rollup={rollup} />);

    expect(screen.getByText("First operator check")).toBeInTheDocument();
    expect(screen.getAllByText("RTP portfolio").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Attach this project to the relevant RTP cycle before treating it as part of a regional portfolio.").length
    ).toBeGreaterThan(0);
  });
});

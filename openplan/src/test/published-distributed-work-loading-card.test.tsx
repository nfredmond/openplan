import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PublishedDistributedWorkLoadingCard } from "@/components/models/published-distributed-work-loading-card";

describe("PublishedDistributedWorkLoadingCard", () => {
  it("keeps the scientific boundary visible and exposes method-specific downloads", () => {
    render(<PublishedDistributedWorkLoadingCard study={{
      version: "0.44.0", releaseSha: "a".repeat(40), createdAt: "2026-08-31T23:30:00Z",
      scientificOutcome: "inconclusive", candidateAdvanced: false,
      records: (["aequilibrae", "activitysim"] as const).map((method) => ({
        geographyId: "fixture", geographyName: "Fixture geography", method,
        inputPath: `data/${method}-input.json`, inputStoredPath: `data/${method}-input.json.gz`, inputSha256: "b".repeat(64),
        auditPath: `data/${method}-audit.json`, auditSha256: "c".repeat(64),
        comparisonPath: `data/${method}-comparison.json`, comparisonStoredPath: `data/${method}-comparison.json.gz`, comparisonSha256: "d".repeat(64),
        accessPointCount: 100, retainedAccessPointCount: 3, originalWorkTrips: 200, distributedWorkTrips: 190, retainedWorkTrips: 10,
        baselineCoverage: { loaded: 1 }, candidateCoverage: { loaded: 2 }, advanced: false,
      })),
    }} />);
    expect(screen.getByText(/does not change model defaults/i)).toBeInTheDocument();
    expect(screen.getByText(/No average or national rescue/i)).toBeInTheDocument();
    expect(screen.getByTestId("selected-distributed-work-loading")).toHaveTextContent("aequilibrae");
    expect(screen.getByText("b".repeat(64))).toHaveClass("break-all");
    expect(screen.getByRole("link", { name: "Download selected before-output audit" })).toHaveAttribute("href", expect.stringContaining("fixture/aequilibrae/"));
    fireEvent.click(screen.getByRole("button", { name: "ActivitySim" }));
    expect(screen.getByTestId("selected-distributed-work-loading")).toHaveTextContent("activitysim");
    expect(screen.getByText("c".repeat(64))).toHaveClass("break-all");
  });
});

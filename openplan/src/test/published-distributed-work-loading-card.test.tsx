import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PublishedDistributedWorkLoadingCard } from "@/components/models/published-distributed-work-loading-card";

describe("PublishedDistributedWorkLoadingCard", () => {
  it("discloses unavailable evidence without showing zero or download claims", () => {
    render(<PublishedDistributedWorkLoadingCard study={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Development evidence unavailable");
    expect(screen.getByRole("status")).toHaveTextContent("unavailable, not zero");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("keeps the scientific boundary visible and exposes method-specific downloads", () => {
    render(<PublishedDistributedWorkLoadingCard study={{
      version: "0.44.0", releaseSha: "a".repeat(40), createdAt: "2026-08-31T23:30:00Z",
      scientificOutcome: "inconclusive", candidateAdvanced: false,
      recordedConfiguration: {
        registryPath: "scripts/modeling/development/california_distributed_work_loading_study.v1.json", registrySha256: "e".repeat(64),
        arbitraryPointCap: null, arbitraryGatewayCap: null, aggregateOnlySameRoutableNode: true,
        preserveMethodWorkTotals: true, nonWorkUnchanged: true, acceptanceHoldoutOpened: false,
        legacyPathNote: "Legacy ActivitySim 'holdout' paths are previously consumed development inputs, not untouched acceptance evidence.",
        sourceRelease: "LODES 8.4", sourceYear: 2023,
        sourceLimitation: "LODES describes jobs and home-to-work relationships. It does not describe all-purpose travel or vehicle trips.",
      },
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
    const card = screen.getByTestId("published-distributed-work-loading");
    expect(card).toHaveTextContent("1 counties · 2 separate method results");
    expect(card).not.toHaveTextContent("7 counties");
    expect(card).toHaveTextContent("LODES 8.4 (2023) supplies endpoint weights for existing modeled work demand");
    expect(card).toHaveTextContent("It does not describe all-purpose travel or vehicle trips");
    expect(card).toHaveTextContent("These weights are not observed vehicle or all-purpose trip counts");
    const disclosure = screen.getByRole("region", { name: "Saved study configuration and evidence" });
    expect(disclosure).toHaveTextContent("saved development setup, not independent scientific acceptance or measured accuracy");
    expect(disclosure).toHaveTextContent("Arbitrary point capNone recorded (null)");
    expect(disclosure).toHaveTextContent("Arbitrary gateway capNone recorded (null)");
    expect(disclosure).toHaveTextContent("Aggregate only at the same routable node");
    expect(disclosure).toHaveTextContent("Preserve each method's work total. Non-work trips keep their prior centroid loading");
    expect(disclosure).toHaveTextContent("Acceptance holdout openedNo, according to the saved evidence");
    expect(disclosure).toHaveTextContent("previously consumed development inputs, not untouched acceptance evidence");
    expect(disclosure).toHaveTextContent("Study, audit and comparison files also report no holdout access");
    expect(disclosure).toHaveTextContent("does not establish calibration, validation, statewide completeness or nationwide accuracy");
    expect(card).toHaveTextContent("inconclusive");
    expect(card).toHaveTextContent("Candidate retained and retired");
    expect(screen.getByText(/No average or national rescue/i)).toBeInTheDocument();
    expect(screen.getByTestId("selected-distributed-work-loading")).toHaveTextContent("aequilibrae");
    for (const name of ["distributed-work-loading-input-v1.json", "pre-output-audit-v1.json", "development-comparison-v1.json"]) {
      expect(screen.getByText(`fixture-aequilibrae-${name}`)).toBeVisible();
    }
    expect(screen.getByText("b".repeat(64))).toHaveClass("break-all");
    expect(screen.getByRole("link", { name: "Download selected before-output audit" })).toHaveAttribute("href", expect.stringContaining("fixture/aequilibrae/"));
    fireEvent.click(screen.getByRole("button", { name: "ActivitySim" }));
    expect(screen.getByTestId("selected-distributed-work-loading")).toHaveTextContent("activitysim");
    for (const name of ["distributed-work-loading-input-v1.json", "pre-output-audit-v1.json", "development-comparison-v1.json"]) {
      expect(screen.getByText(`fixture-activitysim-${name}`)).toBeVisible();
      expect(screen.queryByText(`fixture-aequilibrae-${name}`)).not.toBeInTheDocument();
    }
    expect(screen.getByText("c".repeat(64))).toHaveClass("break-all");
    // Downloads must not enter Next's page-navigation state after an attachment.
    for (const link of screen.getAllByRole("link", { name: /^Download / })) {
      expect(link).toHaveAttribute("download");
    }
  });
});

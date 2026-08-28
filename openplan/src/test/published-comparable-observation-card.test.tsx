import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PublishedComparableObservationCard } from "@/components/models/published-comparable-observation-card";

describe("PublishedComparableObservationCard", () => {
  it("states the repaired-instrument boundary and exposes exact downloads", () => {
    render(<PublishedComparableObservationCard study={{
      version: "0.41.0",
      releaseSha: "a".repeat(40),
      createdAt: "2026-08-28T12:00:00Z",
      scientificOutcome: "inconclusive",
      diagnoses: ["aequilibrae", "activitysim"].map((method) => ({
        geographyId: "06007",
        method: method as "aequilibrae" | "activitysim",
        path: `data/${method}.json`,
        sha256: "b".repeat(64),
        coverage: { matched: 4, ambiguous: 8 },
        bindings: {},
      })),
    }} />);
    expect(screen.getByText(/not improved model accuracy/i)).toBeInTheDocument();
    expect(screen.getByText(/synthetic expanded daily traffic, not AADT/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "observations" })).toHaveAttribute("href", expect.stringContaining("observation-package-v2.json"));
    expect(screen.getAllByRole("link", { name: /assessment/ })).toHaveLength(2);
  });
});

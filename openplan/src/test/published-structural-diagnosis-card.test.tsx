import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PublishedStructuralDiagnosisCard } from "@/components/models/published-structural-diagnosis-card";

describe("published structural diagnosis Models card", () => {
  it("shows the unchanged outcome, boundaries, hashes, and exact downloads", () => {
    render(<PublishedStructuralDiagnosisCard study={{
      appVersion: "0.40.0",
      createdAt: "2026-08-28T18:45:00Z",
      gitSha: "a".repeat(40),
      scientificOutcome: "inconclusive",
      records: [
        {
          geographyId: "06007",
          method: "aequilibrae",
          diagnosisPath: "data/example.json",
          diagnosisSha256: "b".repeat(64),
          findingCounts: {
            missing_usable_point_coordinates: 56,
            frozen_matched_links_with_zero_assigned_volume: 4,
          },
        },
        {
          geographyId: "06007",
          method: "activitysim",
          diagnosisPath: "data/example-2.json",
          diagnosisSha256: "c".repeat(64),
          findingCounts: {
            missing_usable_point_coordinates: 56,
            frozen_matched_links_with_zero_assigned_volume: 4,
          },
        },
      ],
    }} />);
    const card = screen.getByRole("region", { name: "Frozen structural diagnosis" });
    expect(card).toHaveTextContent("Why all fourteen assessments are inconclusive");
    expect(card).toHaveTextContent("does not calibrate a model, average methods");
    expect(card).toHaveTextContent("Model year, day represented, coefficients, and population vintage remain unknown");
    expect(card).toHaveTextContent("b".repeat(64));
    expect(screen.getByRole("link", { name: "Download exact study result" })).toHaveAttribute(
      "href",
      "/api/models/validation-structural-diagnosis/study-result.json",
    );
    expect(card.querySelector("div.sm\\:grid-cols-2")).toHaveClass("grid-cols-1", "lg:grid-cols-3");
  });
});

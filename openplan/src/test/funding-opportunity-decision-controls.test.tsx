import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

import { FundingOpportunityDecisionControls } from "@/components/programs/funding-opportunity-decision-controls";

describe("FundingOpportunityDecisionControls", () => {
  beforeEach(() => {
    refreshMock.mockReset();
  });

  it("surfaces modeling-backed guidance and inserts support into editable decision fields", () => {
    render(
      <FundingOpportunityDecisionControls
        opportunityId="opp-1"
        initialDecisionState="monitor"
        initialReadinessNotes="Need local match confirmation."
        initialDecisionRationale=""
        modelingSupport={{
          title: "Mobility Grant Packet",
          summary:
            "Mobility Grant Packet carries current comparison-backed planning support with ready saved comparisons and visible indicator deltas. 3 indicator deltas are already summarized. Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review.",
          readinessNoteSuggestion:
            "Recommended next action: advance this opportunity to pursue now because modeling posture appears decision-ready in Mobility Grant Packet. 1 saved comparison · 1 ready. Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review.",
          decisionRationaleSuggestion:
            "Advance this opportunity to pursue now because Mobility Grant Packet appears decision-ready as planning support for prioritization. 1 saved comparison · 1 ready. Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review.",
          recommendedNextActionTitle: "Advance to pursue now",
          recommendedNextActionSummary:
            "Mobility Grant Packet appears decision-ready, so operators can advance this opportunity to pursue now while the packet is current. Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review.",
          recommendedDecisionState: "pursue",
        }}
      />
    );

    expect(screen.getByText("Modeling-aware decision support")).toBeInTheDocument();
    expect(screen.getByText("Recommended next action")).toBeInTheDocument();
    expect(screen.getByText("Advance to pursue now")).toBeInTheDocument();
    expect(
      screen.getAllByText(/planning support only, not proof of award likelihood/i).length
    ).toBeGreaterThan(0);

    const applyRecommendationButton = screen.getByRole("button", {
      name: /Set decision to Pursue/i,
    });
    fireEvent.click(applyRecommendationButton);
    expect(screen.getByLabelText("Decision state")).toHaveValue("pursue");
    expect(
      screen.getByRole("button", { name: /Decision already set to Pursue/i })
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Use in readiness notes/i }));
    fireEvent.click(screen.getByRole("button", { name: /Use in rationale/i }));

    expect(screen.getByLabelText("Readiness notes")).toHaveValue(
      "Need local match confirmation.\n\nRecommended next action: advance this opportunity to pursue now because modeling posture appears decision-ready in Mobility Grant Packet. 1 saved comparison · 1 ready. Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review."
    );
    expect(screen.getByLabelText("Decision rationale")).toHaveValue(
      "Advance this opportunity to pursue now because Mobility Grant Packet appears decision-ready as planning support for prioritization. 1 saved comparison · 1 ready. Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review."
    );

    fireEvent.click(screen.getByRole("button", { name: /Use in rationale/i }));
    expect(screen.getByLabelText("Decision rationale")).toHaveValue(
      "Advance this opportunity to pursue now because Mobility Grant Packet appears decision-ready as planning support for prioritization. 1 saved comparison · 1 ready. Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review."
    );
  });
});

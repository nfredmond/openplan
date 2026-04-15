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
            "Saved comparison context from Mobility Grant Packet can support readiness and prioritization language for this opportunity. 3 indicator deltas are already summarized. Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review.",
          readinessNoteSuggestion:
            "Modeling support from Mobility Grant Packet: 1 saved comparison · 1 ready. 3 indicator deltas are already summarized. Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review.",
          decisionRationaleSuggestion:
            "Decision context can cite Mobility Grant Packet as modeling-backed planning support for prioritization. 1 saved comparison · 1 ready. 3 indicator deltas are already summarized. Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review.",
        }}
      />
    );

    expect(screen.getByText("Modeling-backed decision support")).toBeInTheDocument();
    expect(screen.getByText(/planning support only, not proof of award likelihood/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Use in readiness notes/i }));
    fireEvent.click(screen.getByRole("button", { name: /Use in rationale/i }));

    expect(screen.getByLabelText("Readiness notes")).toHaveValue(
      "Need local match confirmation.\n\nModeling support from Mobility Grant Packet: 1 saved comparison · 1 ready. 3 indicator deltas are already summarized. Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review."
    );
    expect(screen.getByLabelText("Decision rationale")).toHaveValue(
      "Decision context can cite Mobility Grant Packet as modeling-backed planning support for prioritization. 1 saved comparison · 1 ready. 3 indicator deltas are already summarized. Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review."
    );

    fireEvent.click(screen.getByRole("button", { name: /Use in rationale/i }));
    expect(screen.getByLabelText("Decision rationale")).toHaveValue(
      "Decision context can cite Mobility Grant Packet as modeling-backed planning support for prioritization. 1 saved comparison · 1 ready. 3 indicator deltas are already summarized. Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review."
    );
  });
});

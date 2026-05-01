import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExploreDisclosureCard } from "@/app/(app)/explore/_components/explore-disclosure-card";
import { ExploreEmptyResultBoard } from "@/app/(app)/explore/_components/explore-empty-result-board";
import type { DisclosureItem } from "@/app/(app)/explore/_components/explore-results-types";

const disclosureItems: DisclosureItem[] = [
  {
    title: "AI acceleration",
    detail: "AI is used to accelerate drafting and interpretation; final analysis and conclusions still require human review and approval.",
    tone: "info",
  },
  {
    title: "Verification gate",
    detail: "Regulatory and policy-sensitive claims should be citation-backed or explicitly marked for verification before release.",
    tone: "warning",
  },
  {
    title: "Source limitations",
    detail: "This run relies on available source data and proxy methods where direct sources are unavailable or incomplete.",
    tone: "neutral",
  },
];

describe("Explore empty and disclosure surfaces", () => {
  it("renders the no-analysis board with the next operator step", () => {
    render(<ExploreEmptyResultBoard />);

    expect(screen.getByText("Result board")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "No analysis selected" })).toBeInTheDocument();
    expect(screen.getByText("Run a corridor analysis or load a prior run to review metrics, narrative output, and comparisons.")).toBeInTheDocument();
    expect(screen.getByText("Next step")).toBeInTheDocument();
    expect(screen.getByText("Upload a corridor, enter the planning question, and run the study to populate this board.")).toBeInTheDocument();
  });

  it("renders disclosure guardrails and classifies each disclosure item by tone", () => {
    render(<ExploreDisclosureCard disclosureItems={disclosureItems} />);

    expect(screen.getByText("Release guardrail")).toBeInTheDocument();
    expect(screen.getByText("Client-safe disclosure")).toBeInTheDocument();
    expect(screen.getByText("Human approval required")).toBeInTheDocument();
    expect(screen.getByText("Methods, Assumptions & AI Disclosure")).toBeInTheDocument();
    expect(
      screen.getByText("Audit notes that should travel with this result before it becomes a client memo, grant attachment, or public-facing narrative.")
    ).toBeInTheDocument();
    expect(screen.getByText("Operator release note")).toBeInTheDocument();
    expect(
      screen.getByText("Treat the cards above as working analysis surfaces, not self-certifying deliverables. Before external use, verify citations, source posture, and equity implications.")
    ).toBeInTheDocument();

    expect(screen.getByText("AI acceleration")).toBeInTheDocument();
    expect(screen.getByText("Verification gate")).toBeInTheDocument();
    expect(screen.getByText("Source limitations")).toBeInTheDocument();
    expect(screen.getByText(disclosureItems[0].detail)).toBeInTheDocument();
    expect(screen.getByText(disclosureItems[1].detail)).toBeInTheDocument();
    expect(screen.getByText(disclosureItems[2].detail)).toBeInTheDocument();
    expect(screen.getByText("Disclosure")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Assumption")).toBeInTheDocument();
  });
});

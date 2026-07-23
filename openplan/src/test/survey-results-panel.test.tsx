import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EngagementSurveyResults } from "@/components/engagement/survey-results-panel";
import type { SurveyQuestionAggregation } from "@/lib/engagement/survey-responses";

const questions: SurveyQuestionAggregation[] = [
  {
    questionId: "q1",
    questionType: "single_choice",
    family: "choice",
    prompt: "Top priority?",
    answeredCount: 12,
    aggregation: { n: 12, lowN: false, rows: [{ option_id: "a", label: "Bike lane", count: 8, pct: 8 / 12 }, { option_id: "b", label: "Bus stop", count: 4, pct: 4 / 12 }], otherTexts: [] },
  },
  {
    questionId: "q2",
    questionType: "free_text",
    family: "text",
    prompt: "Anything else?",
    answeredCount: 3,
    aggregation: { n: 3, lowN: true, answered: 3, sample: ["More trees please"] },
  },
];

describe("EngagementSurveyResults", () => {
  it("renders per-question aggregates with an honest screening label", () => {
    render(<EngagementSurveyResults approvedResponseCount={12} questions={questions} />);
    expect(screen.getByText("Top priority?")).toBeTruthy();
    expect(screen.getByText("Bike lane")).toBeTruthy();
    expect(screen.getByText("Anything else?")).toBeTruthy();
    expect(screen.getByText("More trees please")).toBeTruthy();
    // header honesty (screening-grade framing)
    expect(screen.getByText(/Screening-grade tallies of moderated-in survey answers/i)).toBeTruthy();
  });

  it("shows a small-N screening banner on low-response questions only", () => {
    render(<EngagementSurveyResults approvedResponseCount={12} questions={questions} />);
    // q2 (n=3) gets the small-N banner; q1 (n=12) does not.
    expect(screen.getByText(/screening input, not a statistically representative sample \(below 10\)/i)).toBeTruthy();
  });

  it("renders nothing-but-empty when there are no active questions", () => {
    render(<EngagementSurveyResults approvedResponseCount={5} questions={[]} />);
    expect(screen.getByText("No active survey questions.")).toBeTruthy();
  });
});

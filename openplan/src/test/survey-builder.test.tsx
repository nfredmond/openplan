import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { EngagementSurveyBuilder } from "@/components/engagement/survey-builder";

const Q = {
  id: "q1",
  campaign_id: "c1",
  category_id: null,
  question_type: "free_text" as const,
  prompt: "How was your experience?",
  help_text: null,
  required: false,
  is_active: true,
  sort_order: 0,
  config_json: {},
  options: [],
};

describe("EngagementSurveyBuilder", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("renders existing questions with their type badge", () => {
    render(<EngagementSurveyBuilder campaignId="c1" categories={[]} initialQuestions={[Q]} />);
    expect(screen.getByText("How was your experience?")).toBeTruthy();
    // "Free text" also appears in the type <select> options, so assert >=1.
    expect(screen.getAllByText("Free text").length).toBeGreaterThanOrEqual(1);
  });

  it("adds a question via POST and shows it optimistically", async () => {
    const created = { ...Q, id: "q2", prompt: "Pick your top priority", question_type: "single_choice" };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ questionId: "q2", question: created }), { status: 201, headers: { "content-type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<EngagementSurveyBuilder campaignId="c1" categories={[{ id: "cat1", label: "Access" }]} initialQuestions={[]} />);
    fireEvent.change(screen.getByPlaceholderText("What would you like to ask?"), { target: { value: "Pick your top priority" } });
    fireEvent.click(screen.getByRole("button", { name: /add question/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, opts] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe("/api/engagement/campaigns/c1/survey/questions");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.prompt).toBe("Pick your top priority");
    expect(body.questionType).toBe("single_choice");
    await waitFor(() => expect(screen.getByText("Pick your top priority")).toBeTruthy());
  });

  it("surfaces the API error and does not add the question on failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid question configuration" }), { status: 400, headers: { "content-type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<EngagementSurveyBuilder campaignId="c1" categories={[]} initialQuestions={[]} />);
    fireEvent.change(screen.getByPlaceholderText("What would you like to ask?"), { target: { value: "Broken" } });
    fireEvent.click(screen.getByRole("button", { name: /add question/i }));
    await waitFor(() => expect(screen.getByText("Invalid question configuration")).toBeTruthy());
    // no question row was added — the empty-state message persists.
    expect(screen.getByText("No questions yet. Add your first below.")).toBeTruthy();
  });
});

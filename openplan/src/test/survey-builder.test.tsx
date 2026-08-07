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

describe("a draft is visibly not public, and a person is the one who publishes it", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const DRAFT = { ...Q, id: "q-draft", prompt: "Drafted by the Planner Agent", status: "draft" as const };

  it("badges a draft and says so in the header count", () => {
    // The badge is the whole review surface. Approving the agent's action puts
    // wording HERE, and a planner who cannot tell it apart from a live question
    // has been given a draft state that does nothing.
    render(
      <EngagementSurveyBuilder
        campaignId="c1"
        categories={[]}
        initialQuestions={[{ ...Q, status: "published" as const }, DRAFT]}
      />
    );

    expect(screen.getByText(/Draft — not public/i)).toBeTruthy();
    expect(screen.getByText(/1 question on the public survey/i)).toBeTruthy();
    expect(screen.getByText(/1 draft nobody outside this workspace can see/i)).toBeTruthy();
  });

  it("publishes only when a person presses the control, and sends the status itself", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ question: { ...DRAFT, status: "published" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<EngagementSurveyBuilder campaignId="c1" categories={[]} initialQuestions={[DRAFT]} />);

    // Nothing has been sent by rendering it — publishing is an act, not a state.
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Drafted by the Planner Agent"));
    fireEvent.click(await screen.findByRole("button", { name: /publish to the public survey/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/survey/questions/q-draft");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ status: "published" });
  });

  it("offers a draft as nothing for another question to depend on", async () => {
    // A published question gated on a draft would appear unconditionally to
    // every respondent, because the portal never serves the question it waits on.
    render(
      <EngagementSurveyBuilder
        campaignId="c1"
        categories={[]}
        initialQuestions={[DRAFT, { ...Q, id: "q-live", prompt: "Live question", status: "published" as const }]}
      />
    );

    fireEvent.click(screen.getByText("Live question"));

    expect(screen.queryByText("Drafted by the Planner Agent", { selector: "option" })).toBeNull();
  });
});

describe("saying when a question applies", () => {
  /**
   * A CONDITION THE BUILDER OFFERS MUST BE ONE THE BUILDER CAN ACTUALLY SAVE.
   *
   * `SURVEY_CONDITION_OPERATORS_BY_TYPE` offers "is" / "is not" against a Likert
   * or rating question, and the evaluator compares those to a NUMBER on the
   * scale. Choosing the comparison field from the operator alone offered an
   * option picker instead — and Likert and rating questions carry no options, so
   * the operator met an empty dropdown, could enter nothing, and the save came
   * back "Invalid question configuration" with no way to get past it. A
   * capability visible in a menu and reachable by nobody is this repo's most
   * repeated defect; this is the participant-visible half of it, one level up.
   */
  const SCALE = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    campaign_id: "c1",
    category_id: null,
    question_type: "likert" as const,
    prompt: "How safe do you feel walking here?",
    help_text: null,
    required: false,
    is_active: true,
    sort_order: 0,
    config_json: { scale: 5 },
    options: [],
  };
  const FOLLOW_UP = { ...Q, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", prompt: "What would make it feel safer?", sort_order: 1 };

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("asks for a number, not an option, when the earlier question is a scale", async () => {
    render(<EngagementSurveyBuilder campaignId="c1" categories={[]} initialQuestions={[SCALE, FOLLOW_UP]} />);
    fireEvent.click(screen.getByRole("button", { name: /What would make it feel safer\?/ }));

    // Point the follow-up at the scale question, then compare with "is".
    fireEvent.change(screen.getByLabelText("Show this question only when"), { target: { value: SCALE.id } });
    fireEvent.change(await screen.findByLabelText("…that answer"), { target: { value: "equals" } });

    // A number field, because a Likert answer IS a number. Not an option list a
    // scale question could never populate.
    const valueField = await screen.findByLabelText("…this value");
    expect((valueField as HTMLInputElement).type).toBe("number");
    expect(screen.queryByLabelText("…this option")).toBeNull();

    fireEvent.change(valueField, { target: { value: "2" } });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ question: { ...FOLLOW_UP, config_json: {} } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, opts] = fetchMock.mock.calls[0] as [string, { body: string }];
    // The condition that actually leaves the browser is the one the evaluator
    // can decide: a number against a scale.
    expect(JSON.parse(opts.body).config.visible_when).toEqual({
      question_id: SCALE.id,
      operator: "equals",
      value: 2,
    });
  });

  it("still asks for an option when the earlier question is a choice", async () => {
    const CHOICE = {
      ...SCALE,
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      question_type: "single_choice" as const,
      prompt: "How do you usually travel here?",
      config_json: {},
      options: [{ id: "opt-bus", question_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", label: "Bus", value: null, is_active: true, sort_order: 0, metadata_json: {} }],
    };
    render(<EngagementSurveyBuilder campaignId="c1" categories={[]} initialQuestions={[CHOICE, FOLLOW_UP]} />);
    fireEvent.click(screen.getByRole("button", { name: /What would make it feel safer\?/ }));

    fireEvent.change(screen.getByLabelText("Show this question only when"), { target: { value: CHOICE.id } });
    fireEvent.change(await screen.findByLabelText("…that answer"), { target: { value: "equals" } });

    const optionField = await screen.findByLabelText("…this option");
    expect(Array.from((optionField as HTMLSelectElement).options).map((option) => option.textContent)).toContain("Bus");
    expect(screen.queryByLabelText("…this value")).toBeNull();
  });
});

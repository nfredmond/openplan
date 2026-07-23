import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicSurveyForm, type PortalSurveyQuestion } from "@/components/engagement/public-survey-form";

const QUESTIONS: PortalSurveyQuestion[] = [
  {
    id: "q-single",
    questionType: "single_choice",
    prompt: "Top priority?",
    helpText: "Pick one.",
    required: true,
    config: { allow_other: true },
    options: [
      { id: "opt-bike", label: "Bike lane", value: null },
      { id: "opt-bus", label: "Bus stop", value: null },
    ],
  },
  {
    id: "q-multi",
    questionType: "multiple_choice",
    prompt: "Which modes do you use?",
    helpText: null,
    required: false,
    config: { min_select: 1, max_select: 2 },
    options: [
      { id: "mode-walk", label: "Walk", value: null },
      { id: "mode-bike", label: "Bike", value: null },
    ],
  },
  {
    id: "q-likert",
    questionType: "likert",
    prompt: "How satisfied are you?",
    helpText: null,
    required: false,
    config: { scale: 5 },
    options: [],
  },
  {
    id: "q-rating",
    questionType: "rating",
    prompt: "Rate the design",
    helpText: null,
    required: false,
    config: { max: 5 },
    options: [],
  },
  {
    id: "q-rank",
    questionType: "ranking",
    prompt: "Rank these",
    helpText: null,
    required: false,
    config: {},
    options: [
      { id: "rank-a", label: "Trees", value: null },
      { id: "rank-b", label: "Benches", value: null },
    ],
  },
  {
    id: "q-budget",
    questionType: "budget_allocation",
    prompt: "Spend the budget",
    helpText: null,
    required: false,
    config: { total: 100, unit: "usd" },
    options: [
      { id: "bud-a", label: "Paving", value: null },
      { id: "bud-b", label: "Lighting", value: null },
    ],
  },
  {
    id: "q-map",
    questionType: "map_point",
    prompt: "Where is the problem?",
    helpText: null,
    required: false,
    config: { geometry_types: ["Point"] },
    options: [],
  },
  {
    id: "q-text",
    questionType: "free_text",
    prompt: "Anything else?",
    helpText: null,
    required: false,
    config: { max_length: 500, multiline: true },
    options: [],
  },
  {
    id: "q-file",
    questionType: "file_upload",
    prompt: "Attach a photo",
    helpText: null,
    required: false,
    config: { max_files: 1, max_size_bytes: 5_242_880, accept: ["image/jpeg", "image/png", "image/webp"] },
    options: [],
  },
];

function mockOkResponse() {
  return {
    ok: true,
    json: async () => ({ success: true, message: "Thanks", sessionId: "s1", reviewStatus: "pending" }),
  } as unknown as Response;
}

describe("PublicSurveyForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a widget for every question type", () => {
    render(<PublicSurveyForm shareToken="token12345678" questions={QUESTIONS} />);
    expect(screen.getByText("Top priority?")).toBeTruthy();
    expect(screen.getByText("Which modes do you use?")).toBeTruthy();
    expect(screen.getByText("How satisfied are you?")).toBeTruthy();
    expect(screen.getByText("Rate the design")).toBeTruthy();
    expect(screen.getByText("Rank these")).toBeTruthy();
    expect(screen.getByText("Spend the budget")).toBeTruthy();
    expect(screen.getByText("Where is the problem?")).toBeTruthy();
    expect(screen.getByText("Anything else?")).toBeTruthy();
    expect(screen.getByText("Attach a photo")).toBeTruthy();
    // required marker on the single_choice question
    expect(screen.getByText("Pick one.")).toBeTruthy();
  });

  it("blocks submission when nothing is answered and never calls the network", () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(<PublicSurveyForm shareToken="token12345678" questions={QUESTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: /submit survey/i }));
    expect(screen.getByText("Please answer at least one question.")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the canonical per-type answer shapes to the confined survey submit path", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(mockOkResponse());
    render(<PublicSurveyForm shareToken="token12345678" questions={QUESTIONS} />);

    fireEvent.click(screen.getByLabelText("Bike lane")); // single_choice → {option_id:"opt-bike"}
    fireEvent.click(screen.getByLabelText("Walk")); // multiple_choice → {option_ids:["mode-walk"]}
    fireEvent.click(screen.getByRole("button", { name: "4" })); // likert value 4
    fireEvent.change(screen.getByPlaceholderText("Type your response"), { target: { value: "More trees" } });

    fireEvent.click(screen.getByRole("button", { name: /submit survey/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/engage/token12345678/survey/submit");
    const body = JSON.parse((init as RequestInit).body as string) as {
      answers: { questionId: string; answer: unknown }[];
      website: string;
    };
    expect(body.website).toBe(""); // honeypot travels empty
    const byId = Object.fromEntries(body.answers.map((a) => [a.questionId, a.answer]));
    expect(byId["q-single"]).toEqual({ option_id: "opt-bike" });
    expect(byId["q-multi"]).toEqual({ option_ids: ["mode-walk"] });
    expect(byId["q-likert"]).toEqual({ value: 4 });
    expect(byId["q-text"]).toEqual({ text: "More trees" });
    // untouched questions are omitted entirely (server decides required-emptiness)
    expect(byId["q-rating"]).toBeUndefined();
    expect(byId["q-map"]).toBeUndefined();

    await screen.findByText("Your survey response has been received");
  });

  it("drops the selected option_id and stores only free text when 'Other' is chosen", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(mockOkResponse());
    render(<PublicSurveyForm shareToken="token12345678" questions={[QUESTIONS[0]]} />);

    fireEvent.click(screen.getByLabelText("Other"));
    fireEvent.change(screen.getByPlaceholderText("Please specify"), { target: { value: "Traffic calming" } });
    fireEvent.click(screen.getByRole("button", { name: /submit survey/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as {
      answers: { questionId: string; answer: { option_id: string; other_text: string } }[];
    };
    expect(body.answers[0].answer.other_text).toBe("Traffic calming");
    expect(body.answers[0].answer.option_id).toBe("__other__"); // sentinel — dropped server-side
  });

  it("surfaces a server validation error against the offending question", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      json: async () => ({ error: "This question is required.", code: "REQUIRED_EMPTY", questionId: "q-single" }),
    } as unknown as Response);
    render(<PublicSurveyForm shareToken="token12345678" questions={QUESTIONS} />);

    fireEvent.change(screen.getByPlaceholderText("Type your response"), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: /submit survey/i }));

    // The error text appears both as the field error and the top banner.
    await waitFor(() => expect(screen.getAllByText("This question is required.").length).toBeGreaterThan(0));
  });

  it("never offers a ranking position two options can share (ties would be a false strict order)", () => {
    const rankQuestion: PortalSurveyQuestion = {
      id: "q-rank",
      questionType: "ranking",
      prompt: "Rank these",
      helpText: null,
      required: false,
      config: {},
      options: [
        { id: "rank-a", label: "Trees", value: null },
        { id: "rank-b", label: "Benches", value: null },
      ],
    };
    render(<PublicSurveyForm shareToken="token12345678" questions={[rankQuestion]} />);
    const selects = screen.getAllByRole("combobox");
    // Assign rank 1 to the first option.
    fireEvent.change(selects[0], { target: { value: "1" } });
    // The second option's select must no longer offer rank 1.
    const secondOptions = Array.from((selects[1] as HTMLSelectElement).options).map((option) => option.value);
    expect(secondOptions).not.toContain("1");
    expect(secondOptions).toContain("2");
  });

  it("never offers a half-star rating below 1 (the server rejects value < 1)", () => {
    const ratingQuestion: PortalSurveyQuestion = {
      id: "q-half",
      questionType: "rating",
      prompt: "Rate it (half steps)",
      helpText: null,
      required: false,
      config: { max: 5, allow_half: true },
      options: [],
    };
    render(<PublicSurveyForm shareToken="token12345678" questions={[ratingQuestion]} />);
    const values = Array.from((screen.getByRole("combobox") as HTMLSelectElement).options)
      .map((option) => option.value)
      .filter((value) => value !== "");
    expect(values).not.toContain("0.5");
    expect(values).toContain("1");
    expect(values).toContain("1.5");
    expect(values.every((value) => Number(value) >= 1)).toBe(true);
  });

  it("keeps a honeypot field bots can fill but users cannot see", () => {
    render(<PublicSurveyForm shareToken="token12345678" questions={QUESTIONS} />);
    const honeypot = screen.getByLabelText("Website") as HTMLInputElement;
    expect(honeypot.tabIndex).toBe(-1);
  });
});

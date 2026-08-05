import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "SURVEY QUESTION NOT FOUND" AND "THIS QUESTION HAS NO OPTIONS" ARE BOTH FACTS
 * ABOUT AN AGENCY'S SURVEY, so only a read that succeeded may state either.
 *
 * Three reads in the survey-authoring lane used to state them from a read that
 * failed. Two loaded the question a write is about — `const { data: question } =
 * await …` binds no error, so a permission failure and an unapplied migration
 * both arrived as `null` and were answered "there is no such question in this
 * campaign", to an operator looking at the question. The third served
 * `{ options: [] }` to the survey builder, which is the same payload a question
 * that genuinely offers nothing to choose from produces — the state an operator
 * fixes by adding options, and the state a respondent would be shown.
 *
 * The fake client returns its fixture whatever the code asks for. That is
 * precisely why these paths went untested: they only exist when a NAMED read is
 * made to fail.
 */

const createClientMock = vi.fn();
const loadCampaignAccessMock = vi.fn();

const questionReadMaybeSingle = vi.fn();
const questionUpdateSingle = vi.fn();
const questionUpdateMock = vi.fn(() => ({
  eq: () => ({ eq: () => ({ select: () => ({ single: questionUpdateSingle }) }) }),
}));
const optionsListResolve = vi.fn();
const optionInsertSingle = vi.fn();
const optionInsertMock = vi.fn(() => ({ select: () => ({ single: optionInsertSingle }) }));

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const fromMock = vi.fn((table: string) => {
  if (table === "engagement_survey_questions") {
    return {
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: questionReadMaybeSingle }) }) }),
      update: questionUpdateMock,
    };
  }
  if (table === "engagement_survey_question_options") {
    return {
      select: () => ({ eq: () => ({ eq: () => ({ order: optionsListResolve }) }) }),
      insert: optionInsertMock,
    };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));
vi.mock("@/lib/engagement/api", () => ({
  loadCampaignAccess: (...args: unknown[]) => loadCampaignAccessMock(...args),
  validateCampaignCategoryAccess: async () => ({ category: { id: "cat-1" }, error: null }),
}));

import { PATCH as updateQuestion } from "@/app/api/engagement/campaigns/[campaignId]/survey/questions/[questionId]/route";
import {
  GET as listOptions,
  POST as createOption,
} from "@/app/api/engagement/campaigns/[campaignId]/survey/questions/[questionId]/options/route";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const QUESTION_ID = "22222222-2222-4222-8222-222222222222";
const OPTION_ID = "33333333-3333-4333-8333-333333333333";

const ctx = { params: Promise.resolve({ campaignId: CAMPAIGN_ID, questionId: QUESTION_ID }) };

function jsonRequest(body: unknown, method: string) {
  return new NextRequest(
    `http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/survey/questions/${QUESTION_ID}`,
    { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
  );
}

/**
 * Both handlers infer `Response | undefined`, because the helper each one calls
 * returns a union TypeScript narrows loosely — a pre-existing shape, asserted
 * here rather than papered over with `!` so a handler that really did fall
 * through would fail loudly instead of throwing on `.status`.
 */
function responseOf(value: Response | undefined): Response {
  if (!value) throw new Error("the route handler returned no response");
  return value;
}

function plainRequest() {
  return new NextRequest(
    `http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/survey/questions/${QUESTION_ID}/options`
  );
}

beforeEach(() => {
  vi.clearAllMocks();

  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "44444444-4444-4444-8444-444444444444" } } }) },
    from: fromMock,
  });

  loadCampaignAccessMock.mockResolvedValue({
    campaign: { id: CAMPAIGN_ID, workspace_id: "ws-1" },
    membership: { role: "editor" },
    error: null,
    allowed: true,
  });

  questionReadMaybeSingle.mockResolvedValue({
    data: { id: QUESTION_ID, question_type: "single_choice", prompt: "How do you travel?", sort_order: 0, config_json: {} },
    error: null,
  });
  questionUpdateSingle.mockResolvedValue({
    data: { id: QUESTION_ID, prompt: "How do you usually travel?" },
    error: null,
  });
  optionsListResolve.mockResolvedValue({
    data: [{ id: OPTION_ID, question_id: QUESTION_ID, label: "Bus" }],
    error: null,
  });
  optionInsertSingle.mockResolvedValue({ data: { id: OPTION_ID, label: "Bus" }, error: null });
});

describe("PATCH /api/engagement/campaigns/[campaignId]/survey/questions/[questionId]", () => {
  it("updates the question when the pre-read found it", async () => {
    const response = responseOf(await updateQuestion(jsonRequest({ prompt: "How do you usually travel?" }, "PATCH"), ctx));

    expect(response.status).toBe(200);
    expect(questionUpdateMock).toHaveBeenCalled();
  });

  it("still 404s when the read SUCCEEDED and this campaign has no such question", async () => {
    questionReadMaybeSingle.mockResolvedValue({ data: null, error: null });

    const response = responseOf(await updateQuestion(jsonRequest({ prompt: "New prompt" }, "PATCH"), ctx));

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Survey question not found");
  });

  it("reports a failed read instead of saying the question is not in this campaign", async () => {
    questionReadMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table engagement_survey_questions", code: "42501" },
    });

    const response = responseOf(await updateQuestion(jsonRequest({ prompt: "New prompt" }, "PATCH"), ctx));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load survey question");
    expect(body.hint).toContain("read failure");
    expect(JSON.stringify(body)).not.toContain("not found");
    // Nothing is written on the strength of a question nobody could read.
    expect(questionUpdateMock).not.toHaveBeenCalled();
    expect(mockAudit.error).toHaveBeenCalledWith(
      "question_read_failed",
      expect.objectContaining({ questionId: QUESTION_ID })
    );
  });

  it("answers 503 when the survey tables have not been migrated on this deployment", async () => {
    questionReadMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'relation "engagement_survey_questions" does not exist' },
    });

    const response = responseOf(await updateQuestion(jsonRequest({ prompt: "New prompt" }, "PATCH"), ctx));

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("Survey question schema is not available yet");
  });
});

describe("GET .../survey/questions/[questionId]/options", () => {
  it("returns the options the question offers", async () => {
    const response = await listOptions(plainRequest(), ctx);

    expect(response.status).toBe(200);
    expect((await response.json()).options).toHaveLength(1);
  });

  it("still answers an empty list when the question genuinely offers nothing", async () => {
    optionsListResolve.mockResolvedValue({ data: [], error: null });

    const response = await listOptions(plainRequest(), ctx);

    expect(response.status).toBe(200);
    expect((await response.json()).options).toEqual([]);
  });

  it("refuses rather than serving an empty option list it could not read", async () => {
    optionsListResolve.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table engagement_survey_question_options", code: "42501" },
    });

    const response = await listOptions(plainRequest(), ctx);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load survey options");
    expect(body.hint).toContain("read failure");
    // The builder must not receive something it would render as "no options".
    expect(body.options).toBeUndefined();
    expect(mockAudit.error).toHaveBeenCalledWith(
      "options_list_failed",
      expect.objectContaining({ questionId: QUESTION_ID })
    );
  });

  it("answers 503 when the options table has not been migrated on this deployment", async () => {
    optionsListResolve.mockResolvedValue({
      data: null,
      error: { message: "could not find the table 'public.engagement_survey_question_options' in the schema cache" },
    });

    const response = await listOptions(plainRequest(), ctx);

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("Survey options schema is not available yet");
  });
});

describe("POST .../survey/questions/[questionId]/options", () => {
  it("creates the option when the question read found it", async () => {
    const response = responseOf(await createOption(jsonRequest({ label: "Bus" }, "POST"), ctx));

    expect(response.status).toBe(201);
    expect(optionInsertMock).toHaveBeenCalled();
  });

  it("still 404s when the read SUCCEEDED and there is no such question", async () => {
    questionReadMaybeSingle.mockResolvedValue({ data: null, error: null });

    const response = responseOf(await createOption(jsonRequest({ label: "Bus" }, "POST"), ctx));

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Survey question not found");
  });

  it("reports a failed read instead of saying the question is not in this campaign", async () => {
    questionReadMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table engagement_survey_questions", code: "42501" },
    });

    const response = responseOf(await createOption(jsonRequest({ label: "Bus" }, "POST"), ctx));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load survey question");
    expect(JSON.stringify(body)).not.toContain("not found");
    expect(optionInsertMock).not.toHaveBeenCalled();
    expect(mockAudit.error).toHaveBeenCalledWith(
      "option_question_read_failed",
      expect.objectContaining({ questionId: QUESTION_ID })
    );
  });
});

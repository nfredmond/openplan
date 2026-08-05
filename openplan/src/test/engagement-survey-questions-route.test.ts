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
const validateCampaignCategoryAccessMock = vi.fn();

const questionReadMaybeSingle = vi.fn();
const questionUpdateSingle = vi.fn();
const questionUpdateMock = vi.fn(() => ({
  eq: () => ({ eq: () => ({ select: () => ({ single: questionUpdateSingle }) }) }),
}));
const questionDeleteResolve = vi.fn();
const questionDeleteMock = vi.fn(() => ({ eq: () => ({ eq: questionDeleteResolve }) }));
const optionsListResolve = vi.fn();
const optionInsertSingle = vi.fn();
const optionInsertMock = vi.fn(() => ({ select: () => ({ single: optionInsertSingle }) }));

/**
 * The condition-graph read, which is a DIFFERENT chain on the same table.
 *
 * `readSurveyConditionRefs` runs unmocked here on purpose — it is the seam under
 * test — and it terminates on `.order().order()`, while the question pre-read
 * terminates on `.maybeSingle()`. Giving each terminal its own vi.fn is what
 * makes "the survey definition failed" a state this harness can actually reach;
 * a client that hands back one fixture for every chain leaves the failure branch
 * unreachable and every assertion below meaningless.
 */
const conditionQuestionsResolve = vi.fn();

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const fromMock = vi.fn((table: string) => {
  if (table === "engagement_survey_questions") {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: questionReadMaybeSingle,
            order: () => ({ order: conditionQuestionsResolve }),
          }),
        }),
      }),
      update: questionUpdateMock,
      delete: questionDeleteMock,
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
  validateCampaignCategoryAccess: (...args: unknown[]) => validateCampaignCategoryAccessMock(...args),
}));

import {
  DELETE as deleteQuestion,
  PATCH as updateQuestion,
} from "@/app/api/engagement/campaigns/[campaignId]/survey/questions/[questionId]/route";
import {
  GET as listOptions,
  POST as createOption,
} from "@/app/api/engagement/campaigns/[campaignId]/survey/questions/[questionId]/options/route";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const QUESTION_ID = "22222222-2222-4222-8222-222222222222";
const OPTION_ID = "33333333-3333-4333-8333-333333333333";
const CATEGORY_ID = "55555555-5555-4555-8555-555555555555";
const DEPENDENT_ID = "66666666-6666-4666-8666-666666666666";

/** A second question, gated on QUESTION_ID — what archiving/deleting must refuse. */
const DEPENDENT_QUESTION = {
  id: DEPENDENT_ID,
  question_type: "free_text",
  prompt: "Tell us more about the bus",
  help_text: null,
  required: false,
  sort_order: 1,
  config_json: { visible_when: { question_id: QUESTION_ID, operator: "answered" } },
  category_id: null,
};
const SUBJECT_QUESTION = {
  id: QUESTION_ID,
  question_type: "single_choice",
  prompt: "How do you travel?",
  help_text: null,
  required: false,
  sort_order: 0,
  config_json: {},
  category_id: null,
};

const ctx = { params: Promise.resolve({ campaignId: CAMPAIGN_ID, questionId: QUESTION_ID }) };

function jsonRequest(body: unknown, method: string) {
  return new NextRequest(
    `http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/survey/questions/${QUESTION_ID}`,
    { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
  );
}

/**
 * The question handlers infer `Response | undefined`, because the helper each
 * one calls returns a union TypeScript narrows loosely — a pre-existing shape,
 * asserted
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
  // The survey the condition graph is decided from: this question, and nothing
  // gated on it, so the default is an archive/delete that is genuinely safe.
  conditionQuestionsResolve.mockResolvedValue({ data: [SUBJECT_QUESTION], error: null });
  questionDeleteResolve.mockResolvedValue({ error: null });
  validateCampaignCategoryAccessMock.mockResolvedValue({ category: { id: CATEGORY_ID }, error: null });
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

/**
 * A CATEGORY LOOKUP THAT NEVER ANSWERED MAY NOT SAY THE CATEGORY IS FOREIGN.
 *
 * `if (categoryAccess.error || !categoryAccess.category)` collapsed the two, so
 * a permission failure or an unapplied migration came back as 400 "Category does
 * not belong to this campaign" — a statement about the agency's own data, made
 * out of a query with no answer, to an operator looking at the category in the
 * dropdown they picked it from.
 */
describe("PATCH .../questions/[questionId] — tagging a question with a category", () => {
  it("still refuses a category the read looked for and did not find", async () => {
    validateCampaignCategoryAccessMock.mockResolvedValue({ category: null, error: null });

    const response = responseOf(await updateQuestion(jsonRequest({ categoryId: CATEGORY_ID }, "PATCH"), ctx));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Category does not belong to this campaign");
    expect(questionUpdateMock).not.toHaveBeenCalled();
  });

  it("reports a failed category read instead of calling the category foreign", async () => {
    validateCampaignCategoryAccessMock.mockResolvedValue({
      category: null,
      error: { message: "permission denied for table engagement_categories", code: "42501" },
    });

    const response = responseOf(await updateQuestion(jsonRequest({ categoryId: CATEGORY_ID }, "PATCH"), ctx));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load the selected category");
    expect(body.hint).toContain("read failure");
    // The false claim is GONE, not merely accompanied by a truer one.
    expect(JSON.stringify(body)).not.toContain("does not belong");
    expect(questionUpdateMock).not.toHaveBeenCalled();
    expect(mockAudit.error).toHaveBeenCalledWith(
      "question_category_read_failed",
      expect.objectContaining({ categoryId: CATEGORY_ID })
    );
  });
});

/**
 * THE PERMISSIVE-WRITE HALF OF THIS DEFECT CLASS, and the reason it is worse
 * here than a wrong sentence.
 *
 * Archiving and deleting are both gated on "does anything depend on this
 * question", and that is decided from a read of the campaign's active survey.
 * When the read failed, the refs arrived EMPTY — indistinguishable from a survey
 * where nothing depends on it — so the gate opened and the edit went through.
 * Every question that was conditional on this one then starts appearing to every
 * respondent, and the operator is told nothing.
 */
describe("PATCH .../questions/[questionId] — archiving a question others are gated on", () => {
  const archiveRequest = () => jsonRequest({ isActive: false }, "PATCH");

  it("archives when the survey read answered and nothing depends on the question", async () => {
    const response = responseOf(await updateQuestion(archiveRequest(), ctx));

    expect(response.status).toBe(200);
    expect(questionUpdateMock).toHaveBeenCalled();
  });

  it("still refuses with 409 when the read found a real dependent", async () => {
    conditionQuestionsResolve.mockResolvedValue({ data: [SUBJECT_QUESTION, DEPENDENT_QUESTION], error: null });

    const response = responseOf(await updateQuestion(archiveRequest(), ctx));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("CONDITION_DEPENDENTS");
    expect(questionUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses the archive rather than reading an unreadable survey as one with no dependents", async () => {
    conditionQuestionsResolve.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table engagement_survey_questions", code: "42501" },
    });

    const response = responseOf(await updateQuestion(archiveRequest(), ctx));
    const body = await response.json();

    // The consequence the fix exists for, asserted FIRST: nothing is archived on
    // the strength of a dependency check that never ran.
    expect(questionUpdateMock).not.toHaveBeenCalled();
    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load this campaign's survey");
    expect(body.hint).toContain("read failure");
    expect(mockAudit.error).toHaveBeenCalledWith(
      "question_condition_graph_read_failed",
      expect.objectContaining({ questionId: QUESTION_ID })
    );
  });

  it("answers 503 when the survey definition tables are not migrated on this deployment", async () => {
    conditionQuestionsResolve.mockResolvedValue({
      data: null,
      error: { message: 'relation "engagement_survey_questions" does not exist' },
    });

    const response = responseOf(await updateQuestion(archiveRequest(), ctx));

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("This campaign's survey schema is not available yet");
    expect(questionUpdateMock).not.toHaveBeenCalled();
  });
});

describe("DELETE .../questions/[questionId] — the same gate, over an irreversible write", () => {
  const deleteRequest = () =>
    new NextRequest(
      `http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/survey/questions/${QUESTION_ID}`,
      { method: "DELETE" }
    );

  it("deletes when the survey read answered and nothing depends on the question", async () => {
    const response = responseOf(await deleteQuestion(deleteRequest(), ctx));

    expect(response.status).toBe(200);
    expect(questionDeleteMock).toHaveBeenCalled();
  });

  it("still refuses with 409 when the read found a real dependent", async () => {
    conditionQuestionsResolve.mockResolvedValue({ data: [SUBJECT_QUESTION, DEPENDENT_QUESTION], error: null });

    const response = responseOf(await deleteQuestion(deleteRequest(), ctx));

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("CONDITION_DEPENDENTS");
    expect(questionDeleteMock).not.toHaveBeenCalled();
  });

  it("refuses the delete rather than reading an unreadable survey as one with no dependents", async () => {
    conditionQuestionsResolve.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table engagement_survey_questions", code: "42501" },
    });

    const response = responseOf(await deleteQuestion(deleteRequest(), ctx));
    const body = await response.json();

    // The row is gone forever if this gate opens, so this is the assertion that
    // matters: no delete was issued.
    expect(questionDeleteMock).not.toHaveBeenCalled();
    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load this campaign's survey");
    expect(body.ok).toBeUndefined();
    expect(mockAudit.error).toHaveBeenCalledWith(
      "question_condition_graph_read_failed",
      expect.objectContaining({ questionId: QUESTION_ID })
    );
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

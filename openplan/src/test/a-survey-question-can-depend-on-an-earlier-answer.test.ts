import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveSurveyVisibility,
  validateSurveyConditionGraph,
  validateSurveyConfig,
  type SurveyConditionQuestionRef,
} from "@/lib/engagement/survey";

/**
 * A QUESTION THAT CANNOT APPLY TO SOMEBODY SHOULD NOT BE ASKED OF THEM.
 *
 * The three things this file holds:
 *
 *  1. ONE RULE, EVALUATED TWICE. The browser decides what to render and the
 *     server decides what to store, from the same function. Two implementations
 *     is how a form comes to hide a question the server still requires (nobody
 *     can submit) or accept an answer to a question that did not apply (a
 *     tallied answer to a question that person was never asked).
 *  2. AN UNANSWERABLE SURVEY IS REFUSED AT AUTHORING TIME, in words that name
 *     the questions involved. A forward reference looks fine in the builder and
 *     produces a question the public never sees.
 *  3. A CONTROLLING QUESTION CANNOT BE REMOVED OUT FROM UNDER ITS DEPENDENTS.
 */

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OPT_BUS = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
const OPT_CAR = "d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2";

describe("evaluating a condition", () => {
  const survey = [
    { id: A, question_type: "single_choice" as const, config: {} },
    { id: B, question_type: "free_text" as const, config: { visible_when: { question_id: A, operator: "equals", value: OPT_BUS } } },
    { id: C, question_type: "free_text" as const, config: { visible_when: { question_id: B, operator: "answered" } } },
  ];

  it("hides a question until the answer it depends on matches", () => {
    expect(resolveSurveyVisibility(survey, {}).visible.has(B)).toBe(false);
    expect(resolveSurveyVisibility(survey, { [A]: { option_id: OPT_CAR } }).visible.has(B)).toBe(false);
    expect(resolveSurveyVisibility(survey, { [A]: { option_id: OPT_BUS } }).visible.has(B)).toBe(true);
  });

  it("hides what depends on a hidden question, rather than treating it as unanswered", () => {
    // C asks "answered?" of B. If B was never SHOWN, C must not appear either —
    // otherwise the survey asks a follow-up to a question this person was never
    // asked, and calls their silence a skip.
    const resolved = resolveSurveyVisibility(survey, { [A]: { option_id: OPT_CAR } });
    expect(resolved.visible.has(B)).toBe(false);
    expect(resolved.visible.has(C)).toBe(false);
  });

  it("drops the answers to questions that stopped applying, in a chain", () => {
    const answered = { [A]: { option_id: OPT_BUS }, [B]: { text: "the 14 is late" }, [C]: { text: "every day" } };
    expect(Object.keys(resolveSurveyVisibility(survey, answered).answers).sort()).toEqual([A, B, C].sort());

    // The respondent goes back and changes A. B no longer applies, so its answer
    // goes — and with it C, which depended on B having one.
    const changed = resolveSurveyVisibility(survey, { ...answered, [A]: { option_id: OPT_CAR } });
    expect(Object.keys(changed.answers)).toEqual([A]);
    expect(changed.discarded.sort()).toEqual([B, C].sort());
  });

  it("does not treat an untouched question as having a different answer", () => {
    // `not_equals` on a blank answer would otherwise show every follow-up the
    // moment the form loaded, which is the opposite of what the operator wrote.
    const notEquals = [
      { id: A, question_type: "single_choice" as const, config: {} },
      { id: B, question_type: "free_text" as const, config: { visible_when: { question_id: A, operator: "not_equals", value: OPT_BUS } } },
    ];
    expect(resolveSurveyVisibility(notEquals, {}).visible.has(B)).toBe(false);
    expect(resolveSurveyVisibility(notEquals, { [A]: { option_id: OPT_CAR } }).visible.has(B)).toBe(true);
  });

  it("shows a question whose condition is unreadable rather than withholding it", () => {
    // A corrupt condition must never silently withhold a question — if that
    // question were required, the participant could not finish the form and
    // would never be told why.
    const broken = [
      { id: A, question_type: "single_choice" as const, config: {} },
      { id: B, question_type: "free_text" as const, config: { visible_when: { nonsense: true } } },
    ];
    expect(resolveSurveyVisibility(broken, {}).visible.has(B)).toBe(true);
  });

  it("compares a scale answer numerically", () => {
    const scale = [
      { id: A, question_type: "likert" as const, config: { scale: 5 } },
      { id: B, question_type: "free_text" as const, config: { visible_when: { question_id: A, operator: "lte", value: 2 } } },
    ];
    expect(resolveSurveyVisibility(scale, { [A]: { value: 4 } }).visible.has(B)).toBe(false);
    expect(resolveSurveyVisibility(scale, { [A]: { value: 2 } }).visible.has(B)).toBe(true);
  });
});

describe("refusing a survey nobody could answer", () => {
  function ref(overrides: Partial<SurveyConditionQuestionRef> & { id: string }): SurveyConditionQuestionRef {
    return {
      prompt: `Question ${overrides.id.slice(0, 1)}`,
      question_type: "single_choice",
      config: {},
      optionIds: [OPT_BUS, OPT_CAR],
      ...overrides,
    };
  }

  it("refuses a question that depends on one asked LATER, naming both", () => {
    const problems = validateSurveyConditionGraph([
      ref({ id: A, prompt: "Do you have a follow-up?", config: { visible_when: { question_id: B, operator: "answered" } } }),
      ref({ id: B, prompt: "How do you travel?" }),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0].code).toBe("FORWARD_REFERENCE");
    expect(problems[0].message).toContain("Do you have a follow-up?");
    expect(problems[0].message).toContain("How do you travel?");
  });

  it("refuses a loop", () => {
    const problems = validateSurveyConditionGraph([
      ref({ id: A, config: { visible_when: { question_id: C, operator: "answered" } } }),
      ref({ id: C, config: { visible_when: { question_id: A, operator: "answered" } } }),
    ]);
    expect(problems.some((problem) => problem.code === "CYCLE")).toBe(true);
  });

  it("refuses a question that depends on its own answer", () => {
    const problems = validateSurveyConditionGraph([
      ref({ id: A, config: { visible_when: { question_id: A, operator: "answered" } } }),
    ]);
    expect(problems[0].code).toBe("SELF_REFERENCE");
  });

  it("refuses a comparison the controlling answer could never satisfy", () => {
    const problems = validateSurveyConditionGraph([
      ref({ id: A, prompt: "Anything else?", question_type: "free_text", optionIds: [] }),
      ref({ id: B, config: { visible_when: { question_id: A, operator: "gte", value: 3 } } }),
    ]);
    expect(problems[0].code).toBe("OPERATOR_NOT_SUPPORTED");
    expect(problems[0].message).toContain("Anything else?");
  });

  it("refuses a condition naming an option the question no longer offers", () => {
    const problems = validateSurveyConditionGraph([
      ref({ id: A, optionIds: [OPT_BUS] }),
      ref({ id: B, config: { visible_when: { question_id: A, operator: "equals", value: OPT_CAR } } }),
    ]);
    expect(problems[0].code).toBe("UNKNOWN_OPTION");
  });

  it("refuses a condition pointing at a question that is not in the survey", () => {
    const problems = validateSurveyConditionGraph([
      ref({ id: B, config: { visible_when: { question_id: A, operator: "answered" } } }),
    ]);
    expect(problems[0].code).toBe("UNKNOWN_QUESTION");
  });

  it("accepts an ordinary backward reference", () => {
    expect(
      validateSurveyConditionGraph([
        ref({ id: A }),
        ref({ id: B, config: { visible_when: { question_id: A, operator: "equals", value: OPT_BUS } } }),
      ])
    ).toEqual([]);
  });

  it("keeps the condition inside the question's own config, so nothing has to project a new column", () => {
    // Deliberate: `config_json` already reaches every reader of a question.
    const result = validateSurveyConfig("free_text", {
      max_length: 500,
      visible_when: { question_id: A, operator: "answered" },
    });
    expect(result.ok).toBe(true);
    expect((result as { config: Record<string, unknown> }).config.visible_when).toEqual({
      question_id: A,
      operator: "answered",
    });
  });

  it("refuses a condition whose operator and value disagree", () => {
    expect(validateSurveyConfig("free_text", { visible_when: { question_id: A, operator: "answered", value: 3 } }).ok).toBe(false);
    expect(validateSurveyConfig("free_text", { visible_when: { question_id: A, operator: "gte", value: "three" } }).ok).toBe(false);
    expect(validateSurveyConfig("free_text", { visible_when: { question_id: "not-a-uuid", operator: "answered" } }).ok).toBe(false);
  });
});

// ── The operator routes ──────────────────────────────────────────────────────

const createClientMock = vi.fn();
const loadCampaignAccessMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createClientMock(),
  createServiceRoleClient: vi.fn(),
}));
vi.mock("@/lib/engagement/api", () => ({
  loadCampaignAccess: (...args: unknown[]) => loadCampaignAccessMock(...args),
  validateCampaignCategoryAccess: async () => ({ error: null, category: { id: "cat" } }),
}));

const { POST: createQuestion } = await import(
  "@/app/api/engagement/campaigns/[campaignId]/survey/questions/route"
);
const { PATCH: updateQuestion, DELETE: deleteQuestion } = await import(
  "@/app/api/engagement/campaigns/[campaignId]/survey/questions/[questionId]/route"
);

const CAMPAIGN_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

type OpKind = "select" | "insert" | "update" | "delete";

/**
 * Definition-table stand-in for the authoring routes.
 *
 * The single-question read and the whole-survey read hit the same table, so they
 * are told apart by their PROJECTION exactly as the routes write them — the
 * definition load asks for `help_text`, the PATCH pre-read does not.
 *
 * `archived` rows exist only to the single-question read, which is the real
 * asymmetry: `loadSurveyDefinition` filters `is_active = true`, so an archived
 * question is invisible to the whole-survey read and visible to the pre-read by
 * id. Modelling that is the only way to exercise re-activation.
 */
function builderClient(
  questions: Record<string, unknown>[],
  options: Record<string, unknown>[] = [],
  archived: Record<string, unknown>[] = []
) {
  const writes: { table: string; kind: OpKind; payload?: unknown }[] = [];

  const from = (table: string) => {
    const chain = (resolve: () => unknown, kind: OpKind, payload?: unknown) => {
      if (kind !== "select") writes.push({ table, kind, payload });
      const filters: [string, unknown][] = [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: resolveWith(resolve, filters), error: null }),
        single: async () => ({ data: resolveWith(resolve, filters), error: null }),
        then: (onFulfilled: (value: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data: resolveWith(resolve, filters), error: null }).then(onFulfilled),
      };
      return builder;
    };

    const resolveWith = (resolve: () => unknown, filters: [string, unknown][]) => {
      const value = resolve();
      if (typeof value === "function") return (value as (f: [string, unknown][]) => unknown)(filters);
      return value;
    };

    if (table === "engagement_survey_questions") {
      return {
        select: (columns?: string) =>
          typeof columns === "string" && columns.includes("help_text")
            ? chain(() => questions, "select")
            : chain(
                () => (filters: [string, unknown][]) => {
                  const id = filters.find(([column]) => column === "id")?.[1];
                  return [...questions, ...archived].find((question) => question.id === id) ?? null;
                },
                "select"
              ),
        insert: (payload: unknown) => chain(() => ({ ...(payload as object), id: "new" }), "insert", payload),
        update: (payload: unknown) => chain(() => ({ ...(payload as object), id: "updated" }), "update", payload),
        delete: () => chain(() => null, "delete"),
      };
    }
    if (table === "engagement_survey_question_options") return { select: () => chain(() => options, "select") };
    throw new Error(`Unexpected table: ${table}`);
  };

  return {
    supabase: {
      from,
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    } as unknown as SupabaseClient,
    writes,
  };
}

/**
 * The PATCH handler's inferred return type includes `undefined`, because its
 * `authorize` helper returns a union TypeScript narrows loosely — a pre-existing
 * shape this feature did not introduce and does not change. Asserted here rather
 * than papered over with `!`, so a handler that really did fall through would
 * fail loudly instead of throwing on `.status`.
 */
function responseOf(value: Response | undefined): Response {
  if (!value) throw new Error("the route handler returned no response");
  return value;
}

function jsonRequest(payload: unknown, method = "POST") {
  return new NextRequest(`http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/survey/questions`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  createClientMock.mockReset();
  loadCampaignAccessMock.mockReset();
  loadCampaignAccessMock.mockResolvedValue({ error: null, allowed: true, campaign: { id: CAMPAIGN_ID } });
});

describe("authoring a conditional question", () => {
  const existing = [
    { id: A, question_type: "single_choice", prompt: "How do you travel?", help_text: null, required: false, sort_order: 0, config_json: {}, category_id: null },
  ];
  const existingOptions = [{ id: OPT_BUS, question_id: A, label: "Bus", value: null, sort_order: 0, metadata_json: {} }];

  it("accepts a condition on a question the respondent has already reached", async () => {
    const { supabase, writes } = builderClient(existing, existingOptions);
    createClientMock.mockResolvedValue(supabase);

    const response = await createQuestion(
      jsonRequest({
        questionType: "free_text",
        prompt: "Why the bus?",
        sortOrder: 1,
        config: { visible_when: { question_id: A, operator: "equals", value: OPT_BUS } },
      }),
      { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) }
    );

    expect(response.status).toBe(201);
    const insert = writes.find((write) => write.kind === "insert");
    expect((insert?.payload as { config_json: Record<string, unknown> }).config_json.visible_when).toEqual({
      question_id: A,
      operator: "equals",
      value: OPT_BUS,
    });
  });

  it("refuses a condition on a question that comes later, and writes nothing", async () => {
    const { supabase, writes } = builderClient(
      [{ ...existing[0], sort_order: 5 }],
      existingOptions
    );
    createClientMock.mockResolvedValue(supabase);

    const response = await createQuestion(
      jsonRequest({
        questionType: "free_text",
        prompt: "Why the bus?",
        sortOrder: 1,
        config: { visible_when: { question_id: A, operator: "answered" } },
      }),
      { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) }
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe("FORWARD_REFERENCE");
    expect(body.error).toContain("How do you travel?");
    expect(writes.filter((write) => write.kind === "insert")).toEqual([]);
  });

  it("refuses a reorder that would move a question above the one it depends on", async () => {
    // The trap this closes: the condition was valid when it was written, and
    // dragging the question up is what breaks it — long after anyone would think
    // to re-check.
    const questions = [
      { ...existing[0], id: A, sort_order: 5 },
      { id: B, question_type: "free_text", prompt: "Why the bus?", help_text: null, required: false, sort_order: 6, config_json: { visible_when: { question_id: A, operator: "answered" } }, category_id: null },
    ];
    const { supabase, writes } = builderClient(questions, existingOptions);
    createClientMock.mockResolvedValue(supabase);

    // Dragged to the top of the survey, above the question it depends on.
    const response = responseOf(
      await updateQuestion(jsonRequest({ sortOrder: 1 }, "PATCH"), {
        params: Promise.resolve({ campaignId: CAMPAIGN_ID, questionId: B }),
      })
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("FORWARD_REFERENCE");
    expect(writes.filter((write) => write.kind === "update")).toEqual([]);
  });

  it("refuses to archive a question others are gated on, and names them", async () => {
    const questions = [
      { ...existing[0], sort_order: 0 },
      { id: B, question_type: "free_text", prompt: "Why the bus?", help_text: null, required: false, sort_order: 1, config_json: { visible_when: { question_id: A, operator: "answered" } }, category_id: null },
    ];
    const { supabase, writes } = builderClient(questions, existingOptions);
    createClientMock.mockResolvedValue(supabase);

    const response = responseOf(
      await updateQuestion(jsonRequest({ isActive: false }, "PATCH"), {
        params: Promise.resolve({ campaignId: CAMPAIGN_ID, questionId: A }),
      })
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; code: string; dependents: { id: string }[] };
    expect(body.code).toBe("CONDITION_DEPENDENTS");
    expect(body.error).toContain("Why the bus?");
    expect(body.dependents.map((dependent) => dependent.id)).toEqual([B]);
    expect(writes.filter((write) => write.kind === "update")).toEqual([]);
  });

  it("re-checks the condition on a question being brought back out of the archive", async () => {
    /**
     * THE EDIT THAT SLIPS THROUGH IF THE CHECK ONLY LOOKS AT ACTIVE QUESTIONS.
     *
     * `loadSurveyConditionRefs` returns the ACTIVE survey, so a question being
     * un-archived is not in it. Validating the list as it stands therefore
     * validates a survey the question is not in, and its condition is never
     * looked at — while the write puts it straight back in front of the public.
     *
     * The sequence is ordinary: the condition was valid when written, the
     * question was archived, the survey was reordered around it, and bringing
     * it back makes its backward reference a forward one. Nobody would think to
     * re-check by hand, and the failure is silent: the question never appears to
     * a single respondent, and the operator sees it sitting in the builder.
     */
    const active = [{ ...existing[0], id: A, sort_order: 5 }];
    const archived = [
      { id: B, question_type: "free_text", prompt: "Why the bus?", help_text: null, required: false, sort_order: 1, config_json: { visible_when: { question_id: A, operator: "answered" } }, category_id: null },
    ];
    const { supabase, writes } = builderClient(active, existingOptions, archived);
    createClientMock.mockResolvedValue(supabase);

    const response = responseOf(
      await updateQuestion(jsonRequest({ isActive: true }, "PATCH"), {
        params: Promise.resolve({ campaignId: CAMPAIGN_ID, questionId: B }),
      })
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("FORWARD_REFERENCE");
    expect(writes.filter((write) => write.kind === "update")).toEqual([]);
  });

  it("still allows an ordinary edit to a question whose condition is fine", async () => {
    // The guard above must refuse a BROKEN graph, not every edit that touches
    // one. A question tied on `sort_order` with its controller must keep the
    // created_at order the definition load already resolved it in, or an
    // innocent config edit would invent a forward reference nobody wrote.
    const questions = [
      { ...existing[0], sort_order: 0 },
      { id: B, question_type: "free_text", prompt: "Why the bus?", help_text: null, required: false, sort_order: 0, config_json: { visible_when: { question_id: A, operator: "equals", value: OPT_BUS } }, category_id: null },
    ];
    const { supabase, writes } = builderClient(questions, existingOptions);
    createClientMock.mockResolvedValue(supabase);

    const response = responseOf(
      await updateQuestion(jsonRequest({ config: { visible_when: { question_id: A, operator: "equals", value: OPT_BUS }, max_length: 400 } }, "PATCH"), {
        params: Promise.resolve({ campaignId: CAMPAIGN_ID, questionId: B }),
      })
    );

    expect(response.status).toBe(200);
    expect(writes.filter((write) => write.kind === "update")).toHaveLength(1);
  });

  it("refuses to delete a question others are gated on", async () => {
    const questions = [
      { ...existing[0], sort_order: 0 },
      { id: B, question_type: "free_text", prompt: "Why the bus?", help_text: null, required: false, sort_order: 1, config_json: { visible_when: { question_id: A, operator: "answered" } }, category_id: null },
    ];
    const { supabase, writes } = builderClient(questions, existingOptions);
    createClientMock.mockResolvedValue(supabase);

    const response = responseOf(
      await deleteQuestion(jsonRequest({}, "DELETE"), {
        params: Promise.resolve({ campaignId: CAMPAIGN_ID, questionId: A }),
      })
    );

    expect(response.status).toBe(409);
    expect(writes.filter((write) => write.kind === "delete")).toEqual([]);
  });
});

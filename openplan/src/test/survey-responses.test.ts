import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aggregateCampaignSurvey,
  aggregateSurveyQuestion,
  flattenSurveyAnswerForExport,
  insertSurveyResponse,
  loadApprovedSurveyAnswers,
  loadSurveyResponseSessions,
  readSurveyConditionRefs,
} from "@/lib/engagement/survey-responses";

const OPTS = [
  { id: "a1", label: "Bike lane" },
  { id: "a2", label: "Bus stop" },
];

describe("aggregateSurveyQuestion — pure dispatch", () => {
  it("dispatches choice types to tallyChoice with the right shape + answeredCount", () => {
    const agg = aggregateSurveyQuestion(
      { id: "q1", question_type: "multiple_choice", prompt: "What next?", config_json: {} },
      OPTS,
      [{ answer_json: { option_ids: ["a1"] } }, { answer_json: { option_ids: ["a1", "a2"] } }]
    );
    expect(agg.questionId).toBe("q1");
    expect(agg.questionType).toBe("multiple_choice");
    expect(agg.family).toBe("choice");
    expect(agg.answeredCount).toBe(2);
    const a = agg.aggregation as { rows: { option_id: string; count: number }[] };
    expect(a.rows.find((r) => r.option_id === "a1")!.count).toBe(2);
  });

  it("reads likert scale + labels from config_json", () => {
    const agg = aggregateSurveyQuestion(
      { id: "q2", question_type: "likert", prompt: "Agree?", config_json: { scale: 5 } },
      [],
      [{ answer_json: { value: 5 } }, { answer_json: { value: 3 } }]
    );
    const a = agg.aggregation as { mean: number; distribution: Record<number, number> };
    expect(agg.family).toBe("scale");
    expect(a.mean).toBe(4);
    expect(a.distribution[5]).toBe(1);
  });

  it("reads budget total/unit from config_json and never normalizes underfilled ballots", () => {
    const agg = aggregateSurveyQuestion(
      { id: "q3", question_type: "budget_allocation", prompt: "Allocate", config_json: { total: 100, unit: "usd" } },
      OPTS,
      [{ answer_json: { allocations: [{ option_id: "a1", amount: 30 }] } }]
    );
    const a = agg.aggregation as { pool: number; unit: string; rows: { option_id: string; pctOfPool: number }[] };
    expect(a.pool).toBe(30);
    expect(a.unit).toBe("usd");
    expect(a.rows.find((r) => r.option_id === "a1")!.pctOfPool).toBe(1);
  });

  it("dispatches ranking / map_point / free_text to their aggregators", () => {
    expect(aggregateSurveyQuestion({ id: "r", question_type: "ranking", prompt: "", config_json: {} }, OPTS, [{ answer_json: { ranking: ["a1"] } }]).family).toBe("choice");
    expect(aggregateSurveyQuestion({ id: "m", question_type: "map_point", prompt: "", config_json: {} }, [], [{ answer_json: { geometry: { type: "Point", coordinates: [-121, 39] } } }]).answeredCount).toBe(1);
    const ft = aggregateSurveyQuestion({ id: "f", question_type: "free_text", prompt: "", config_json: {} }, [], [{ answer_json: { text: "hi" }, answer_text: "More trees" }]);
    expect(ft.family).toBe("text");
    expect((ft.aggregation as { sample: string[] }).sample).toEqual(["More trees"]);
  });
});

function mockInsertClient(opts: { sessionError?: { message: string } | null; answersError?: { message: string } | null }) {
  const deleted: { called: boolean; filters: [string, string][] } = { called: false, filters: [] };
  const from = (table: string) => {
    if (table === "engagement_survey_response_sessions") {
      return {
        insert: () => ({ select: () => ({ single: async () => ({ data: opts.sessionError ? null : { id: "s1" }, error: opts.sessionError ?? null }) }) }),
        delete: () => ({
          eq: (c: string, v: string) => ({
            eq: (c2: string, v2: string) => {
              deleted.called = true;
              deleted.filters.push([c, v], [c2, v2]);
              return Promise.resolve({ error: null });
            },
          }),
        }),
      };
    }
    if (table === "engagement_survey_answers") {
      return { insert: async () => ({ error: opts.answersError ?? null }) };
    }
    throw new Error(`unexpected table ${table}`);
  };
  return { supabase: { from } as unknown as SupabaseClient, deleted };
}

describe("insertSurveyResponse — transactional-ish write", () => {
  const base = {
    campaignId: "camp-1",
    submittedBy: null,
    sourceType: "public" as const,
    status: "pending" as const,
    respondentFingerprint: "fp",
    metadata: {},
    answers: [{ questionId: "q1", questionType: "free_text" as const, questionPromptSnapshot: "P", answerJson: { text: "hi" }, answerText: "hi" }],
  };

  it("returns the session id when session + answers both insert", async () => {
    const { supabase, deleted } = mockInsertClient({});
    const result = await insertSurveyResponse(supabase, base);
    expect(result).toEqual({ ok: true, sessionId: "s1" });
    expect(deleted.called).toBe(false);
  });

  it("deletes the session (campaign-scoped) when the answers insert fails", async () => {
    const { supabase, deleted } = mockInsertClient({ answersError: { message: "boom" } });
    const result = await insertSurveyResponse(supabase, base);
    expect(result.ok).toBe(false);
    expect(deleted.called).toBe(true);
    expect(deleted.filters).toEqual([["id", "s1"], ["campaign_id", "camp-1"]]);
  });

  it("fails without touching answers when the session insert fails", async () => {
    const { supabase, deleted } = mockInsertClient({ sessionError: { message: "nope" } });
    const result = await insertSurveyResponse(supabase, base);
    expect(result.ok).toBe(false);
    expect(deleted.called).toBe(false);
  });
});

/**
 * A query client whose reads can be made to FAIL BY TABLE.
 *
 * Without that lever these tests prove nothing: a fake client hands back its
 * fixture whatever the code asked for, so the failure branch is unreachable and
 * every assertion would pass over code that never runs. Each builder is
 * thenable so it satisfies the three different chains the loaders terminate on
 * (`.order()`, `.limit()`, and the bare `.eq()` of the answers read).
 */
function mockReadClient(
  fixtures: Record<string, { rows?: Record<string, unknown>[]; error?: { message: string } }>
) {
  const from = (table: string) => {
    const fixture = fixtures[table];
    if (!fixture) throw new Error(`unexpected table ${table}`);
    const result = { data: fixture.error ? null : fixture.rows ?? [], error: fixture.error ?? null };
    const builder: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    for (const method of ["select", "eq", "order", "limit"]) builder[method] = () => builder;
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

const SESSION_ROW = {
  id: "s1",
  status: "approved",
  submitted_by: null,
  source_type: "public",
  moderation_notes: null,
  created_at: "2026-03-04T10:00:00.000Z",
  updated_at: "2026-03-04T10:00:00.000Z",
};

describe("the sensitive response loaders report a failed read", () => {
  // The whole point: `result.data ?? []` said "this campaign has no responses"
  // for an outage, and every caller repeated it as fact.
  it("hands back the error, and no rows it did not read, when the session read fails", async () => {
    const supabase = mockReadClient({
      engagement_survey_response_sessions: { error: { message: "connection reset" } },
    });

    const result = await loadSurveyResponseSessions(supabase, "camp-1");

    expect(result.rows).toEqual([]);
    expect(result.error?.message).toBe("connection reset");
  });

  it("reports a null error when the session read genuinely found nothing", async () => {
    const supabase = mockReadClient({ engagement_survey_response_sessions: { rows: [] } });

    const result = await loadSurveyResponseSessions(supabase, "camp-1");

    expect(result.rows).toEqual([]);
    expect(result.error).toBeNull();
  });

  it("hands back the error when the approved-answers read fails", async () => {
    const supabase = mockReadClient({
      engagement_survey_answers: { error: { message: "statement timeout" } },
    });

    const result = await loadApprovedSurveyAnswers(supabase, "camp-1");

    expect(result.rows).toEqual([]);
    expect(result.error?.message).toBe("statement timeout");
  });
});

/**
 * THE ONE WHERE A DISCARDED ERROR IS A WRITE, NOT A SENTENCE.
 *
 * `readSurveyConditionRefs` is what the archive and delete handlers decide
 * dependency from. Its predecessor threw `loadSurveyDefinition`'s error away and
 * returned a bare array, so an unreadable survey and a survey with no active
 * questions produced the identical value: `[]`. `findSurveyQuestionsDependingOn`
 * then found nothing to depend on the question being removed, and the delete
 * went through — which is the read failure being answered as PERMISSION.
 */
describe("readSurveyConditionRefs — an unreadable survey is not an empty one", () => {
  const CONDITION_QUESTION = {
    id: "q1",
    question_type: "single_choice",
    prompt: "How do you travel?",
    help_text: null,
    required: false,
    sort_order: 3,
    config_json: { some: "config" },
    category_id: null,
  };

  it("returns the refs, in display order with their option ids, when both reads answered", async () => {
    const result = await readSurveyConditionRefs(
      mockReadClient({
        engagement_survey_questions: { rows: [CONDITION_QUESTION] },
        engagement_survey_question_options: {
          rows: [{ id: "o1", question_id: "q1", label: "Bus", value: null, sort_order: 0, metadata_json: {} }],
        },
      }),
      "camp-1"
    );

    expect(result.error).toBeNull();
    expect(result.refs).toEqual([
      {
        id: "q1",
        prompt: "How do you travel?",
        question_type: "single_choice",
        config: { some: "config" },
        optionIds: ["o1"],
        sortOrder: 3,
      },
    ]);
  });

  it("reports a null error when the campaign genuinely has no active questions", async () => {
    const result = await readSurveyConditionRefs(
      mockReadClient({
        engagement_survey_questions: { rows: [] },
        engagement_survey_question_options: { rows: [] },
      }),
      "camp-1"
    );

    expect(result.refs).toEqual([]);
    expect(result.error).toBeNull();
  });

  it("hands back the error when the QUESTION read fails, so no caller reads [] as 'nothing depends on this'", async () => {
    const result = await readSurveyConditionRefs(
      mockReadClient({
        engagement_survey_questions: { error: { message: "permission denied for table engagement_survey_questions" } },
        engagement_survey_question_options: { rows: [] },
      }),
      "camp-1"
    );

    expect(result.refs).toEqual([]);
    expect(result.error?.message).toBe("permission denied for table engagement_survey_questions");
  });

  /**
   * The quieter half, and the reason the seam carries the FIRST failure of the
   * two rather than only the question one: the options read failing leaves every
   * question present with an empty `optionIds`, which is not an absence of
   * refs at all — it is a survey whose conditions all appear to point at options
   * that no longer exist.
   */
  it("hands back the error when only the OPTION read fails, even though refs came back", async () => {
    const result = await readSurveyConditionRefs(
      mockReadClient({
        engagement_survey_questions: { rows: [CONDITION_QUESTION] },
        engagement_survey_question_options: { error: { message: "statement timeout" } },
      }),
      "camp-1"
    );

    expect(result.refs).toHaveLength(1);
    expect(result.refs[0].optionIds).toEqual([]);
    expect(result.error?.message).toBe("statement timeout");
  });
});

describe("aggregateCampaignSurvey — a zero is only a count when the reads succeeded", () => {
  const definitionFixtures = {
    engagement_survey_questions: {
      rows: [
        {
          id: "q1",
          question_type: "free_text",
          prompt: "What next?",
          help_text: null,
          required: false,
          sort_order: 0,
          config_json: {},
          category_id: null,
        },
      ],
    },
    engagement_survey_question_options: { rows: [] },
  };

  it("reports no error, and the real count, when every read answered", async () => {
    const result = await aggregateCampaignSurvey(
      mockReadClient({
        ...definitionFixtures,
        engagement_survey_answers: { rows: [{ question_id: "q1", question_type: "free_text", answer_json: { text: "hi" }, answer_text: "More trees" }] },
        engagement_survey_response_sessions: { rows: [SESSION_ROW] },
      }),
      "camp-1"
    );

    expect(result.error).toBeNull();
    expect(result.approvedResponseCount).toBe(1);
    expect(result.questions[0].answeredCount).toBe(1);
  });

  it("surfaces a failed SESSION read behind the zero it would otherwise report", async () => {
    const result = await aggregateCampaignSurvey(
      mockReadClient({
        ...definitionFixtures,
        engagement_survey_answers: { rows: [] },
        engagement_survey_response_sessions: { error: { message: "connection reset" } },
      }),
      "camp-1"
    );

    expect(result.approvedResponseCount).toBe(0);
    expect(result.error?.message).toBe("connection reset");
  });

  it("surfaces a failed ANSWERS read, which would otherwise read as an unanswered question", async () => {
    const result = await aggregateCampaignSurvey(
      mockReadClient({
        ...definitionFixtures,
        engagement_survey_answers: { error: { message: "statement timeout" } },
        engagement_survey_response_sessions: { rows: [SESSION_ROW] },
      }),
      "camp-1"
    );

    expect(result.questions[0].answeredCount).toBe(0);
    expect(result.error?.message).toBe("statement timeout");
  });

  it("surfaces a failed DEFINITION read, which would otherwise read as 'no survey'", async () => {
    const result = await aggregateCampaignSurvey(
      mockReadClient({
        engagement_survey_questions: { error: { message: "permission denied for relation" } },
        engagement_survey_question_options: { rows: [] },
        engagement_survey_answers: { rows: [] },
        engagement_survey_response_sessions: { rows: [] },
      }),
      "camp-1"
    );

    expect(result.questions).toEqual([]);
    expect(result.error?.message).toBe("permission denied for relation");
  });
});

describe("flattenSurveyAnswerForExport — the edges the route test's fixtures do not walk", () => {
  const labels = new Map([
    ["a1", "Bike lane"],
    ["a2", "Bus stop"],
  ]);

  it("falls back honestly when an answer's option no longer exists anywhere", () => {
    const flat = flattenSurveyAnswerForExport(
      // answer_text null too: the submit-time label projection is also gone.
      { question_type: "single_choice", answer_json: { option_id: "gone" }, answer_text: null },
      labels
    );
    expect(flat.text).toBe("(removed option)");
    expect(flat.value).toEqual({ option_label: "(removed option)" });
  });

  it("prefers the submit-time label snapshot over a re-resolved label for the CSV text", () => {
    const flat = flattenSurveyAnswerForExport(
      { question_type: "single_choice", answer_json: { option_id: "a1" }, answer_text: "Protected bike lane" },
      labels
    );
    // The respondent chose "Protected bike lane"; the option has since been
    // relabelled "Bike lane". The text keeps what they saw; the structured
    // value re-resolves for machine readers.
    expect(flat.text).toBe("Protected bike lane");
    expect(flat.value).toEqual({ option_label: "Bike lane" });
  });

  it("derives lon/lat for a map point even when a note exists", () => {
    const flat = flattenSurveyAnswerForExport(
      {
        question_type: "map_point",
        answer_json: { geometry: { type: "Point", coordinates: [12.34567, -5.67891] }, note: "Here" },
        answer_text: "Here",
      },
      labels
    );
    expect(flat.text).toBe("12.34567,-5.67891 — Here");
    expect(flat.value).toEqual({ longitude: 12.34567, latitude: -5.67891, note: "Here" });
  });

  it("does not invent coordinates for unreadable geometry", () => {
    const flat = flattenSurveyAnswerForExport(
      { question_type: "map_point", answer_json: { geometry: { type: "Nonsense" } }, answer_text: null },
      labels
    );
    expect(flat.text).toBe("(unreadable geometry)");
    expect(flat.value).toEqual({});
  });

  it("emits a count and names for files — never sizes, mimes or storage paths", () => {
    const flat = flattenSurveyAnswerForExport(
      {
        question_type: "file_upload",
        answer_json: { files: [{ path: "up/x/a.jpg", mime: "image/jpeg", size: 999 }] },
        answer_text: "a.jpg",
      },
      labels
    );
    expect(flat.text).toBe("1 file: a.jpg");
    expect(flat.value).toEqual({ file_count: 1, file_names: ["a.jpg"] });
    expect(JSON.stringify(flat)).not.toContain("999");
    expect(JSON.stringify(flat)).not.toContain("up/x");
  });

  it("survives malformed answer_json without throwing", () => {
    const flat = flattenSurveyAnswerForExport(
      { question_type: "budget_allocation", answer_json: "not-an-object", answer_text: null },
      labels
    );
    expect(flat.text).toBe("");
    expect(flat.value).toEqual({ allocations: [] });
  });
});

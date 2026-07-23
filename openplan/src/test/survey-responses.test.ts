import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aggregateSurveyQuestion, insertSurveyResponse } from "@/lib/engagement/survey-responses";

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

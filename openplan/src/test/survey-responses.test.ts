import { describe, expect, it } from "vitest";
import { aggregateSurveyQuestion } from "@/lib/engagement/survey-responses";

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

import { describe, expect, it } from "vitest";
import {
  validateSurveyAnswer,
  validateSurveyConfig,
  tallyChoice,
  summarizeLikert,
  summarizeRating,
  summarizeRanking,
  summarizeBudget,
  summarizeMapPoints,
  summarizeFreeText,
  SURVEY_SMALL_SAMPLE_N,
  SURVEY_QUESTION_TYPES_LIST,
  type SurveyQuestionType,
  type SurveyQuestionContext,
} from "@/lib/engagement/survey";

type Opt = { id: string; label: string };
function ctx(
  type: SurveyQuestionType,
  opts: { required?: boolean; config?: unknown; options?: Opt[] } = {}
): SurveyQuestionContext {
  const options = opts.options ?? [];
  return {
    id: "q1",
    question_type: type,
    required: opts.required ?? false,
    config: opts.config ?? {},
    optionIds: options.map((o) => o.id),
    optionLabelById: new Map(options.map((o) => [o.id, o.label])),
  };
}
const OPTS: Opt[] = [
  { id: "a1", label: "Bike lane" },
  { id: "a2", label: "Bus stop" },
  { id: "a3", label: "Crosswalk" },
];
function ok(r: ReturnType<typeof validateSurveyAnswer>) {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
}
function code(r: ReturnType<typeof validateSurveyAnswer>) {
  return r.ok ? "OK" : r.code;
}

describe("validateSurveyAnswer — emptiness / required", () => {
  it("empty + required → REQUIRED_EMPTY for every type", () => {
    for (const t of SURVEY_QUESTION_TYPES_LIST) {
      expect(code(validateSurveyAnswer(ctx(t, { required: true, config: t === "budget_allocation" ? { total: 100 } : {}, options: OPTS }), null))).toBe("REQUIRED_EMPTY");
    }
  });
  it("empty + optional → isEmpty with no row (answer null)", () => {
    const r = ok(validateSurveyAnswer(ctx("free_text"), null));
    expect(r.isEmpty).toBe(true);
    expect(r.answer).toBeNull();
    expect(r.answerText).toBeNull();
  });
  it("whitespace-only free text is empty", () => {
    const r = ok(validateSurveyAnswer(ctx("free_text"), { text: "   \n  " }));
    expect(r.isEmpty).toBe(true);
  });
  it("all-zero budget is empty", () => {
    const r = ok(validateSurveyAnswer(ctx("budget_allocation", { config: { total: 100 }, options: OPTS }), { allocations: [{ option_id: "a1", amount: 0 }] }));
    expect(r.isEmpty).toBe(true);
  });
});

describe("validateSurveyAnswer — single/multiple choice", () => {
  it("valid single choice → label as answerText", () => {
    const r = ok(validateSurveyAnswer(ctx("single_choice", { options: OPTS }), { option_id: "a2" }));
    expect(r.answerText).toBe("Bus stop");
  });
  it("unknown option → UNKNOWN_OPTION", () => {
    expect(code(validateSurveyAnswer(ctx("single_choice", { options: OPTS }), { option_id: "zzz" }))).toBe("UNKNOWN_OPTION");
  });
  it("other_text without allow_other → OTHER_TEXT_MISSING", () => {
    expect(code(validateSurveyAnswer(ctx("single_choice", { options: OPTS }), { option_id: "a1", other_text: "Bench" }))).toBe("OTHER_TEXT_MISSING");
  });
  it("other_text with allow_other → ok, other text wins, option_id dropped (no double-count)", () => {
    const r = ok(validateSurveyAnswer(ctx("single_choice", { config: { allow_other: true }, options: OPTS }), { option_id: "a1", other_text: "Bench" }));
    expect(r.answerText).toBe("Bench");
    // The unvalidated option_id must NOT be stored, or tallyChoice would count it.
    expect((r.answer as Record<string, unknown>).option_id).toBeUndefined();
    expect((r.answer as Record<string, unknown>).other_text).toBe("Bench");
    const agg = tallyChoice([{ answer_json: r.answer }], OPTS);
    expect(agg.rows.every((row) => row.count === 0)).toBe(true);
    expect(agg.otherTexts).toEqual(["Bench"]);
  });
  it("multiple choice dedupe + join labels", () => {
    const r = ok(validateSurveyAnswer(ctx("multiple_choice", { options: OPTS }), { option_ids: ["a1", "a3"] }));
    expect(r.answerText).toBe("Bike lane; Crosswalk");
  });
  it("duplicate options → DUPLICATE_OPTION", () => {
    expect(code(validateSurveyAnswer(ctx("multiple_choice", { options: OPTS }), { option_ids: ["a1", "a1"] }))).toBe("DUPLICATE_OPTION");
  });
  it("min/max select enforced (count includes other_text)", () => {
    expect(code(validateSurveyAnswer(ctx("multiple_choice", { config: { max_select: 1 }, options: OPTS }), { option_ids: ["a1", "a2"] }))).toBe("SELECT_COUNT_OUT_OF_RANGE");
    expect(code(validateSurveyAnswer(ctx("multiple_choice", { config: { min_select: 2 }, options: OPTS }), { option_ids: ["a1"] }))).toBe("SELECT_COUNT_OUT_OF_RANGE");
  });
});

describe("validateSurveyAnswer — likert / rating", () => {
  it("likert in range maps to label", () => {
    const r = ok(validateSurveyAnswer(ctx("likert", { config: { scale: 5, labels: ["Awful", "Bad", "Ok", "Good", "Great"] } }), { value: 4 }));
    expect(r.answerText).toBe("Good");
  });
  it("likert out of range → VALUE_OUT_OF_RANGE", () => {
    expect(code(validateSurveyAnswer(ctx("likert", { config: { scale: 5 } }), { value: 6 }))).toBe("VALUE_OUT_OF_RANGE");
    expect(code(validateSurveyAnswer(ctx("likert", { config: { scale: 5 } }), { value: 3.5 }))).toBe("VALUE_OUT_OF_RANGE");
  });
  it("rating rejects half step unless allow_half", () => {
    expect(code(validateSurveyAnswer(ctx("rating", { config: { max: 5 } }), { value: 3.5 }))).toBe("VALUE_OUT_OF_RANGE");
    expect(code(validateSurveyAnswer(ctx("rating", { config: { max: 5, allow_half: true } }), { value: 3.5 }))).toBe("OK");
    expect(code(validateSurveyAnswer(ctx("rating", { config: { max: 5, allow_half: true } }), { value: 3.25 }))).toBe("VALUE_OUT_OF_RANGE");
  });
});

describe("validateSurveyAnswer — ranking", () => {
  it("valid ranking → labels joined with >", () => {
    const r = ok(validateSurveyAnswer(ctx("ranking", { options: OPTS }), { ranking: ["a2", "a1"] }));
    expect(r.answerText).toBe("Bus stop > Bike lane");
  });
  it("require_full incomplete → RANKING_INCOMPLETE", () => {
    expect(code(validateSurveyAnswer(ctx("ranking", { config: { require_full: true }, options: OPTS }), { ranking: ["a1"] }))).toBe("RANKING_INCOMPLETE");
  });
  it("duplicate rank → DUPLICATE_OPTION", () => {
    expect(code(validateSurveyAnswer(ctx("ranking", { options: OPTS }), { ranking: ["a1", "a1"] }))).toBe("DUPLICATE_OPTION");
  });
  it("over max_ranked → RANKING_TOO_MANY (distinct from the too-few code)", () => {
    expect(code(validateSurveyAnswer(ctx("ranking", { config: { max_ranked: 2 }, options: OPTS }), { ranking: ["a1", "a2", "a3"] }))).toBe("RANKING_TOO_MANY");
  });
});

describe("validateSurveyAnswer — map_point", () => {
  const point = { type: "Point", coordinates: [-121.0, 39.2] };
  it("valid point → lng,lat answerText when no note", () => {
    const r = ok(validateSurveyAnswer(ctx("map_point", { config: { geometry_types: ["Point"] } }), { geometry: point }));
    expect(r.answerText).toContain("-121.00000");
  });
  it("note wins over coordinates", () => {
    const r = ok(validateSurveyAnswer(ctx("map_point"), { geometry: point, note: "Dangerous corner" }));
    expect(r.answerText).toBe("Dangerous corner");
  });
  it("invalid geometry → GEOMETRY_INVALID", () => {
    expect(code(validateSurveyAnswer(ctx("map_point"), { geometry: { type: "Point", coordinates: [999, 999] } }))).toBe("GEOMETRY_INVALID");
  });
  it("disallowed type → GEOMETRY_TYPE_NOT_ALLOWED", () => {
    const line = { type: "LineString", coordinates: [[-121, 39], [-121.1, 39.1]] };
    expect(code(validateSurveyAnswer(ctx("map_point", { config: { geometry_types: ["Point"] } }), { geometry: line }))).toBe("GEOMETRY_TYPE_NOT_ALLOWED");
  });
});

describe("validateSurveyAnswer — budget", () => {
  it("valid allocation → nonzero lines in answerText", () => {
    const r = ok(validateSurveyAnswer(ctx("budget_allocation", { config: { total: 100 }, options: OPTS }), { allocations: [{ option_id: "a1", amount: 60 }, { option_id: "a2", amount: 0 }, { option_id: "a3", amount: 40 }] }));
    expect(r.answerText).toBe("Bike lane: 60; Crosswalk: 40");
  });
  it("over budget → BUDGET_OVER", () => {
    expect(code(validateSurveyAnswer(ctx("budget_allocation", { config: { total: 100 }, options: OPTS }), { allocations: [{ option_id: "a1", amount: 101 }] }))).toBe("BUDGET_OVER");
  });
  it("must_allocate_all under → BUDGET_UNDER", () => {
    expect(code(validateSurveyAnswer(ctx("budget_allocation", { config: { total: 100, must_allocate_all: true }, options: OPTS }), { allocations: [{ option_id: "a1", amount: 50 }] }))).toBe("BUDGET_UNDER");
  });
  it("tolerance: sum just over by epsilon is accepted", () => {
    expect(code(validateSurveyAnswer(ctx("budget_allocation", { config: { total: 100 }, options: OPTS }), { allocations: [{ option_id: "a1", amount: 100.0000001 }] }))).toBe("OK");
  });
});

describe("validateSurveyAnswer — free text / file", () => {
  it("too long → TEXT_TOO_LONG", () => {
    expect(code(validateSurveyAnswer(ctx("free_text", { config: { max_length: 5 } }), { text: "way too long" }))).toBe("TEXT_TOO_LONG");
  });
  it("too short → TEXT_TOO_SHORT", () => {
    expect(code(validateSurveyAnswer(ctx("free_text", { config: { min_length: 10 } }), { text: "short" }))).toBe("TEXT_TOO_SHORT");
  });
  it("file too many / too large / bad mime", () => {
    const f = (over = {}) => ({ path: "c/x.jpg", mime: "image/jpeg", size: 1000, ...over });
    expect(code(validateSurveyAnswer(ctx("file_upload", { config: { max_files: 1 } }), { files: [f(), f()] }))).toBe("TOO_MANY_FILES");
    expect(code(validateSurveyAnswer(ctx("file_upload", { config: { max_size_bytes: 500 } }), { files: [f()] }))).toBe("FILE_TOO_LARGE");
    expect(code(validateSurveyAnswer(ctx("file_upload"), { files: [f({ mime: "application/pdf" })] }))).toBe("UNSUPPORTED_MIME");
  });
});

describe("validateSurveyConfig", () => {
  it("accepts a valid likert config, rejects mismatched labels", () => {
    expect(validateSurveyConfig("likert", { scale: 5 }).ok).toBe(true);
    expect(validateSurveyConfig("likert", { scale: 5, labels: ["a", "b"] }).ok).toBe(false);
  });
  it("budget requires a positive total", () => {
    expect(validateSurveyConfig("budget_allocation", {}).ok).toBe(false);
    expect(validateSurveyConfig("budget_allocation", { total: 100 }).ok).toBe(true);
  });
  it("rejects unknown config keys (strict)", () => {
    expect(validateSurveyConfig("free_text", { bogus: true }).ok).toBe(false);
  });
});

describe("aggregation helpers — n = answered count, lowN label", () => {
  it("tallyChoice includes unpicked options at 0 and collects other_text", () => {
    const answers = [
      { answer_json: { option_ids: ["a1", "a2"] } },
      { answer_json: { option_ids: ["a1"], other_text: "Bench" } },
    ];
    const agg = tallyChoice(answers, OPTS);
    expect(agg.n).toBe(2);
    expect(agg.lowN).toBe(true);
    expect(agg.rows.find((r) => r.option_id === "a1")!.count).toBe(2);
    expect(agg.rows.find((r) => r.option_id === "a3")!.count).toBe(0);
    expect(agg.rows.find((r) => r.option_id === "a1")!.pct).toBe(1);
    expect(agg.otherTexts).toEqual(["Bench"]);
  });
  it("likert mean + distribution + topBox", () => {
    const answers = [1, 5, 5, 3].map((value) => ({ answer_json: { value } }));
    const agg = summarizeLikert(answers, { scale: 5 });
    expect(agg.n).toBe(4);
    expect(agg.mean).toBe(3.5);
    expect(agg.distribution[5]).toBe(2);
    expect(agg.topBoxPct).toBe(0.5);
  });
  it("rating min/max/mean", () => {
    const agg = summarizeRating([{ answer_json: { value: 2 } }, { answer_json: { value: 4 } }], { max: 5 });
    expect(agg.mean).toBe(3);
    expect(agg.min).toBe(2);
    expect(agg.max).toBe(4);
  });
  it("ranking Borda ranks a broadly-preferred item highest, reports meanRank + timesRanked", () => {
    const answers = [
      { answer_json: { ranking: ["a1", "a2", "a3"] } },
      { answer_json: { ranking: ["a1", "a3"] } }, // partial
    ];
    const agg = summarizeRanking(answers, OPTS);
    expect(agg.partialCoverage).toBe(true);
    expect(agg.rows[0].option_id).toBe("a1");
    expect(agg.rows.find((r) => r.option_id === "a1")!.timesRanked).toBe(2);
    expect(agg.rows.find((r) => r.option_id === "a1")!.meanRank).toBe(1);
  });
  it("Borda uses candidate count N so single-item ballots differentiate (not all 0)", () => {
    const answers = [
      ...Array.from({ length: 6 }, () => ({ answer_json: { ranking: ["a1"] } })),
      ...Array.from({ length: 4 }, () => ({ answer_json: { ranking: ["a2"] } })),
    ];
    const agg = summarizeRanking(answers, OPTS);
    // N=3 → a top pick scores N-1=2. a1=6*2=12, a2=4*2=8, a3=0 (not all tied at 0).
    expect(agg.rows.find((r) => r.option_id === "a1")!.bordaScore).toBe(12);
    expect(agg.rows.find((r) => r.option_id === "a2")!.bordaScore).toBe(8);
    expect(agg.rows.find((r) => r.option_id === "a3")!.bordaScore).toBe(0);
    expect(agg.rows[0].option_id).toBe("a1");
  });
  it("budget pctOfPool never normalizes underfilled ballots to 100%", () => {
    const answers = [
      { answer_json: { allocations: [{ option_id: "a1", amount: 30 }] } }, // only 30 of 100
      { answer_json: { allocations: [{ option_id: "a2", amount: 70 }] } },
    ];
    const agg = summarizeBudget(answers, OPTS, { total: 100, unit: "usd" });
    expect(agg.pool).toBe(100);
    expect(agg.rows.find((r) => r.option_id === "a1")!.pctOfPool).toBeCloseTo(0.3);
  });
  it("map points cluster count buckets near points together", () => {
    const near = { type: "Point", coordinates: [-121.0, 39.2] };
    const near2 = { type: "Point", coordinates: [-121.001, 39.2005] };
    const far = { type: "Point", coordinates: [-122.5, 40.0] };
    const agg = summarizeMapPoints([{ answer_json: { geometry: near } }, { answer_json: { geometry: near2 } }, { answer_json: { geometry: far } }]);
    expect(agg.n).toBe(3);
    expect(agg.clusterCount).toBe(2);
  });
  it("free text uses answer_text projection", () => {
    const agg = summarizeFreeText([{ answer_json: { text: "a" }, answer_text: "More trees please" }, { answer_json: {}, answer_text: "  " }]);
    expect(agg.answered).toBe(1);
    expect(agg.sample).toEqual(["More trees please"]);
  });
  it("lowN flips false at the threshold", () => {
    const many = Array.from({ length: SURVEY_SMALL_SAMPLE_N }, () => ({ answer_json: { value: 3 } }));
    expect(summarizeLikert(many, { scale: 5 }).lowN).toBe(false);
    expect(summarizeLikert(many.slice(1), { scale: 5 }).lowN).toBe(true);
  });
});

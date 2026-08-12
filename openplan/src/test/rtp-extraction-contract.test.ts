import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE CONTRACT A MODEL IS HELD TO WHEN IT READS AN ADOPTED PLAN.
 *
 * Three properties are asserted here and none of them can be checked by reading
 * the prose that claims them:
 *
 * 1. THE PROMPT IS BLIND TO THE DATABASE. `buildExtractionPrompt` takes
 *    passages of the uploaded document and a target kind. There is no parameter
 *    for the cycle's existing ledger — and this file proves it over the BUILT
 *    STRING as well, because a future session adding "for context, here is what
 *    is already recorded" would be adding a way for a figure to leave OpenPlan
 *    and come back wearing a page citation.
 *
 * 2. NO CONFIDENCE SCORE CAN SURVIVE THE PARSE. Instructing a model not to
 *    volunteer one is a convention. Dropping every key except the four a
 *    candidate may have is a mechanism.
 *
 * 3. THE TARGET-KIND VOCABULARY IS THE DATABASE'S. Two copies of one vocabulary
 *    is the shape that shipped a form the database refused, so the TypeScript
 *    constant is pinned to the CHECK in 20260811000008.
 */

import {
  DEFAULT_RTP_EXTRACTION_MODEL_ID,
  EXTRACTION_MAX_CANDIDATES_PER_CALL,
  RTP_EXTRACTION_DEFAULT_TARGET_KINDS,
  RTP_EXTRACTION_MODEL_ENV,
  RTP_EXTRACTION_TARGETS,
  RTP_EXTRACTION_TARGET_KINDS,
  buildExtractionPrompt,
  parsePassageFactId,
  parseExtractionResponse,
  passageFactId,
  resolveRtpExtractionModelId,
  type ExtractionPassage,
} from "@/lib/rtp/extraction/contract";

const MIGRATION = path.resolve(
  process.cwd(),
  "supabase/migrations/20260811000008_rtp_extraction_staging.sql"
);

const PASSAGES: ExtractionPassage[] = [
  {
    chunkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    page: 112,
    content: "Local Transportation Sales Tax Measure R    $412,000,000    (2024 dollars)",
  },
  {
    chunkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    page: 113,
    content: "State Highway Operation and Protection Program    $88.4 million",
  },
];

describe("the target-kind vocabulary is the database's", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("names every kind the CHECK constraint admits, and no others", () => {
    const check = sql.match(/target_kind TEXT NOT NULL CHECK \(target_kind IN \(([\s\S]*?)\)\)/);
    expect(check, "the target_kind CHECK is no longer where this guard looks").not.toBeNull();

    const fromSql = Array.from(check![1].matchAll(/'([a-z_]+)'/g)).map((match) => match[1]);
    expect(fromSql.length).toBeGreaterThan(0);
    expect([...RTP_EXTRACTION_TARGET_KINDS].sort()).toEqual([...fromSql].sort());
  });

  it("has a spec for every kind, keyed by its own name", () => {
    for (const kind of RTP_EXTRACTION_TARGET_KINDS) {
      expect(RTP_EXTRACTION_TARGETS[kind].kind).toBe(kind);
      expect(RTP_EXTRACTION_TARGETS[kind].prefilterTerms.length).toBeGreaterThan(0);
    }
  });

  it("leaves chapter blocks out of the default run", () => {
    // Verbatim chapter prose does not land in an RTP table; it goes through the
    // narrative-draft staging machinery, which is a different acceptance path.
    // Filling a queue that has no screen is the shipped-invisible defect.
    expect(RTP_EXTRACTION_DEFAULT_TARGET_KINDS).not.toContain("chapter_block");
    expect(RTP_EXTRACTION_DEFAULT_TARGET_KINDS.length).toBe(
      RTP_EXTRACTION_TARGET_KINDS.length - 1
    );
  });
});

describe("the prompt is blind to the database", () => {
  it("carries the passages, their ids and their pages", () => {
    const { prompt } = buildExtractionPrompt({ targetKind: "financial_line", passages: PASSAGES });

    for (const passage of PASSAGES) {
      expect(prompt).toContain(passageFactId(passage.chunkId));
      expect(prompt).toContain(`p.${passage.page}`);
      expect(prompt).toContain(passage.content);
    }
  });

  it("takes no parameter through which existing RTP rows could reach it", () => {
    // Structural, and the reason the assertion below can be trusted: a caller
    // cannot leak a ledger it has no way to pass. `buildExtractionPrompt` is
    // (targetKind, passages) — arity 1 object, two keys.
    const built = buildExtractionPrompt({ targetKind: "financial_line", passages: PASSAGES });
    expect(Object.keys(built).sort()).toEqual(["prompt", "system"]);
    expect(buildExtractionPrompt.length).toBe(1);
  });

  it("never names a figure, a source or a period that is not in the passages", () => {
    // The live version of the same claim: a prompt built from passages that do
    // NOT contain the sentinels cannot mention them.
    const sentinels = [
      "SENTINEL-EXISTING-REVENUE-SOURCE",
      "SENTINEL-EXISTING-BAND-LABEL",
      "987654321",
    ];
    for (const kind of RTP_EXTRACTION_TARGET_KINDS) {
      const { prompt, system } = buildExtractionPrompt({ targetKind: kind, passages: PASSAGES });
      for (const sentinel of sentinels) {
        expect(prompt).not.toContain(sentinel);
        expect(system).not.toContain(sentinel);
      }
    }
  });

  it("tells the model, in the prompt, that a figure absent from its quote is discarded", () => {
    // The verifier is the mechanism; saying so is what makes the model stop
    // guessing rather than guess and be caught.
    const { prompt } = buildExtractionPrompt({ targetKind: "financial_line", passages: PASSAGES });
    expect(prompt).toMatch(/must appear inside your own `quote`/i);
    expect(prompt).toMatch(/discarded/i);
    expect(prompt).toMatch(/never return a total, a subtotal, a balance/i);
    expect(prompt).toMatch(/an empty answer is a correct answer/i);
  });

  it("asks for no confidence, certainty or likelihood anywhere", () => {
    for (const kind of RTP_EXTRACTION_TARGET_KINDS) {
      const { prompt } = buildExtractionPrompt({ targetKind: kind, passages: PASSAGES });
      // The one permitted mention is the instruction NOT to produce one.
      const mentions = prompt.match(/confidence|certainty|likelihood|probability/gi) ?? [];
      expect(mentions.length).toBeLessThanOrEqual(4);
      expect(prompt).toMatch(/Never return a confidence, certainty, likelihood, probability/i);
    }
  });
});

describe("the parse keeps four keys and drops the rest", () => {
  it("reads a fenced answer", () => {
    const parsed = parseExtractionResponse(
      '```json\n{"candidates":[{"target_kind":"financial_line","fields":{"amount":1},"source_chunk_id":"chunk_x","page":9,"quote":"q"}]}\n```'
    );
    expect(parsed).toHaveLength(1);
    expect(parsed![0]).toEqual({
      target_kind: "financial_line",
      fields: { amount: 1 },
      source_chunk_id: "x",
      page: 9,
      quote: "q",
    });
  });

  it("DROPS a confidence score the model volunteered, at the top level", () => {
    const parsed = parseExtractionResponse(
      '{"candidates":[{"target_kind":"financial_line","confidence":0.97,"certainty":"high","fields":{"amount":1},"source_chunk_id":"x","page":1,"quote":"q"}]}'
    );
    expect(parsed).toHaveLength(1);
    expect(Object.keys(parsed![0]).sort()).toEqual([
      "fields",
      "page",
      "quote",
      "source_chunk_id",
      "target_kind",
    ]);
    expect(JSON.stringify(parsed![0])).not.toMatch(/confidence|certainty/i);
  });

  it("keeps a confidence key inside `fields` only so the VERIFIER can refuse it by name", () => {
    // Deliberate: silently stripping an unknown field inside `fields` would let
    // a candidate through that looked clean, and the review surface would never
    // learn the model tried to score itself. The verifier discards the whole
    // candidate with `unknown_field`.
    const parsed = parseExtractionResponse(
      '{"candidates":[{"fields":{"amount":1,"confidence":0.9},"source_chunk_id":"x","page":1,"quote":"q"}]}'
    );
    expect(parsed![0].fields).toHaveProperty("confidence");
  });

  it("answers null — not an empty list — when there is no JSON to read", () => {
    // A parse that could not happen is not evidence that the plan says nothing.
    // The run turns this into a FAILED run; an empty list would be a succeeded
    // run reporting that the pages held no money.
    expect(parseExtractionResponse("I could not find any figures on these pages.")).toBeNull();
    expect(parseExtractionResponse("{ not json")).toBeNull();
    expect(parseExtractionResponse('{"themes":[]}')).toBeNull();
  });

  it("reads an explicitly empty answer as an empty list", () => {
    expect(parseExtractionResponse('{"candidates":[]}')).toEqual([]);
  });

  it("caps how many candidates one answer may contribute", () => {
    const many = Array.from({ length: EXTRACTION_MAX_CANDIDATES_PER_CALL + 10 }, () => ({
      fields: { amount: 1 },
      source_chunk_id: "x",
      page: 1,
      quote: "q",
    }));
    const parsed = parseExtractionResponse(JSON.stringify({ candidates: many }));
    expect(parsed).toHaveLength(EXTRACTION_MAX_CANDIDATES_PER_CALL);
  });

  it("survives a non-object entry without losing the rest", () => {
    const parsed = parseExtractionResponse(
      '{"candidates":[null,"nope",{"fields":{"amount":1},"source_chunk_id":"x","page":1,"quote":"q"}]}'
    );
    expect(parsed).toHaveLength(1);
  });
});

describe("passage ids round-trip", () => {
  it("accepts the prefixed form the prompt asks for and the bare form a model may send", () => {
    expect(parsePassageFactId(passageFactId("abc"))).toBe("abc");
    expect(parsePassageFactId("abc")).toBe("abc");
    expect(parsePassageFactId("")).toBeNull();
    expect(parsePassageFactId(null)).toBeNull();
  });
});

describe("the model id is an operator setting with an honest default", () => {
  it("prefers the environment and falls back to the repo's strong id", () => {
    expect(resolveRtpExtractionModelId({})).toBe(DEFAULT_RTP_EXTRACTION_MODEL_ID);
    expect(resolveRtpExtractionModelId({ [RTP_EXTRACTION_MODEL_ENV]: "  " })).toBe(
      DEFAULT_RTP_EXTRACTION_MODEL_ID
    );
    expect(resolveRtpExtractionModelId({ [RTP_EXTRACTION_MODEL_ENV]: " some-model " })).toBe(
      "some-model"
    );
  });
});

describe("nothing in the contract asks the model to compute", () => {
  it("declares no field whose name is an arithmetic result", () => {
    // Totals, balances, year-of-expenditure dollars, midpoints and scores are
    // computed at read time from rows a human accepted. A field here named for
    // one of them would be extraction stating an answer instead of supplying an
    // input to it.
    const forbidden = /total|balance|sum|midpoint|score|yoe|year_of_expenditure|escalated|verdict/i;
    for (const spec of Object.values(RTP_EXTRACTION_TARGETS)) {
      for (const field of spec.fields) {
        expect(field.key, `${spec.kind}.${field.key}`).not.toMatch(forbidden);
      }
    }
  });

  it("declares no field that is an identifier", () => {
    for (const spec of Object.values(RTP_EXTRACTION_TARGETS)) {
      for (const field of spec.fields) {
        expect(field.key, `${spec.kind}.${field.key}`).not.toMatch(/(^|[a-z])Id$|uuid/i);
      }
    }
  });

  it("declares no field whose stored unit differs from the unit the plan prints", () => {
    /*
      THE ESCALATION-RATE REFUSAL, made executable.

      A plan writes "3.5 percent"; `rtp_cycles.annual_inflation_rate` stores
      `0.035`. Staging a percent under a key the cycle PATCH route does not
      recognise is the worst of the options: that schema is not `.strict()`, so
      the key is STRIPPED, and a candidate carrying a basis year and a rate
      writes the year, drops the rate, and marks itself accepted — a planner who
      read two numbers off the card gets one.

      Staging the FRACTION instead is worse still: `0.035` is not in a page that
      says "3.5 percent", so either the verifier discards every one of them or
      the verifier has been loosened, and loosening it is the end of the
      feature. So no rate field exists here, and this assertion is why one
      cannot quietly reappear.
    */
    for (const spec of Object.values(RTP_EXTRACTION_TARGETS)) {
      for (const field of spec.fields) {
        expect(field.key, `${spec.kind}.${field.key}`).not.toMatch(/rate|percent|inflation/i);
      }
    }
  });

  it("declares no field that scores the model", () => {
    for (const spec of Object.values(RTP_EXTRACTION_TARGETS)) {
      for (const field of spec.fields) {
        expect(field.key).not.toMatch(/confiden|certain|likelihood|probab/i);
      }
    }
  });
});

import { describe, expect, it } from "vitest";

/**
 * THE VERIFIER IS THE FEATURE. Everything else in the RTP document-extraction
 * lane is plumbing around this one question: is the figure this candidate
 * carries actually in the words it quoted?
 *
 * These tests are written from the failure side. A model transcribing an
 * adopted plan will, sooner or later, answer $421M where the page says $412M,
 * with a real quote and a real page attached, and no planner reading forty
 * cards will catch it. So the cases below are mostly hallucinations, and what
 * they assert is that each one produces ZERO staged rows — not a corrected row,
 * not a flagged row, none.
 *
 * MUTATION-VERIFIED (2026-08-11). Each `it` below names, in its own words, the
 * line of `verify.ts` it guards; the mutations run are recorded in the session
 * report. A test whose mutation changed nothing would be saying nothing.
 */

import {
  RTP_EXTRACTION_DISCARD_SENTENCES,
  buildExtractionPassages,
  countDiscardsByReason,
  normalizeForQuoteMatch,
  verifyExtractionCandidates,
  type ExtractionChunkRow,
} from "@/lib/rtp/extraction/verify";
import {
  RTP_EXTRACTION_TARGETS,
  type ExtractionPassage,
  type RawExtractionCandidate,
} from "@/lib/rtp/extraction/contract";

const CHUNK_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHUNK_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BAND_NEAR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BAND_FAR = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/** A page of a real-looking adopted plan: a revenue table row and a period. */
const PAGE_112 =
  "Table 5-2. Reasonably Available Revenues, 2023–2032.\n" +
  "Local Transportation Sales Tax Measure R    $412,000,000    (2024 dollars)\n" +
  "State Highway Operation and Protection Program    $88.4 million\n" +
  "Operations and maintenance of the existing system is estimated at $145,300,000 over the same period.\n" +
  "Table 5-3. Constrained Project List. Riverside Parkway Extension    cost not yet estimated    Phase 0";

/** A second page, with a performance measure and a period definition. */
const PAGE_204 =
  "Performance Measure PM-1: Number of fatalities on all public roads. " +
  "The regional baseline is 3 fatalities per year (2022) and the plan sets a target of 0 by 2040. " +
  "Source: Statewide Integrated Traffic Records System. " +
  "The Near-Term period runs from 2023 through 2032 and is escalated to 2028 dollars.";

const PASSAGES: ExtractionPassage[] = [
  { chunkId: CHUNK_A, page: 112, content: PAGE_112 },
  { chunkId: CHUNK_B, page: 204, content: PAGE_204 },
];

const BANDS = [
  { id: BAND_NEAR, label: "Near-Term" },
  { id: BAND_FAR, label: "Long-Term" },
];

function candidate(overrides: Partial<RawExtractionCandidate>): RawExtractionCandidate {
  return {
    target_kind: null,
    fields: {},
    source_chunk_id: CHUNK_A,
    page: 112,
    quote: "",
    ...overrides,
  };
}

/** The honest revenue line the page really contains — the control. */
const TRUE_REVENUE_LINE = candidate({
  target_kind: "financial_line",
  fields: {
    entryKind: "revenue",
    sourceName: "Local Transportation Sales Tax Measure R",
    amount: 412000000,
    amountBasisYear: 2024,
  },
  quote: "Local Transportation Sales Tax Measure R    $412,000,000    (2024 dollars)",
});

function verifyFinancial(candidates: RawExtractionCandidate[]) {
  return verifyExtractionCandidates({
    targetKind: "financial_line",
    candidates,
    passages: PASSAGES,
    bands: BANDS,
  });
}

describe("the verifier accepts a genuine transcription", () => {
  it("stages the revenue line the page actually prints, with the page from the passage", () => {
    const { accepted, discarded } = verifyFinancial([TRUE_REVENUE_LINE]);

    expect(discarded).toEqual([]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].proposedJson).toMatchObject({
      entryKind: "revenue",
      sourceName: "Local Transportation Sales Tax Measure R",
      amount: 412000000,
      amountBasisYear: 2024,
    });
    expect(accepted[0].page).toBe(112);
    expect(accepted[0].quoteVerified).toBe(true);
  });

  it("matches a figure the plan writes with a magnitude word against the whole-dollar value", () => {
    // "$88.4 million" and 88400000 are the same money. The repo's one numeric
    // normaliser knows that; a naive substring check would not, and this lane
    // would then discard most of every plan's revenue table.
    const { accepted, discarded } = verifyFinancial([
      candidate({
        fields: {
          entryKind: "revenue",
          sourceName: "State Highway Operation and Protection Program",
          amount: 88400000,
        },
        quote: "State Highway Operation and Protection Program    $88.4 million",
      }),
    ]);

    expect(discarded).toEqual([]);
    expect(accepted[0].proposedJson.amount).toBe(88400000);
  });

  it("does not let a fabricated MAGNITUDE collide on the mantissa", () => {
    // "$88.4 million" must not license $88.4 BILLION. This is the property the
    // magnitude normaliser was written for, and it is worth an assertion here
    // because a thousandfold error on a revenue line flips a plan's fiscal
    // verdict and reads as a typo nobody made.
    const { accepted, discarded } = verifyFinancial([
      candidate({
        fields: {
          entryKind: "revenue",
          sourceName: "State Highway Operation and Protection Program",
          amount: 88400000000,
        },
        quote: "State Highway Operation and Protection Program    $88.4 million",
      }),
    ]);

    expect(accepted).toEqual([]);
    expect(discarded[0].reason).toBe("figure_not_in_quote");
  });
});

describe("a hallucinated figure produces zero rows", () => {
  it("discards a candidate whose amount is not in its own quote", () => {
    const { accepted, discarded } = verifyFinancial([
      candidate({
        fields: {
          entryKind: "revenue",
          sourceName: "Local Transportation Sales Tax Measure R",
          // The page says 412,000,000. Two digits transposed.
          amount: 421000000,
        },
        quote: "Local Transportation Sales Tax Measure R    $412,000,000    (2024 dollars)",
      }),
    ]);

    expect(accepted).toEqual([]);
    expect(discarded).toEqual([
      { targetKind: "financial_line", reason: "figure_not_in_quote", field: "amount", chunkId: CHUNK_A },
    ]);
  });

  it("discards the WHOLE candidate when one field is wrong, never a repaired remainder", () => {
    // The amount is right and the basis year is invented. Keeping the row
    // without the year would hand a planner a record that looks transcribed and
    // is missing the thing they were told it had.
    const { accepted, discarded } = verifyFinancial([
      candidate({
        fields: {
          entryKind: "revenue",
          sourceName: "Local Transportation Sales Tax Measure R",
          amount: 412000000,
          amountBasisYear: 2019,
        },
        quote: "Local Transportation Sales Tax Measure R    $412,000,000    (2024 dollars)",
      }),
    ]);

    expect(accepted).toEqual([]);
    expect(discarded[0]).toMatchObject({ reason: "figure_not_in_quote", field: "amountBasisYear" });
  });

  it("discards a SMALL integer that is not in the quote (the belt narrative uses would miss it)", () => {
    // `extractHardClaims` deliberately ignores bare small integers so grant
    // prose is not swamped by "3 lanes". A performance baseline of 3 is exactly
    // such an integer, and it is a measurement of the world. `numericCoresIn`
    // is used here instead precisely so this case is caught.
    const { accepted, discarded } = verifyExtractionCandidates({
      targetKind: "performance_measure",
      candidates: [
        candidate({
          source_chunk_id: CHUNK_B,
          page: 204,
          fields: { label: "Number of fatalities on all public roads", baselineValue: 7 },
          quote:
            "Performance Measure PM-1: Number of fatalities on all public roads. The regional baseline is 3 fatalities per year (2022)",
        }),
      ],
      passages: PASSAGES,
    });

    expect(accepted).toEqual([]);
    expect(discarded[0]).toMatchObject({ reason: "figure_not_in_quote", field: "baselineValue" });
  });

  it("accepts that same small integer when the quote does contain it", () => {
    // The negative control for the test above: without this, a verifier that
    // rejected every baseline would pass the previous assertion too.
    const { accepted } = verifyExtractionCandidates({
      targetKind: "performance_measure",
      candidates: [
        candidate({
          source_chunk_id: CHUNK_B,
          page: 204,
          fields: { label: "Number of fatalities on all public roads", baselineValue: 3, baselineYear: 2022 },
          quote:
            "Performance Measure PM-1: Number of fatalities on all public roads. The regional baseline is 3 fatalities per year (2022)",
        }),
      ],
      passages: PASSAGES,
    });

    expect(accepted).toHaveLength(1);
    expect(accepted[0].proposedJson).toMatchObject({ baselineValue: 3, baselineYear: 2022 });
  });
});

describe("a fabricated NAME is as dangerous as a fabricated figure", () => {
  it("discards a candidate whose source name is not in the text it quoted", () => {
    // The amount is right. The programme it is attributed to is invented, which
    // puts real money against a funding source that does not exist — and on a
    // fiscal-constraint check the total still balances, so nothing downstream
    // looks wrong.
    const { accepted, discarded } = verifyFinancial([
      candidate({
        fields: {
          entryKind: "revenue",
          sourceName: "Regional Transportation Impact Fee",
          amount: 412000000,
        },
        quote: "Local Transportation Sales Tax Measure R    $412,000,000    (2024 dollars)",
      }),
    ]);

    expect(accepted).toEqual([]);
    expect(discarded[0]).toMatchObject({ reason: "text_not_in_quote", field: "sourceName" });
  });

  it("discards a data source the plan does not credit", () => {
    const { accepted, discarded } = verifyExtractionCandidates({
      targetKind: "performance_measure",
      candidates: [
        candidate({
          source_chunk_id: CHUNK_B,
          page: 204,
          fields: {
            label: "Number of fatalities on all public roads",
            dataSource: "National Household Travel Survey",
          },
          quote: "Performance Measure PM-1: Number of fatalities on all public roads.",
        }),
      ],
      passages: PASSAGES,
    });

    expect(accepted).toEqual([]);
    expect(discarded[0]).toMatchObject({ reason: "text_not_in_quote", field: "dataSource" });
  });

  it("accepts the source name the page really prints", () => {
    // Negative control: a verifier that rejected every text field would pass
    // both assertions above.
    const { accepted } = verifyFinancial([TRUE_REVENUE_LINE]);
    expect(accepted).toHaveLength(1);
  });
});

describe("a quote that is not in the passage is not a quote", () => {
  it("discards a fabricated quote", () => {
    const { accepted, discarded } = verifyFinancial([
      candidate({
        fields: { entryKind: "revenue", sourceName: "Federal Formula Funds", amount: 412000000 },
        quote: "Federal Formula Funds    $412,000,000",
      }),
    ]);

    expect(accepted).toEqual([]);
    expect(discarded[0].reason).toBe("quote_not_in_passage");
  });

  it("forgives only WHITESPACE, and does so on both sides", () => {
    // A PDF's text layer is full of runs of spaces and non-breaking spaces that
    // no model retypes identically. Normalising both sides cannot admit
    // characters the passage does not have — it can only forgive how they were
    // spaced — which is why the same function runs on the passage and the quote.
    const { accepted } = verifyFinancial([
      candidate({
        fields: { entryKind: "revenue", sourceName: "Local Transportation Sales Tax Measure R", amount: 412000000 },
        quote: "Local Transportation Sales Tax Measure R   $412,000,000\n(2024 dollars)",
      }),
    ]);

    expect(accepted).toHaveLength(1);
  });

  it("does not forgive CASE — a recased quote is not a copy", () => {
    const { accepted, discarded } = verifyFinancial([
      candidate({
        fields: { entryKind: "revenue", sourceName: "local transportation sales tax measure r", amount: 412000000 },
        quote: "local transportation sales tax measure r    $412,000,000    (2024 dollars)",
      }),
    ]);

    expect(accepted).toEqual([]);
    expect(discarded[0].reason).toBe("quote_not_in_passage");
  });

  it("discards a candidate citing a passage that was not in the batch", () => {
    const { accepted, discarded } = verifyExtractionCandidates({
      targetKind: "financial_line",
      candidates: [TRUE_REVENUE_LINE],
      passages: [PASSAGES[1]],
      bands: BANDS,
    });

    expect(accepted).toEqual([]);
    expect(discarded[0]).toMatchObject({ reason: "unknown_passage", chunkId: CHUNK_A });
  });

  it("discards an empty quote outright", () => {
    const { accepted, discarded } = verifyFinancial([
      candidate({ fields: { entryKind: "revenue", sourceName: "x", amount: 1 }, quote: "   " }),
    ]);

    expect(accepted).toEqual([]);
    expect(discarded[0].reason).toBe("empty_quote");
  });
});

describe("the model's page can never override the passage's", () => {
  it("stores the passage's page and records the model's disagreement as an audit note", () => {
    const { accepted } = verifyFinancial([{ ...TRUE_REVENUE_LINE, page: 999 }]);

    expect(accepted[0].page).toBe(112);
    expect(accepted[0].modelPageMismatch).toBe(true);
  });

  it("is not merely agreeing with the model when the two match", () => {
    // The negative control. A verifier that copied `candidate.page` straight
    // through would pass the assertion above only if it also flipped the flag —
    // this pair is what tells "took the passage's page" from "took the model's".
    const { accepted } = verifyFinancial([{ ...TRUE_REVENUE_LINE, page: 112 }]);

    expect(accepted[0].page).toBe(112);
    expect(accepted[0].modelPageMismatch).toBe(false);
  });

  it("takes the page from whichever passage was cited, not from the first one", () => {
    const { accepted } = verifyExtractionCandidates({
      targetKind: "performance_measure",
      candidates: [
        candidate({
          source_chunk_id: CHUNK_B,
          page: 112,
          fields: { label: "Number of fatalities on all public roads" },
          quote: "Performance Measure PM-1: Number of fatalities on all public roads.",
        }),
      ],
      passages: PASSAGES,
    });

    expect(accepted[0].page).toBe(204);
  });
});

describe("nothing the model produced may be an identifier or an unknown field", () => {
  it("discards a candidate carrying a uuid", () => {
    const { accepted, discarded } = verifyFinancial([
      candidate({
        fields: {
          entryKind: "revenue",
          sourceName: "Local Transportation Sales Tax Measure R",
          amount: 412000000,
          horizonBandLabel: BAND_NEAR,
        },
        quote: "Local Transportation Sales Tax Measure R    $412,000,000    (2024 dollars)",
      }),
    ]);

    expect(accepted).toEqual([]);
    expect(discarded[0].reason).toBe("identifier_in_payload");
  });

  it("discards a candidate carrying a field this target kind does not have", () => {
    const { accepted, discarded } = verifyFinancial([
      candidate({
        fields: {
          entryKind: "revenue",
          sourceName: "Local Transportation Sales Tax Measure R",
          amount: 412000000,
          confidence: 0.94,
        },
        quote: "Local Transportation Sales Tax Measure R    $412,000,000    (2024 dollars)",
      }),
    ]);

    expect(accepted).toEqual([]);
    expect(discarded[0]).toMatchObject({ reason: "unknown_field", field: "confidence" });
  });

  it("discards a candidate missing a field the record cannot do without", () => {
    const { accepted, discarded } = verifyFinancial([
      candidate({
        fields: { entryKind: "revenue", amount: 412000000 },
        quote: "Local Transportation Sales Tax Measure R    $412,000,000    (2024 dollars)",
      }),
    ]);

    expect(accepted).toEqual([]);
    expect(discarded[0]).toMatchObject({ reason: "missing_required_field", field: "sourceName" });
  });

  it("discards a classification OpenPlan does not have", () => {
    const { accepted, discarded } = verifyFinancial([
      candidate({
        fields: {
          entryKind: "capital_cost",
          sourceName: "Local Transportation Sales Tax Measure R",
          amount: 412000000,
        },
        quote: "Local Transportation Sales Tax Measure R    $412,000,000    (2024 dollars)",
      }),
    ]);

    expect(accepted).toEqual([]);
    expect(discarded[0]).toMatchObject({ reason: "unknown_classification", field: "entryKind" });
  });
});

describe("unpriced is not zero", () => {
  it("refuses a zero cost even when the quoted page happens to contain a zero", () => {
    // 20260805000003: "NULL means UNPRICED, which is a distinct answer from zero
    // and must stay one all the way to the constraint check." The numeric rule
    // alone would pass this, because the quoted sentence really does contain a
    // "0" — which is why the zero rule exists beside it.
    const { accepted, discarded } = verifyExtractionCandidates({
      targetKind: "programmed_project",
      candidates: [
        candidate({
          fields: { projectName: "Riverside Parkway Extension", estimatedCost: 0 },
          quote: "Riverside Parkway Extension    cost not yet estimated    Phase 0",
        }),
      ],
      passages: PASSAGES,
    });

    expect(accepted).toEqual([]);
    expect(discarded[0]).toMatchObject({ reason: "zero_is_not_unpriced", field: "estimatedCost" });
  });
});

describe("a band is resolved from the plan's own rows, never guessed", () => {
  it("resolves an exactly-matching label to the cycle's band id", () => {
    const { accepted } = verifyExtractionCandidates({
      targetKind: "financial_line",
      candidates: [
        candidate({
          source_chunk_id: CHUNK_B,
          page: 204,
          fields: {
            entryKind: "revenue",
            sourceName: "Near-Term",
            amount: 2032,
            horizonBandLabel: "Near-Term",
          },
          quote: "The Near-Term period runs from 2023 through 2032",
        }),
      ],
      passages: PASSAGES,
      bands: BANDS,
    });

    expect(accepted[0].proposedJson.horizonBandId).toBe(BAND_NEAR);
    expect(accepted[0].horizonBandUnresolved).toBe(false);
  });

  it("leaves the band UNSET when the quoted label matches none of the plan's periods", () => {
    // A guessed band sets an escalation exponent, so an unmatched label stages
    // for a person to pick rather than being resolved to the nearest thing.
    const { accepted } = verifyExtractionCandidates({
      targetKind: "financial_line",
      candidates: [
        candidate({
          source_chunk_id: CHUNK_B,
          page: 204,
          fields: {
            entryKind: "revenue",
            sourceName: "Near-Term",
            amount: 2032,
            horizonBandLabel: "Near-Term",
          },
          quote: "The Near-Term period runs from 2023 through 2032",
        }),
      ],
      passages: PASSAGES,
      bands: [{ id: BAND_FAR, label: "Long-Term" }],
    });

    expect(accepted[0].proposedJson.horizonBandId).toBeUndefined();
    expect(accepted[0].horizonBandUnresolved).toBe(true);
  });

  it("leaves the band UNSET when two of the plan's periods share the label", () => {
    const { accepted } = verifyExtractionCandidates({
      targetKind: "financial_line",
      candidates: [
        candidate({
          source_chunk_id: CHUNK_B,
          page: 204,
          fields: {
            entryKind: "revenue",
            sourceName: "Near-Term",
            amount: 2032,
            horizonBandLabel: "Near-Term",
          },
          quote: "The Near-Term period runs from 2023 through 2032",
        }),
      ],
      passages: PASSAGES,
      bands: [
        { id: BAND_NEAR, label: "Near-Term" },
        { id: BAND_FAR, label: "Near-Term " },
      ],
    });

    expect(accepted[0].proposedJson.horizonBandId).toBeUndefined();
    expect(accepted[0].horizonBandUnresolved).toBe(true);
  });
});

describe("a chapter block is a copy or it is nothing", () => {
  it("accepts text identical to its quote", () => {
    const { accepted } = verifyExtractionCandidates({
      targetKind: "chapter_block",
      candidates: [
        candidate({
          source_chunk_id: CHUNK_B,
          page: 204,
          fields: { text: "Performance Measure PM-1: Number of fatalities on all public roads." },
          quote: "Performance Measure PM-1: Number of fatalities on all public roads.",
        }),
      ],
      passages: PASSAGES,
    });

    expect(accepted).toHaveLength(1);
  });

  it("discards text that summarises its quote instead of copying it", () => {
    const { accepted, discarded } = verifyExtractionCandidates({
      targetKind: "chapter_block",
      candidates: [
        candidate({
          source_chunk_id: CHUNK_B,
          page: 204,
          fields: { text: "PM-1 counts road fatalities." },
          quote: "Performance Measure PM-1: Number of fatalities on all public roads.",
        }),
      ],
      passages: PASSAGES,
    });

    expect(accepted).toEqual([]);
    expect(discarded[0]).toMatchObject({ reason: "not_a_verbatim_copy", field: "text" });
  });
});

describe("only a passage that names one page may be cited", () => {
  const chunk = (overrides: Partial<ExtractionChunkRow>): ExtractionChunkRow => ({
    id: CHUNK_A,
    chunk_index: 0,
    page_from: 112,
    page_to: 112,
    content: PAGE_112,
    ...overrides,
  });

  it("keeps a single-page passage", () => {
    const { passages, excluded } = buildExtractionPassages([chunk({})]);
    expect(excluded).toEqual([]);
    expect(passages).toEqual([{ chunkId: CHUNK_A, page: 112, content: PAGE_112.trim() }]);
  });

  it("excludes a passage that runs across a page break, and says which", () => {
    // Citing page_from for a figure printed on page_to would put a wrong page
    // number on a provenance chip — on the public plan page and in the board
    // export body. A disclosed gap beats an undetectable off-by-one.
    const { passages, excluded } = buildExtractionPassages([chunk({ page_to: 113 })]);
    expect(passages).toEqual([]);
    expect(excluded).toEqual([{ chunkId: CHUNK_A, reason: "spans_pages" }]);
  });

  it("excludes a passage with no page at all", () => {
    const { passages, excluded } = buildExtractionPassages([chunk({ page_from: null, page_to: null })]);
    expect(passages).toEqual([]);
    expect(excluded).toEqual([{ chunkId: CHUNK_A, reason: "no_page" }]);
  });

  it("treats a null page_to as the same single page, not as a span", () => {
    const { passages } = buildExtractionPassages([chunk({ page_to: null })]);
    expect(passages).toHaveLength(1);
    expect(passages[0].page).toBe(112);
  });

  it("excludes an empty passage", () => {
    const { passages, excluded } = buildExtractionPassages([chunk({ content: "   " })]);
    expect(passages).toEqual([]);
    expect(excluded).toEqual([{ chunkId: CHUNK_A, reason: "empty_content" }]);
  });
});

describe("discards are counted and every reason has words a planner can read", () => {
  it("groups discards by reason", () => {
    const { discarded } = verifyFinancial([
      candidate({
        fields: { entryKind: "revenue", sourceName: "Local Transportation Sales Tax Measure R", amount: 1 },
        quote: "Local Transportation Sales Tax Measure R    $412,000,000    (2024 dollars)",
      }),
      candidate({ fields: { entryKind: "revenue", sourceName: "x", amount: 1 }, quote: "not in the page" }),
      candidate({
        fields: { entryKind: "revenue", sourceName: "Local Transportation Sales Tax Measure R", amount: 2 },
        quote: "Local Transportation Sales Tax Measure R    $412,000,000    (2024 dollars)",
      }),
    ]);

    expect(countDiscardsByReason(discarded)).toEqual({
      figure_not_in_quote: 2,
      quote_not_in_passage: 1,
    });
  });

  it("has a sentence for every reason, and none of them scores the model", () => {
    // A "confidence" or "likelihood" word anywhere in this vocabulary would be
    // the machine grading itself, which this feature does not do.
    const sentences = Object.values(RTP_EXTRACTION_DISCARD_SENTENCES);
    expect(sentences.length).toBeGreaterThan(10);
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/confiden|certain|likelihood|probab|accuracy score/i);
      expect(sentence.trim()).not.toBe("");
    }
  });
});

describe("normalisation is symmetric", () => {
  it("collapses every kind of whitespace to one space", () => {
    expect(normalizeForQuoteMatch("a  \t\n b")).toBe("a b");
  });

  it("does not lower-case", () => {
    expect(normalizeForQuoteMatch("Measure R")).toBe("Measure R");
  });
});

describe("every target kind is checkable", () => {
  it("declares at least one field, and no field is silently uncheckable", () => {
    for (const spec of Object.values(RTP_EXTRACTION_TARGETS)) {
      expect(spec.fields.length).toBeGreaterThan(0);
      for (const field of spec.fields) {
        if (field.kind === "classification") {
          expect(field.enumValues?.length ?? 0).toBeGreaterThan(0);
        }
      }
    }
  });
});

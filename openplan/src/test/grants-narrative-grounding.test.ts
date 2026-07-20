import { describe, expect, it } from "vitest";

import { validateGroundedNarrative } from "@/lib/planner-pack/grounding";
import {
  buildNarrativeFactList,
  factClaimTextMap,
  isNarrativeExportable,
  listFlaggedNarrativeSentences,
  parseStoredNarrativeGrounding,
  renderNarrativeFactPromptLines,
  stripFactCitationTokens,
  summarizeNarrativeGrounding,
} from "@/lib/grants/narrative-grounding";

describe("buildNarrativeFactList", () => {
  it("assigns sequential fact_1..fact_N ids and skips blank claims", () => {
    const facts = buildNarrativeFactList([
      "Funding need: $2,000,000.",
      null,
      "   ",
      undefined,
      "Committed award dollars: $500,000 across 1 award record(s)",
    ]);

    expect(facts).toEqual([
      { fact_id: "fact_1", claim_text: "Funding need: $2,000,000." },
      { fact_id: "fact_2", claim_text: "Committed award dollars: $500,000 across 1 award record(s)" },
    ]);
  });

  it("trims claim text", () => {
    const facts = buildNarrativeFactList(["  padded claim  "]);
    expect(facts[0].claim_text).toBe("padded claim");
  });
});

describe("renderNarrativeFactPromptLines", () => {
  it("renders one [fact:N] line per fact", () => {
    const lines = renderNarrativeFactPromptLines(
      buildNarrativeFactList(["Claim one.", "Claim two."])
    );

    expect(lines).toEqual(["[fact:fact_1] Claim one.", "[fact:fact_2] Claim two."]);
  });
});

describe("stripFactCitationTokens", () => {
  it("removes trailing citation tokens without leaving dangling whitespace", () => {
    expect(stripFactCitationTokens("The project has a documented need. [fact:fact_3]")).toBe(
      "The project has a documented need."
    );
  });

  it("removes multiple tokens in a sentence", () => {
    expect(
      stripFactCitationTokens("Both postures are recorded. [fact:fact_1] [fact:fact_2] Next sentence.")
    ).toBe("Both postures are recorded. Next sentence.");
  });

  it("removes mid-sentence tokens and tightens punctuation spacing", () => {
    expect(stripFactCitationTokens("Need is $2M [fact:fact_1], and match is covered.")).toBe(
      "Need is $2M, and match is covered."
    );
  });

  it("keeps markdown paragraph breaks intact", () => {
    const stripped = stripFactCitationTokens(
      "Paragraph one. [fact:fact_1]\n\nParagraph two. [fact:fact_2]"
    );
    expect(stripped).toBe("Paragraph one.\n\nParagraph two.");
  });

  it("removes tokens with unknown ids too (display never shows tokens)", () => {
    expect(stripFactCitationTokens("Claimed anyway. [fact:ghost-9]")).toBe("Claimed anyway.");
  });

  it("leaves token-free text untouched", () => {
    expect(stripFactCitationTokens("Plain prose stays as-is.")).toBe("Plain prose stays as-is.");
  });
});

describe("summarizeNarrativeGrounding", () => {
  const facts = buildNarrativeFactList(["Need is $2M.", "Match is covered."]);
  const factIds = facts.map((fact) => fact.fact_id);

  it("summarizes a fully grounded narrative", () => {
    const validated = validateGroundedNarrative(
      "Need is documented. [fact:fact_1] Match posture is covered. [fact:fact_2]",
      factIds,
      "annotated"
    );
    const summary = summarizeNarrativeGrounding(validated, facts);

    expect(summary.mode).toBe("annotated");
    expect(summary.grounded_sentence_count).toBe(2);
    expect(summary.total_sentence_count).toBe(2);
    expect(summary.is_fully_grounded).toBe(true);
    expect(summary.cited_fact_ids).toEqual(["fact_1", "fact_2"]);
    expect(summary.unknown_fact_ids).toEqual([]);
    expect(summary.dropped_sentences).toEqual([]);
    expect(summary.facts).toEqual(facts);
  });

  it("summarizes a partially grounded narrative with unknown ids", () => {
    const validated = validateGroundedNarrative(
      "Need is documented. [fact:fact_1] This sentence is uncited. Ghost claim. [fact:fact_99]",
      factIds,
      "annotated"
    );
    const summary = summarizeNarrativeGrounding(validated, facts);

    expect(summary.grounded_sentence_count).toBe(1);
    expect(summary.total_sentence_count).toBe(3);
    expect(summary.is_fully_grounded).toBe(false);
    expect(summary.unknown_fact_ids).toEqual(["fact_99"]);
    // Annotated mode keeps every sentence.
    expect(summary.sentences).toHaveLength(3);
    expect(summary.dropped_sentences).toEqual([]);
  });
});

describe("parseStoredNarrativeGrounding + listFlaggedNarrativeSentences", () => {
  const facts = buildNarrativeFactList(["Need is $2M."]);

  it("round-trips a summarized grounding through JSON", () => {
    const validated = validateGroundedNarrative(
      "Need is documented. [fact:fact_1] Uncited filler.",
      ["fact_1"],
      "annotated"
    );
    const summary = summarizeNarrativeGrounding(validated, facts);
    const parsed = parseStoredNarrativeGrounding(JSON.parse(JSON.stringify(summary)));

    expect(parsed).toEqual(summary);
  });

  it("returns null for null, non-objects, and malformed payloads", () => {
    expect(parseStoredNarrativeGrounding(null)).toBeNull();
    expect(parseStoredNarrativeGrounding("annotated")).toBeNull();
    expect(parseStoredNarrativeGrounding({ mode: "strict", sentences: [] })).toBeNull();
    expect(parseStoredNarrativeGrounding({ mode: "annotated" })).toBeNull();
    expect(
      parseStoredNarrativeGrounding({ mode: "annotated", sentences: [{ text: 42 }] })
    ).toBeNull();
  });

  it("lists uncited and unknown-citation sentences with reasons", () => {
    const validated = validateGroundedNarrative(
      "Need is documented. [fact:fact_1] Uncited filler. Ghost claim. [fact:fact_9]",
      ["fact_1"],
      "annotated"
    );
    const summary = summarizeNarrativeGrounding(validated, facts);
    const flagged = listFlaggedNarrativeSentences(summary);

    expect(flagged).toEqual([
      { text: "Uncited filler.", reason: "missing_citation", unknown_fact_ids: [], unfaithful_claims: [] },
      {
        text: "Ghost claim. [fact:fact_9]",
        reason: "unknown_fact_id",
        unknown_fact_ids: ["fact_9"],
        unfaithful_claims: [],
      },
    ]);
  });

  it("flags a sentence that cites a valid fact but asserts an unsupported figure", () => {
    // fact_1 claim text is "Need is $2M."; the sentence cites it but says $5M.
    const validated = validateGroundedNarrative(
      "Need is $5M. [fact:fact_1]",
      ["fact_1"],
      "annotated",
      factClaimTextMap(facts)
    );
    const summary = summarizeNarrativeGrounding(validated, facts);

    expect(summary.is_fully_grounded).toBe(false);
    expect(summary.faithfulness_checked).toBe(true);
    expect(isNarrativeExportable(summary)).toBe(false);
    expect(listFlaggedNarrativeSentences(summary)).toEqual([
      {
        text: "Need is $5M. [fact:fact_1]",
        reason: "unfaithful_citation",
        unknown_fact_ids: [],
        unfaithful_claims: ["5000000"],
      },
    ]);
  });

  it("parses a legacy pre-belt row: sentences default unfaithful_claims, gate stays closed", () => {
    // Shape persisted before the faithfulness belt existed: no
    // unfaithful_claims on sentences, no faithfulness_checked on the summary.
    const legacy = {
      mode: "annotated",
      facts: [{ fact_id: "fact_1", claim_text: "Need is $2M." }],
      sentences: [
        {
          text: "The project unlocks $12.5 million. [fact:fact_1]",
          cited_fact_ids: ["fact_1"],
          is_grounded: true,
          unknown_fact_ids: [],
        },
      ],
      dropped_sentences: [],
      cited_fact_ids: ["fact_1"],
      unknown_fact_ids: [],
      grounded_sentence_count: 1,
      total_sentence_count: 1,
      is_fully_grounded: true,
    };

    const parsed = parseStoredNarrativeGrounding(legacy);
    expect(parsed).not.toBeNull();
    expect(parsed?.sentences[0]?.unfaithful_claims).toEqual([]);
    expect(parsed?.faithfulness_checked).toBe(false);
    // A citation-only pass from before the belt must never read as faithful.
    expect(isNarrativeExportable(parsed!)).toBe(false);
  });

  it("exportable only when fully grounded AND the belt actually ran", () => {
    const validated = validateGroundedNarrative(
      "Need is documented. [fact:fact_1]",
      ["fact_1"],
      "annotated",
      factClaimTextMap(facts)
    );
    const withBelt = summarizeNarrativeGrounding(validated, facts);
    expect(isNarrativeExportable(withBelt)).toBe(true);

    const withoutBelt = summarizeNarrativeGrounding(
      validateGroundedNarrative("Need is documented. [fact:fact_1]", ["fact_1"], "annotated"),
      facts
    );
    expect(withoutBelt.is_fully_grounded).toBe(true);
    expect(isNarrativeExportable(withoutBelt)).toBe(false);
  });
});

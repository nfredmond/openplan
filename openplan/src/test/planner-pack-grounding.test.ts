import { describe, expect, it } from "vitest";

import {
  extractHardClaims,
  GROUNDING_ANNOTATION_PREFIX,
  splitSentences,
  validateGroundedNarrative,
} from "@/lib/planner-pack/grounding";

// Ported from clawmodeler tests/test_grounding.py. The TypeScript port was
// additionally differential-tested against the Python module across strict
// and annotated modes (identical text, sentences, cited/unknown ids, issue
// kinds and details).

describe("strict mode", () => {
  it("drops sentences with no citation", () => {
    const out = validateGroundedNarrative("VMT drops. [fact:vmt_s1] Access improves.", ["vmt_s1"], "strict");

    expect(out.isFullyGrounded).toBe(false);
    expect(out.verdict).toBe("block");
    expect(out.ungroundedSentenceCount).toBe(1);
    expect(out.text).toContain("VMT drops.");
    expect(out.text).not.toContain("Access improves.");
    expect(out.droppedSentences.map((sentence) => sentence.text)).toEqual(["Access improves."]);
  });

  it("rejects unknown fact ids", () => {
    const out = validateGroundedNarrative(
      "VMT drops. [fact:vmt_s1] Access improves. [fact:not_real]",
      ["vmt_s1"],
      "strict"
    );

    expect(out.unknownFactIds).toEqual(["not_real"]);
    expect(out.ungroundedSentenceCount).toBe(1);
    expect(out.text).not.toContain("Access improves.");
  });

  it("keeps a multi-citation sentence when all ids are known", () => {
    const out = validateGroundedNarrative(
      "Both effects land in the corridor. [fact:vmt_s1] [fact:access_s2]",
      ["vmt_s1", "access_s2"],
      "strict"
    );

    expect(out.isFullyGrounded).toBe(true);
    expect(out.verdict).toBe("pass");
    expect(out.ungroundedSentenceCount).toBe(0);
    expect(out.text).toContain("Both effects land in the corridor.");
  });

  it("flags a multi-citation sentence when any id is unknown", () => {
    const out = validateGroundedNarrative(
      "Both effects land in the corridor. [fact:vmt_s1] [fact:ghost]",
      ["vmt_s1"],
      "strict"
    );

    expect(out.isFullyGrounded).toBe(false);
    expect(out.unknownFactIds).toEqual(["ghost"]);
    expect(out.text).not.toContain("corridor");
  });
});

describe("annotated mode", () => {
  it("keeps ungrounded sentences with a warning prefix", () => {
    const out = validateGroundedNarrative(
      "VMT drops. [fact:vmt_s1] Access improves.",
      ["vmt_s1"],
      "annotated"
    );

    expect(out.isFullyGrounded).toBe(false);
    expect(out.verdict).toBe("block");
    expect(out.ungroundedSentenceCount).toBe(1);
    expect(out.text).toContain("VMT drops.");
    expect(out.text).toContain(`${GROUNDING_ANNOTATION_PREFIX}Access improves.`);
    expect(out.droppedSentences).toEqual([]);
  });
});

describe("structural line handling", () => {
  it("does not require headings, rules, fences, blockquotes, or tables to cite", () => {
    const text = [
      "## Key Findings",
      "---",
      "```python",
      "no_citation_needed()",
      "```",
      "> blockquote intro",
      "| col | col |",
      "- Scenario 1 cuts VMT by 6.4%. [fact:vmt_s1]",
    ].join("\n");

    const out = validateGroundedNarrative(text, ["vmt_s1"], "strict");

    expect(out.isFullyGrounded).toBe(true);
    expect(out.ungroundedSentenceCount).toBe(0);
  });

  it("strips bullet and numbered-list markers", () => {
    const text = ["- first claim.", "1. second claim.", "2) third claim."].join("\n");
    expect(splitSentences(text)).toEqual(["first claim.", "second claim.", "third claim."]);
  });
});

describe("trailing citation regression", () => {
  // Regression ported from Python: trailing `. [fact:xxx]` used to be split
  // off as its own sentence, stripping the claim of its anchor. The fix
  // merges citation-only fragments into the preceding sentence.
  it("keeps a trailing citation attached to its claim sentence", () => {
    const text =
      "- Scenario 1 cuts VMT per capita by 6.4%. [fact:vmt_s1]\n" +
      "- Access in scenario 2 rises 12%. [fact:access_s2]\n";

    const out = validateGroundedNarrative(text, ["vmt_s1", "access_s2"], "strict");

    expect(out.isFullyGrounded).toBe(true);
    expect(out.sentences).toHaveLength(2);
    expect(out.sentences[0].text).toContain("Scenario 1 cuts VMT");
    expect(out.sentences[0].text).toContain("[fact:vmt_s1]");
    expect(out.sentences[1].text).toContain("Access in scenario 2");
    expect(out.sentences[1].text).toContain("[fact:access_s2]");
  });
});

describe("output shape", () => {
  it("keeps cited and unknown fact ids unique and in first-seen order", () => {
    const out = validateGroundedNarrative(
      "one [fact:a]. two [fact:b]. three [fact:a]. four [fact:x]. five [fact:x].",
      ["a", "b"],
      "annotated"
    );

    expect(out.citedFactIds).toEqual(["a", "b", "x"]);
    expect(out.unknownFactIds).toEqual(["x"]);
  });

  it("treats empty input as fully grounded", () => {
    const out = validateGroundedNarrative("", ["a"], "strict");
    expect(out.isFullyGrounded).toBe(true);
    expect(out.verdict).toBe("pass");
    expect(out.text).toBe("");
    expect(out.sentences).toEqual([]);
  });

  // JS-specific: issue records mirror the Python GroundingIssue kinds/details.
  it("records missing-citation and unknown-fact-id issues", () => {
    const out = validateGroundedNarrative(
      "No citation here. Ghost claim. [fact:ghost]",
      ["a"],
      "strict"
    );

    expect(out.issues).toEqual([
      {
        kind: "missing_citation",
        detail: "sentence has no [fact:*] citation",
        sentence: "No citation here.",
      },
      {
        kind: "unknown_fact_id",
        detail: "unknown fact_ids: ['ghost']",
        sentence: "Ghost claim. [fact:ghost]",
      },
    ]);
  });
});

// JS-specific edge cases beyond the Python suite.
describe("citation token matching", () => {
  it("defaults to strict mode", () => {
    const out = validateGroundedNarrative("Uncited claim.", ["a"]);
    expect(out.text).toBe("");
    expect(out.verdict).toBe("block");
  });

  it("is case-sensitive on fact ids", () => {
    const out = validateGroundedNarrative("Claim here. [fact:B]", ["b"], "strict");
    expect(out.unknownFactIds).toEqual(["B"]);
    expect(out.verdict).toBe("block");
  });

  it("accepts dots, dashes, and underscores after an alphanumeric start", () => {
    const out = validateGroundedNarrative("Claim here. [fact:a.b-c_d]", ["a.b-c_d"], "strict");
    expect(out.isFullyGrounded).toBe(true);
  });

  it("ignores malformed tokens that start with punctuation", () => {
    const out = validateGroundedNarrative("Claim here. [fact:-bad]", ["-bad"], "strict");
    expect(out.citedFactIds).toEqual([]);
    expect(out.issues[0]?.kind).toBe("missing_citation");
  });

  it("treats an unterminated code fence as swallowing the rest of the text", () => {
    const out = validateGroundedNarrative("```\ncode line\nstill code", [], "strict");
    expect(out.sentences).toEqual([]);
    expect(out.isFullyGrounded).toBe(true);
  });

  it("splits multiple sentences on one line and keeps per-sentence verdicts", () => {
    const out = validateGroundedNarrative(
      "First sentence stands alone! Second claim? [fact:a] Third here. [fact:a] [fact:b] Done.",
      ["a", "b"],
      "strict"
    );

    expect(out.sentences.map((sentence) => sentence.text)).toEqual([
      "Second claim? [fact:a]",
      "Third here. [fact:a] [fact:b]",
    ]);
    expect(out.droppedSentences.map((sentence) => sentence.text)).toEqual([
      "First sentence stands alone!",
      "Done.",
    ]);
    expect(out.ungroundedSentenceCount).toBe(2);
  });
});

describe("extractHardClaims", () => {
  it("extracts currency, percentages, years and large figures; ignores small integers and citation ids", () => {
    expect(
      extractHardClaims("Costs $4.2M, cuts VMT 6.4%, opens 2027, serves 12,000 people. [fact:vmt_2026]")
    ).toEqual(["4.2", "6.4", "2027", "12000"]);
    expect(extractHardClaims("Adds 3 lanes across 2 phases.")).toEqual([]);
  });
});

describe("numeric faithfulness (opt-in second belt)", () => {
  const facts = new Map([
    ["cost", "The corridor improvement is estimated at $4.2 million over 5 years."],
    ["vmt", "Scenario 1 cuts VMT per capita by 6.4%."],
  ]);

  it("keeps a cited sentence whose figures all appear in its cited fact", () => {
    const out = validateGroundedNarrative(
      "The project costs $4.2 million. [fact:cost]",
      ["cost"],
      "strict",
      facts
    );
    expect(out.isFullyGrounded).toBe(true);
    expect(out.verdict).toBe("pass");
  });

  it("blocks a cited sentence asserting a dollar figure absent from its cited fact", () => {
    const out = validateGroundedNarrative(
      "The project costs $9.9 million. [fact:cost]",
      ["cost"],
      "strict",
      facts
    );
    expect(out.isFullyGrounded).toBe(false);
    expect(out.verdict).toBe("block");
    expect(out.text).not.toContain("9.9");
    expect(out.issues).toEqual([
      {
        kind: "unfaithful_citation",
        detail: "numbers not supported by cited facts: ['9.9']",
        sentence: "The project costs $9.9 million. [fact:cost]",
      },
    ]);
  });

  it("checks only the sentence's OWN cited facts, not every fact", () => {
    // 6.4 exists in the `vmt` fact, but this sentence cites only `cost`.
    const out = validateGroundedNarrative(
      "The project delivers a 6.4% reduction. [fact:cost]",
      ["cost", "vmt"],
      "strict",
      facts
    );
    expect(out.isFullyGrounded).toBe(false);
    expect(out.issues[0]?.kind).toBe("unfaithful_citation");
  });

  it("ignores bare small integers so it doesn't nag on non-figures", () => {
    const out = validateGroundedNarrative(
      "The plan sequences 3 projects across 2 phases. [fact:cost]",
      ["cost"],
      "strict",
      facts
    );
    expect(out.isFullyGrounded).toBe(true);
  });

  it("is backward-compatible: without fact texts, figures are not cross-checked", () => {
    const out = validateGroundedNarrative(
      "The project costs $9.9 million. [fact:cost]",
      ["cost"],
      "strict"
    );
    expect(out.isFullyGrounded).toBe(true);
  });

  it("annotates rather than drops an unfaithful sentence in annotated mode", () => {
    const out = validateGroundedNarrative(
      "The project costs $9.9 million. [fact:cost]",
      ["cost"],
      "annotated",
      facts
    );
    expect(out.text).toContain(`${GROUNDING_ANNOTATION_PREFIX}The project costs $9.9 million.`);
    expect(out.ungroundedSentenceCount).toBe(1);
  });
});

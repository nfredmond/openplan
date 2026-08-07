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
    ).toEqual(["4200000", "6.4", "2027", "12000"]);
    expect(extractHardClaims("Adds 3 lanes across 2 phases.")).toEqual([]);
  });

  it("multiplies out magnitude suffixes so notation variants share one core", () => {
    expect(extractHardClaims("A $4.2 million investment.")).toEqual(["4200000"]);
    expect(extractHardClaims("A $4,200,000 investment.")).toEqual(["4200000"]);
    expect(extractHardClaims("A $4.2B program.")).toEqual(["4200000000"]);
    expect(extractHardClaims("About 12k daily trips.")).toEqual(["12000"]);
    expect(extractHardClaims("Nearly 3 thousand riders.")).toEqual(["3000"]);
  });

  it("treats spelled-out percent and magnitude words as consequential", () => {
    expect(extractHardClaims("Transit use fell 64 percent.")).toEqual(["64"]);
    expect(extractHardClaims("Costs 3 million dollars.")).toEqual(["3000000"]);
  });

  it("does not pick up trailing commas from enumerations as grouping", () => {
    expect(extractHardClaims("Alternatives 1, 2, and 3 each cut delay.")).toEqual([]);
    expect(extractHardClaims("Phases 1,2 and 3 are funded.")).toEqual([]);
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
        detail: "numbers not supported by cited facts: ['9900000']",
        sentence: "The project costs $9.9 million. [fact:cost]",
      },
    ]);
  });

  it("blocks a magnitude fabrication: $4.2 billion against a $4.2 million fact", () => {
    const out = validateGroundedNarrative(
      "The project costs $4.2 billion. [fact:cost]",
      ["cost"],
      "strict",
      facts
    );
    expect(out.isFullyGrounded).toBe(false);
    expect(out.issues[0]?.kind).toBe("unfaithful_citation");
  });

  it("does not let a stray small integer in the fact launder a scaled figure", () => {
    // The cost fact contains "5" (from "over 5 years") — "$5 million" must
    // still be blocked because its scaled core is 5000000, not 5.
    const out = validateGroundedNarrative(
      "The project will cost $5 million. [fact:cost]",
      ["cost"],
      "strict",
      facts
    );
    expect(out.isFullyGrounded).toBe(false);
    expect(out.issues[0]?.kind).toBe("unfaithful_citation");
  });

  it("accepts equivalent notation: $4,200,000 against a $4.2 million fact", () => {
    const out = validateGroundedNarrative(
      "The corridor needs a $4,200,000 investment. [fact:cost]",
      ["cost"],
      "strict",
      facts
    );
    expect(out.isFullyGrounded).toBe(true);
  });

  it("catches spelled-out percentages: '64 percent' against a 6.4% fact", () => {
    const out = validateGroundedNarrative(
      "Transit use fell 64 percent over the decade. [fact:vmt]",
      ["vmt"],
      "strict",
      facts
    );
    expect(out.isFullyGrounded).toBe(false);
    expect(out.issues[0]?.kind).toBe("unfaithful_citation");
  });

  it("does not flag enumerated alternatives with comma-separated small integers", () => {
    const out = validateGroundedNarrative(
      "Alternatives 1, 2, and 3 each reduce corridor delay. [fact:cost]",
      ["cost"],
      "strict",
      facts
    );
    expect(out.isFullyGrounded).toBe(true);
  });

  it("reports faithfulnessChecked according to whether fact texts were supplied", () => {
    const withBelt = validateGroundedNarrative("Fine. [fact:cost]", ["cost"], "strict", facts);
    const withoutBelt = validateGroundedNarrative("Fine. [fact:cost]", ["cost"], "strict");
    expect(withBelt.faithfulnessChecked).toBe(true);
    expect(withoutBelt.faithfulnessChecked).toBe(false);
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

/**
 * WHAT THE 2026-08-07 MUTATION AUDIT FOUND MISSING.
 *
 * 24 mutations across this module and `grants/narrative-grounding.ts`; 18 died,
 * 6 lived. Three of the six turned out to be equivalent mutants and are pinned
 * below by the property that makes them equivalent. The other three were real
 * holes in a machine whose entire job is stopping a fabricated figure from
 * reaching a funder, and these close them.
 */
describe("the faithfulness belt's own trigger — what counts as a figure worth checking", () => {
  const facts = new Map([["budget", "The programmed budget is $1,250,000 for two phases."]]);

  it("checks SMALL money, which nothing was asserting", () => {
    // MUTATION G7 SURVIVED THE WHOLE SUITE: deleting the `$`/`%` clause from
    // `isConsequentialNumber` changed no test. A "$500" carries no comma, no
    // decimal and no magnitude suffix, and its core is three digits — so with
    // that clause gone it falls through every remaining branch and stops being
    // cross-checked at all. A fabricated small dollar figure with a real
    // [fact:N] stapled on would have passed the belt silently.
    expect(extractHardClaims("The local match is $500.")).toEqual(["500"]);

    const out = validateGroundedNarrative(
      "The local match is $500. [fact:budget]",
      ["budget"],
      "strict",
      facts
    );
    expect(out.isFullyGrounded).toBe(false);
    expect(out.sentences.length + out.droppedSentences.length).toBeGreaterThan(0);
    expect(out.issues[0]?.kind).toBe("unfaithful_citation");
  });

  it("checks SMALL percentages for the same reason", () => {
    expect(extractHardClaims("Ridership rose 4%.")).toEqual(["4"]);

    const out = validateGroundedNarrative("Ridership rose 4%. [fact:budget]", ["budget"], "strict", facts);
    expect(out.isFullyGrounded).toBe(false);
  });

  it("leaves a bare small integer alone, which is why the belt is usable", () => {
    // The other half of the same rule: "two phases", "3 lanes" and "Alternative
    // 2" are not figures a reviewer acts on, and checking them would make the
    // belt fire on every sentence.
    expect(extractHardClaims("The project has 3 lanes and 2 phases.")).toEqual([]);
  });

  it("EQUIVALENT MUTANT, recorded rather than closed: the year clause is dead code", () => {
    // MUTATION G8 SURVIVED, and it survives correctly. Deleting the
    // `1900 <= year <= 2099` branch changes nothing, because the clause AFTER
    // it already returns true for any 4-digit core. Measured, not reasoned:
    // every value below is consequential with the year branch removed. The
    // branch documents intent and is harmless; it is not load-bearing, and a
    // future reader must not take its presence as the reason years are checked.
    for (const year of ["2028", "1899", "2100", "5000"]) {
      expect(extractHardClaims(`Construction begins in ${year}.`), year).toEqual([year]);
    }
    // 999 is below the four-digit floor and is correctly ignored either way.
    expect(extractHardClaims("There are 999 parcels.")).toEqual([]);
  });
});

describe("the ids reported back are the ids, not a tally", () => {
  it("reports one entry per distinct fact id, however many times it was cited", () => {
    // MUTATION G13 SURVIVED: `dedupePreservingOrder` could return its input
    // unchanged and no test noticed. An operator then reads "unknown fact_ids:
    // ['fact_9', 'fact_9', 'fact_9']" and counts three problems where there is
    // one — and the persisted summary grows a list that is a citation tally
    // wearing an id list's name.
    const out = validateGroundedNarrative(
      "Both halves rest on the same source. [fact:a] [fact:a] [fact:b] Another line cites it again. [fact:a]",
      ["a", "b"],
      "annotated"
    );

    expect(out.citedFactIds).toEqual(["a", "b"]);

    const unknown = validateGroundedNarrative(
      "First. [fact:ghost] [fact:ghost] Second. [fact:ghost]",
      ["real"],
      "annotated"
    );
    expect(unknown.unknownFactIds).toEqual(["ghost"]);
  });

  it("EQUIVALENT MUTANT, recorded: the unknown-id conjunct in the verdict is redundant", () => {
    // MUTATION G5 SURVIVED — dropping `&& unknownFactIds.length === 0` from
    // `isFullyGrounded` changed nothing, and it cannot: a sentence with an
    // unknown id is not grounded, so it has already incremented
    // `ungroundedCount`, and `unknownAll` is only ever pushed inside that same
    // branch. The property is what is pinned here; the conjunct is defensive
    // and may stay.
    const out = validateGroundedNarrative("A claim. [fact:ghost]", ["real"], "annotated");
    expect(out.unknownFactIds).toEqual(["ghost"]);
    expect(out.ungroundedSentenceCount).toBe(1);
    expect(out.isFullyGrounded).toBe(false);
  });
});

describe("numeric faithfulness — documented bounds (characterization)", () => {
  // These pin the belt's KNOWN LIMITS so future maintainers don't over-trust
  // it: the belt proves presence of each figure in the sentence's cited facts,
  // nothing stronger. It narrows operator review; it does not replace it.
  const facts = new Map([
    ["pop", "population: 1000"],
    ["jobs", "jobs: 5000"],
    ["score", "Overall score 82 of 100."],
    ["dist", "The corridor is 4.5 miles long."],
  ]);

  it("KNOWN LIMIT: values swapped across pooled citations pass (presence, not attribution)", () => {
    const out = validateGroundedNarrative(
      "The corridor has 5000 residents supporting 1000 jobs. [fact:pop] [fact:jobs]",
      ["pop", "jobs"],
      "strict",
      facts
    );
    expect(out.isFullyGrounded).toBe(true);
  });

  it("KNOWN LIMIT: a bare fact number can be re-unitized (82 -> 82%)", () => {
    const out = validateGroundedNarrative(
      "Transit serves 82% of corridor households. [fact:score]",
      ["score"],
      "strict",
      facts
    );
    expect(out.isFullyGrounded).toBe(true);
  });

  it("KNOWN LIMIT: unit classes beyond scaling are not distinguished (4.5 miles -> 4.5%)", () => {
    const out = validateGroundedNarrative(
      "The project cuts emissions by 4.5%. [fact:dist]",
      ["dist"],
      "strict",
      facts
    );
    expect(out.isFullyGrounded).toBe(true);
  });

  it("KNOWN LIMIT: spelled-out word numbers are invisible ('nine million')", () => {
    const out = validateGroundedNarrative(
      "The program unlocks nine million dollars. [fact:pop]",
      ["pop"],
      "strict",
      facts
    );
    expect(out.isFullyGrounded).toBe(true);
  });
});

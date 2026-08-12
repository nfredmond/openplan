import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripSourceComments } from "@/test/helpers/source-text";

/**
 * THE WORDS A PERSON READS about a transcribed figure — on the review screen,
 * in the plan, on the public page, and in the board export body.
 *
 * Three things this file is for, in order of how badly each one would hurt:
 *
 *   1. NO SCORE, ANYWHERE. A confidence, certainty or likelihood number beside
 *      a transcribed figure is the model grading its own work, and a reader who
 *      sees one stops reading the quote. The scan below is over the module's
 *      own source, because a phrase can be added to any of a dozen sentences
 *      and no assertion about one function would see it.
 *   2. THE DISCARD COUNT IS SAID OUT LOUD. "41 proposed; 6 dropped" is the
 *      difference between a planner knowing what the reading got wrong and a
 *      screen that looks clean because the wrong answers were deleted.
 *   3. THE PUBLIC WORDING IS FOR RESIDENTS. No internal vocabulary, no operator
 *      instructions, and never a citation for a figure the agency has since
 *      changed.
 *
 * MUTATION-VERIFIED 2026-08-11 (each applied to `lib/rtp/extraction/display.ts`,
 * this file run, then restored) — results recorded at the bottom of this file.
 */

import {
  RECONCILIATION_COPY,
  buildProvenanceChip,
  describeCandidateFields,
  describeCycleBasisBlastRadius,
  describeReconciliationRollup,
  describeRunOutcome,
  exportProvenanceLine,
  transcriptionDocumentHref,
  type TranscriptionRecord,
} from "@/lib/rtp/extraction/display";

const DISPLAY_SOURCE = readFileSync(
  path.join(process.cwd(), "src/lib/rtp/extraction/display.ts"),
  "utf8"
);

/**
 * The copy ONLY — this module's own prose about why there is no score would
 * otherwise trip the scan below, and a guard defeated by its own comment is a
 * failure this repository has had five times (see `helpers/source-text.ts`).
 */
const DISPLAY_COPY_STRINGS = stripSourceComments(DISPLAY_SOURCE);

function record(overrides: Partial<TranscriptionRecord> = {}): TranscriptionRecord {
  return {
    candidateId: "candidate-1",
    kbDocumentId: "document-1",
    documentTitle: "Example Region RTP 2050 (adopted)",
    page: 112,
    quote: "Federal STBG revenue of $412 million is assumed over the near-term period.",
    divergentFields: [],
    ...overrides,
  };
}

describe("no surface ever grades the transcription", () => {
  it("has no confidence, certainty or likelihood wording in any of its copy", () => {
    // A model scoring its own transcription is the model grading itself, and a
    // threshold over that score is a machine authoring a planning number with
    // extra steps (20260811000008's header names this as one of the five things
    // that would reopen the 2026-08-05 refusals).
    expect(DISPLAY_COPY_STRINGS).not.toMatch(
      /\b(confidence|confident|certainty|likelihood|probability|accuracy score|reliability score|% sure|percent sure)\b/i
    );
  });

  it("says nothing that implies the machine decided anything", () => {
    for (const audience of ["planner", "public"] as const) {
      const chip = buildProvenanceChip(record(), audience);
      expect(`${chip.headline} ${chip.detail ?? ""}`).not.toMatch(
        /\b(verified by (?:ai|the model)|automatically (?:approved|accepted|confirmed)|the model (?:decided|chose|determined))\b/i
      );
    }
  });
});

describe("what a reading produced, including what it threw away", () => {
  it("names the dropped proposals and why they were dropped", () => {
    expect(
      describeRunOutcome({
        status: "succeeded",
        candidateCount: 35,
        discardedCount: 6,
        failureReason: null,
      })
    ).toBe("41 proposed; 6 dropped because their figures were not in the text they cited.");
  });

  it("says none were dropped rather than staying silent about it", () => {
    expect(
      describeRunOutcome({ status: "succeeded", candidateCount: 12, discardedCount: 0, failureReason: null })
    ).toContain("none were dropped");
  });

  it("does not read an empty reading as a finding about the document", () => {
    const sentence = describeRunOutcome({
      status: "succeeded",
      candidateCount: 0,
      discardedCount: 0,
      failureReason: null,
    });
    expect(sentence).toMatch(/not a finding that the document contains no figures/i);
  });

  it("shows a failed reading's own reason, never a success sentence", () => {
    expect(
      describeRunOutcome({
        status: "failed",
        candidateCount: 0,
        discardedCount: 0,
        failureReason: "The model's answer could not be read, so nothing was kept.",
      })
    ).toBe("The model's answer could not be read, so nothing was kept.");
  });

  it("says a failed reading failed even when nothing recorded why", () => {
    // The 2026-08-10 modeling defect: a crashed run whose reason was never
    // written read as benign.
    const sentence = describeRunOutcome({
      status: "failed",
      candidateCount: 0,
      discardedCount: 0,
      failureReason: null,
    });
    expect(sentence).toMatch(/failed/i);
    expect(sentence).toMatch(/reason was not recorded/i);
  });
});

describe("the review header's roll-up", () => {
  it("names the conflicts, which is the count that matters", () => {
    expect(describeReconciliationRollup({ new: 18, already_recorded: 6, conflicts: 3 })).toBe(
      "18 new · 6 already recorded · 3 conflict with what you have"
    );
  });

  it("says the queue is empty rather than printing three zeroes", () => {
    expect(describeReconciliationRollup({ new: 0, already_recorded: 0, conflicts: 0 })).toBe(
      "Nothing is waiting for review."
    );
  });
});

describe("the blast radius of the plan's dollar year (Q5)", () => {
  it("states how many recorded figures accepting it re-derives, before the click", () => {
    const sentence = describeCycleBasisBlastRadius({
      lineCount: 14,
      programmedProjectCount: 9,
      recordedBasisYear: 2020,
      proposedBasisYear: 2026,
    });

    expect(sentence).toContain("2020");
    expect(sentence).toContain("2026");
    expect(sentence).toContain("23 recorded figures");
    expect(sentence).toMatch(/without editing any of them/i);
  });

  it("still warns when nothing is recorded against it yet", () => {
    const sentence = describeCycleBasisBlastRadius({
      lineCount: 0,
      programmedProjectCount: 0,
      recordedBasisYear: null,
      proposedBasisYear: 2026,
    });
    expect(sentence).toMatch(/no figure changes today/i);
    expect(sentence).toMatch(/every figure entered afterwards/i);
  });
});

describe("a candidate's own values", () => {
  it("badges the fields the verifier could not check against the quote", () => {
    const fields = describeCandidateFields("financial_line", {
      entryKind: "revenue",
      sourceName: "Federal STBG",
      amount: 412000000,
      amountBasisYear: 2026,
    });

    const byKey = Object.fromEntries(fields.map((field) => [field.key, field]));
    // The plan does not spell "revenue" the way the database does, so the
    // verifier never matched it against the quote and the reviewer must.
    expect(byKey.entryKind.checkedAgainstQuote).toBe(false);
    expect(byKey.amount.checkedAgainstQuote).toBe(true);
    expect(byKey.amount.value).toBe("$412,000,000");
  });

  it("never shows a uuid the verifier resolved", () => {
    const fields = describeCandidateFields("financial_line", {
      entryKind: "revenue",
      sourceName: "Federal STBG",
      amount: 1,
      horizonBandLabel: "Near-term",
      horizonBandId: "6f1a2b3c-0000-4000-8000-000000000000",
    });
    expect(fields.map((field) => field.key)).not.toContain("horizonBandId");
    expect(fields.map((field) => field.key)).toContain("horizonBandLabel");
  });

  it("shows nothing for a value the document did not state", () => {
    const fields = describeCandidateFields("performance_measure", {
      label: "Fatalities",
      baselineValue: null,
      targetValue: undefined,
    });
    expect(fields.map((field) => field.key)).toEqual(["label"]);
  });
});

describe("the provenance chip", () => {
  it("names the document and the page for both audiences", () => {
    for (const audience of ["planner", "public"] as const) {
      const chip = buildProvenanceChip(record(), audience);
      expect(chip.headline).toContain("Example Region RTP 2050 (adopted)");
      expect(chip.headline).toContain("112");
      expect(chip.quote).toContain("$412 million");
    }
  });

  it("says the agency revised a figure it no longer matches", () => {
    const edited = record({
      divergentFields: [
        {
          key: "amount",
          label: "Amount",
          kind: "money",
          documentValue: 412_000_000,
          recordedValue: 390_000_000,
          same: false,
        },
      ],
    });

    const publicChip = buildProvenanceChip(edited, "public");
    expect(publicChip.edited).toBe(true);
    expect(publicChip.headline).toMatch(/revised since/i);
    expect(publicChip.detail).toMatch(/changed this figure after copying it/i);

    // The planner is told exactly which value moved and to what.
    const plannerChip = buildProvenanceChip(edited, "planner");
    expect(plannerChip.detail).toContain("$390,000,000");
    expect(plannerChip.detail).toContain("$412,000,000");
  });

  it("names an untitled document in words rather than printing an id", () => {
    const chip = buildProvenanceChip(record({ documentTitle: null }), "public");
    expect(chip.headline).not.toContain("document-1");
    expect(chip.headline).toMatch(/a document in this plan's library/);
  });

  it("keeps operator vocabulary out of the public wording", () => {
    const chip = buildProvenanceChip(record(), "public");
    const text = `${chip.headline} ${chip.detail ?? ""}`;
    for (const word of [
      "candidate",
      "extraction",
      "verifier",
      "workspace",
      "migration",
      "supabase",
      "OCR",
      "API",
      "staged",
    ]) {
      expect(text.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });
});

describe("the export body's citation line (Q2 — never an appendix)", () => {
  it("carries the document, the page and the document's own words", () => {
    const line = exportProvenanceLine(record());
    expect(line).toContain("Example Region RTP 2050 (adopted)");
    expect(line).toContain("page 112");
    expect(line).toContain("Federal STBG revenue of $412 million");
  });
});

describe("the door to the source document", () => {
  it("points members at the download route", () => {
    expect(transcriptionDocumentHref(record())).toBe(
      "/api/knowledge-base/documents/document-1/download"
    );
  });

  it("offers no door when the document could not be resolved", () => {
    expect(transcriptionDocumentHref(record({ kbDocumentId: null }))).toBeUndefined();
  });
});

describe("what the reconciliation badge tells a reviewer to do", () => {
  it("puts dismiss first for something already recorded", () => {
    expect(RECONCILIATION_COPY.already_recorded.primaryAction).toBe("dismiss");
    expect(RECONCILIATION_COPY.already_recorded.detail).toMatch(/record the same thing twice/i);
  });

  it("never tells a reviewer which figure is right in a conflict", () => {
    expect(RECONCILIATION_COPY.conflicts.detail).toMatch(/decide which one/i);
    expect(RECONCILIATION_COPY.conflicts.detail).not.toMatch(
      /\b(the document is correct|use the document|the newer figure|trust the)\b/i
    );
  });
});

/*
  MUTATION RESULTS, 2026-08-11. Each applied to `lib/rtp/extraction/display.ts`,
  this file run, then restored:

    - `describeRunOutcome` returning `${proposed} proposals` and dropping the
      discarded half → 2 failures ("names the dropped proposals", "says none
      were dropped"). This is the mutation that matters most: it is exactly the
      clean-looking review header the feature must not have.
    - the failed branch of `describeRunOutcome` deleted, so a failed run fell
      through to the counts → 2 failures: a failed run read as "Nothing in this
      document matched what OpenPlan knows how to record", which is the
      2026-08-10 "a failed run said Run recorded" defect exactly.
    - `buildProvenanceChip` ignoring `divergentFields` and always returning the
      unedited wording → 1 failure ("says the agency revised a figure it no
      longer matches"). That is the wrong-citation case on a public page.
    - `describeCycleBasisBlastRadius` returning only the first sentence → 2
      failures: the count of re-derived figures disappears from the warning,
      and so does the "every figure entered afterwards" half.
    - `checkedAgainstQuote` hardcoded to `true` → 1 failure: an unchecked
      classification renders as though the verifier had matched it.
    - the word "confidence" added to `RECONCILIATION_COPY.new.detail` → 1
      failure in the no-score scan, proving the scan can see into the copy
      rather than only into this file's own strings.
*/

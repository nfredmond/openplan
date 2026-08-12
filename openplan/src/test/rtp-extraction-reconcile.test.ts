import { describe, expect, it } from "vitest";

/**
 * RECONCILIATION — the deterministic half of the transcription lane.
 *
 * The extraction run is blind to the database on purpose, so the question "is
 * this already recorded?" is answered here, in code, with no model anywhere
 * near it. This file is the proof that the three answers are the RIGHT three
 * answers, and it leans hardest on the two ways a comparison quietly lies:
 *
 *   1. A NEAR MISS READING AS A MATCH. $412,000,000 against $412,500,000 is a
 *      conflict, and so is the same amount stated in a different dollar year.
 *      Either one read as "already recorded" would put a superseded figure into
 *      an adopted plan with a page citation on it.
 *   2. SILENCE READING AS DISAGREEMENT. A candidate that says nothing about a
 *      dollar year must not conflict with a line that has one — a screen full
 *      of manufactured conflicts is how a reviewer learns to click through
 *      them, which costs the real conflict its only reader.
 *
 * MUTATION-VERIFIED 2026-08-11 — each mutation applied to
 * `lib/rtp/extraction/reconcile.ts`, this file RUN, then restored. What each
 * one actually killed:
 *
 *   - `toNumber` answering `0` for an absent value instead of `null`
 *       → 1 failure: "does not read a recorded ABSENCE as agreeing with a
 *         document's zero". NULL is not 0 in the RTP schema and it is not 0
 *         here. (Recorded honestly: my first draft of this file did NOT catch
 *         this mutation — the absent-field tests are about a key MISSING from
 *         proposed_json, which `compareFields` skips before any number is
 *         parsed. The zero-against-absent test was added because the mutation
 *         survived, which is the only reason it exists.)
 *   - the value comparison loosened to `Math.abs(a - b) < 1_000_000`
 *       → 6 failures, led by "conflicts on a NEAR-MISS amount".
 *   - `amountBasisYear` dropped from the financial comparison plan
 *       → 1 failure: "conflicts when the SAME amount is stated in a different
 *         dollar year" — the case where the figures agree and the money does
 *         not.
 *   - `decide()` answering `already_recorded` for the first match rather than
 *     for an identical one
 *       → 12 failures. Every conflict in this file would have read as a
 *         duplicate, which is the single worst outcome the feature has: the
 *         superseded figure stays and the adopted one is dismissed.
 *   - `transcriptionDivergence` finding its row by IDENTITY instead of by id
 *       → 1 failure: "detects an edited NAME". That is the case that leaves a
 *         wrong citation on a public plan page.
 */

import {
  reconcileExtractionCandidate,
  rollUpReconciliations,
  transcriptionDivergence,
  type RtpCycleRecordedState,
} from "@/lib/rtp/extraction/reconcile";

const BAND_NEAR = "band-near";
const BAND_MID = "band-mid";

/**
 * A plan with something recorded in every shape the comparison knows, so a test
 * that expects `new` is a real absence rather than an empty database.
 */
function recordedState(overrides: Partial<RtpCycleRecordedState> = {}): RtpCycleRecordedState {
  return {
    lines: [
      {
        id: "line-1",
        horizonBandId: BAND_NEAR,
        entryKind: "revenue",
        // PostgREST hands NUMERIC back as a string; the comparison must not care.
        amount: "412000000.00",
        amountBasisYear: 2026,
        sourceName: "Federal STBG",
      },
      {
        id: "line-2",
        horizonBandId: BAND_MID,
        entryKind: "revenue",
        amount: 90_000_000,
        amountBasisYear: 2026,
        sourceName: "Federal STBG",
      },
    ],
    measures: [
      {
        id: "measure-1",
        measureKey: "fatalities",
        label: "Fatalities and serious injuries",
        unit: "people",
        baselineValue: "48",
        baselineYear: 2024,
        targetValue: 24,
        targetYear: 2035,
        dataSource: "State crash records",
      },
    ],
    bands: [
      {
        id: BAND_NEAR,
        label: "Near-term",
        startYear: 2026,
        endYear: 2035,
        escalationTargetYear: null,
        costEstimateBasis: "itemized",
      },
      {
        id: BAND_MID,
        label: "Mid-term",
        startYear: 2036,
        endYear: 2045,
        escalationTargetYear: null,
        costEstimateBasis: "itemized",
      },
    ],
    programmedProjects: [
      {
        id: "link-1",
        projectId: "project-1",
        projectName: "Main Street Complete Street",
        horizonBandId: BAND_NEAR,
        portfolioRole: "constrained",
        estimatedCost: "12400000",
        costBasisYear: 2023,
      },
    ],
    cycle: { id: "cycle-1", financialBasisYear: 2026 },
    ...overrides,
  };
}

describe("reconciling a transcribed financial line", () => {
  it("labels a line this plan does not have as new", () => {
    const result = reconcileExtractionCandidate(
      {
        targetKind: "financial_line",
        proposedJson: {
          entryKind: "revenue",
          sourceName: "State Transit Assistance",
          amount: 12_000_000,
          horizonBandId: BAND_NEAR,
        },
      },
      recordedState()
    );

    expect(result.verdict).toBe("new");
    expect(result.matches).toEqual([]);
  });

  it("labels an identical line as already recorded, and names the row", () => {
    const result = reconcileExtractionCandidate(
      {
        targetKind: "financial_line",
        proposedJson: {
          entryKind: "revenue",
          sourceName: "Federal STBG",
          amount: 412_000_000,
          amountBasisYear: 2026,
          horizonBandId: BAND_NEAR,
        },
      },
      recordedState()
    );

    expect(result.verdict).toBe("already_recorded");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].rowId).toBe("line-1");
    expect(result.matches[0].fields.every((field) => field.same)).toBe(true);
  });

  it("conflicts on a NEAR-MISS amount, and shows both figures", () => {
    const result = reconcileExtractionCandidate(
      {
        targetKind: "financial_line",
        proposedJson: {
          entryKind: "revenue",
          sourceName: "Federal STBG",
          amount: 412_500_000,
          amountBasisYear: 2026,
          horizonBandId: BAND_NEAR,
        },
      },
      recordedState()
    );

    expect(result.verdict).toBe("conflicts");
    const amount = result.matches[0].fields.find((field) => field.key === "amount");
    expect(amount).toMatchObject({
      same: false,
      recordedValue: 412_000_000,
      documentValue: 412_500_000,
    });
  });

  it("conflicts when the SAME amount is stated in a different dollar year", () => {
    const result = reconcileExtractionCandidate(
      {
        targetKind: "financial_line",
        proposedJson: {
          entryKind: "revenue",
          sourceName: "Federal STBG",
          amount: 412_000_000,
          amountBasisYear: 2020,
          horizonBandId: BAND_NEAR,
        },
      },
      recordedState()
    );

    expect(result.verdict).toBe("conflicts");
    const basisYear = result.matches[0].fields.find((field) => field.key === "amountBasisYear");
    expect(basisYear).toMatchObject({ same: false, recordedValue: 2026, documentValue: 2020 });
    // The amount itself still agrees — the disagreement is about what the
    // dollars mean, and the card must be able to show exactly that.
    expect(result.matches[0].fields.find((field) => field.key === "amount")?.same).toBe(true);
  });

  it("does not compare a dollar year the document never stated", () => {
    const result = reconcileExtractionCandidate(
      {
        targetKind: "financial_line",
        proposedJson: {
          entryKind: "revenue",
          sourceName: "Federal STBG",
          amount: 412_000_000,
          horizonBandId: BAND_NEAR,
        },
      },
      recordedState()
    );

    expect(result.verdict).toBe("already_recorded");
    expect(result.matches[0].fields.map((field) => field.key)).not.toContain("amountBasisYear");
  });

  it("keeps the same revenue source in two periods apart", () => {
    // The mid-term line holds $90M under the same name. A candidate scoped to
    // the near-term period must not be compared against it.
    const result = reconcileExtractionCandidate(
      {
        targetKind: "financial_line",
        proposedJson: {
          entryKind: "revenue",
          sourceName: "Federal STBG",
          amount: 90_000_000,
          amountBasisYear: 2026,
          horizonBandId: BAND_NEAR,
        },
      },
      recordedState()
    );

    expect(result.verdict).toBe("conflicts");
    expect(result.matches.map((match) => match.rowId)).toEqual(["line-1"]);
  });

  it("compares across every period when the document named none", () => {
    const result = reconcileExtractionCandidate(
      {
        targetKind: "financial_line",
        proposedJson: { entryKind: "revenue", sourceName: "Federal STBG", amount: 5_000_000 },
      },
      recordedState()
    );

    expect(result.verdict).toBe("conflicts");
    expect(result.matches.map((match) => match.rowId).sort()).toEqual(["line-1", "line-2"]);
  });

  it("prefers the identical row when this plan holds both an identical and a differing line", () => {
    const state = recordedState();
    const result = reconcileExtractionCandidate(
      {
        targetKind: "financial_line",
        proposedJson: { entryKind: "revenue", sourceName: "Federal STBG", amount: 90_000_000 },
      },
      state
    );

    // Accepting would duplicate line-2, which is the more consequential answer.
    expect(result.verdict).toBe("already_recorded");
    expect(result.matches[0].rowId).toBe("line-2");
  });

  it("treats a cost line and a revenue line of the same name as different things", () => {
    const result = reconcileExtractionCandidate(
      {
        targetKind: "financial_line",
        proposedJson: {
          entryKind: "operations_maintenance",
          sourceName: "Federal STBG",
          amount: 412_000_000,
          horizonBandId: BAND_NEAR,
        },
      },
      recordedState()
    );

    expect(result.verdict).toBe("new");
  });
});

describe("reconciling a transcribed performance measure", () => {
  it("matches on the measure's NAME, because a document prints no key", () => {
    const result = reconcileExtractionCandidate(
      {
        targetKind: "performance_measure",
        proposedJson: {
          label: "fatalities and serious injuries",
          baselineValue: 48,
          baselineYear: 2024,
        },
      },
      recordedState()
    );

    expect(result.verdict).toBe("already_recorded");
    expect(result.matches[0].rowId).toBe("measure-1");
  });

  it("conflicts when the document's baseline differs from the recorded one", () => {
    const result = reconcileExtractionCandidate(
      {
        targetKind: "performance_measure",
        proposedJson: {
          label: "Fatalities and serious injuries",
          baselineValue: 52,
          baselineYear: 2024,
        },
      },
      recordedState()
    );

    expect(result.verdict).toBe("conflicts");
    expect(result.matches[0].fields.find((field) => field.key === "baselineValue")).toMatchObject({
      same: false,
      recordedValue: 48,
      documentValue: 52,
    });
  });

  it("does not read a recorded ABSENCE as agreeing with a document's zero", () => {
    // NULL is not 0 anywhere in the RTP schema, and it is not 0 here: a plan
    // that records no baseline and a document that prints a baseline of zero
    // disagree, and a comparison that collapsed them would mark a real
    // measurement as already recorded and take it off the review queue.
    const state = recordedState({
      measures: [
        {
          id: "measure-empty",
          measureKey: "transit_deaths",
          label: "Transit fatalities",
          unit: null,
          baselineValue: null,
          baselineYear: null,
          targetValue: null,
          targetYear: null,
          dataSource: null,
        },
      ],
    });

    const result = reconcileExtractionCandidate(
      { targetKind: "performance_measure", proposedJson: { label: "Transit fatalities", baselineValue: 0 } },
      state
    );

    expect(result.verdict).toBe("conflicts");
    expect(result.matches[0].fields.find((field) => field.key === "baselineValue")).toMatchObject({
      same: false,
      recordedValue: null,
      documentValue: 0,
    });
  });

  it("treats a zero baseline as a real measurement, not an absence", () => {
    const state = recordedState({
      measures: [
        {
          id: "measure-zero",
          measureKey: "transit_deaths",
          label: "Transit fatalities",
          unit: "people",
          baselineValue: 0,
          baselineYear: 2024,
          targetValue: 0,
          targetYear: 2035,
          dataSource: null,
        },
      ],
    });

    const same = reconcileExtractionCandidate(
      { targetKind: "performance_measure", proposedJson: { label: "Transit fatalities", baselineValue: 0 } },
      state
    );
    expect(same.verdict).toBe("already_recorded");

    const differs = reconcileExtractionCandidate(
      { targetKind: "performance_measure", proposedJson: { label: "Transit fatalities", baselineValue: 3 } },
      state
    );
    expect(differs.verdict).toBe("conflicts");
  });
});

describe("reconciling a transcribed period", () => {
  it("matches a renamed period by its years and shows the rename as the conflict", () => {
    const result = reconcileExtractionCandidate(
      {
        targetKind: "horizon_band",
        proposedJson: { label: "Tier 1", startYear: 2026, endYear: 2035 },
      },
      recordedState()
    );

    expect(result.verdict).toBe("conflicts");
    expect(result.matches[0].rowId).toBe(BAND_NEAR);
    expect(result.matches[0].fields.find((field) => field.key === "label")).toMatchObject({
      same: false,
      recordedValue: "Near-term",
      documentValue: "Tier 1",
    });
  });

  it("matches a re-dated period by its name", () => {
    const result = reconcileExtractionCandidate(
      {
        targetKind: "horizon_band",
        proposedJson: { label: "Near-term", startYear: 2026, endYear: 2032 },
      },
      recordedState()
    );

    expect(result.verdict).toBe("conflicts");
    expect(result.matches[0].fields.find((field) => field.key === "endYear")).toMatchObject({
      same: false,
      recordedValue: 2035,
      documentValue: 2032,
    });
  });

  it("does not compare an escalation year the document never named", () => {
    const result = reconcileExtractionCandidate(
      {
        targetKind: "horizon_band",
        proposedJson: { label: "Near-term", startYear: 2026, endYear: 2035 },
      },
      recordedState()
    );

    expect(result.verdict).toBe("already_recorded");
    expect(result.matches[0].fields.map((field) => field.key)).not.toContain("escalationTargetYear");
  });
});

describe("reconciling a transcribed programmed project", () => {
  it("matches by the project's name, which is all the document gives", () => {
    const result = reconcileExtractionCandidate(
      {
        targetKind: "programmed_project",
        proposedJson: {
          projectName: "Main Street Complete Street",
          estimatedCost: 14_000_000,
          costBasisYear: 2023,
        },
      },
      recordedState()
    );

    expect(result.verdict).toBe("conflicts");
    expect(result.matches[0].fields.find((field) => field.key === "estimatedCost")).toMatchObject({
      same: false,
      recordedValue: 12_400_000,
      documentValue: 14_000_000,
    });
  });

  it("reads a period comparison out as the period's name, never a uuid", () => {
    const result = reconcileExtractionCandidate(
      {
        targetKind: "programmed_project",
        proposedJson: {
          projectName: "Main Street Complete Street",
          estimatedCost: 12_400_000,
          costBasisYear: 2023,
          horizonBandId: BAND_MID,
        },
      },
      recordedState()
    );

    expect(result.verdict).toBe("conflicts");
    const period = result.matches[0].fields.find((field) => field.key === "horizonBandId");
    expect(period).toMatchObject({
      same: false,
      documentValue: "Mid-term (2036–2045)",
      recordedValue: "Near-term (2026–2035)",
    });
  });

  it("is new when this plan has no project of that name", () => {
    const result = reconcileExtractionCandidate(
      { targetKind: "programmed_project", proposedJson: { projectName: "Riverside Bridge Replacement" } },
      recordedState()
    );
    expect(result.verdict).toBe("new");
  });
});

describe("reconciling the plan's own dollar year", () => {
  it("conflicts when the plan already reads its money in a different year", () => {
    const result = reconcileExtractionCandidate(
      { targetKind: "cycle_financial_basis", proposedJson: { financialBasisYear: 2020 } },
      recordedState()
    );

    expect(result.verdict).toBe("conflicts");
    expect(result.matches[0].rowId).toBe("cycle-1");
  });

  it("is new when no dollar year is recorded", () => {
    const result = reconcileExtractionCandidate(
      { targetKind: "cycle_financial_basis", proposedJson: { financialBasisYear: 2026 } },
      recordedState({ cycle: { id: "cycle-1", financialBasisYear: null } })
    );
    expect(result.verdict).toBe("new");
  });
});

describe("kinds this file deliberately does not compare", () => {
  it("answers chapter_block `new` with a stated reason rather than silently", () => {
    const result = reconcileExtractionCandidate(
      { targetKind: "chapter_block", proposedJson: { text: "Goal 1: safety." } },
      recordedState()
    );
    expect(result.verdict).toBe("new");
    expect(result.identityNote).toMatch(/reviewed on its own/i);
  });
});

describe("the roll-up the review header reads", () => {
  it("counts every verdict, including the zeroes", () => {
    const rollup = rollUpReconciliations([
      { verdict: "new", identityNote: "", matches: [] },
      { verdict: "new", identityNote: "", matches: [] },
      { verdict: "conflicts", identityNote: "", matches: [] },
    ]);
    expect(rollup).toEqual({ new: 2, already_recorded: 0, conflicts: 1 });
  });
});

describe("whether an accepted transcription still matches the row it became", () => {
  it("reports nothing when the recorded values are still the document's", () => {
    const divergence = transcriptionDivergence(
      {
        targetKind: "financial_line",
        proposedJson: {
          entryKind: "revenue",
          sourceName: "Federal STBG",
          amount: 412_000_000,
          amountBasisYear: 2026,
        },
      },
      recordedState(),
      "line-1"
    );
    expect(divergence).toEqual([]);
  });

  it("reports the field a planner corrected after accepting", () => {
    const divergence = transcriptionDivergence(
      {
        targetKind: "financial_line",
        proposedJson: {
          entryKind: "revenue",
          sourceName: "Federal STBG",
          amount: 999_000_000,
          amountBasisYear: 2026,
        },
      },
      recordedState(),
      "line-1"
    );
    expect(divergence).toHaveLength(1);
    expect(divergence[0]).toMatchObject({ key: "amount", recordedValue: 412_000_000, documentValue: 999_000_000 });
  });

  it("detects an edited NAME, which identity matching alone would miss", () => {
    // The row's `source_name` was changed after acceptance, so nothing about it
    // still matches the candidate's identity. Comparing by identity would find
    // no match, report no divergence, and leave the row citing a page for a
    // name that page does not use.
    const state = recordedState({
      lines: [
        {
          id: "line-1",
          horizonBandId: BAND_NEAR,
          entryKind: "revenue",
          amount: "412000000.00",
          amountBasisYear: 2026,
          sourceName: "Federal Surface Transportation Block Grant",
        },
      ],
    });

    const divergence = transcriptionDivergence(
      {
        targetKind: "financial_line",
        proposedJson: {
          entryKind: "revenue",
          sourceName: "Federal STBG",
          amount: 412_000_000,
          amountBasisYear: 2026,
        },
      },
      state,
      "line-1"
    );

    expect(divergence.map((field) => field.key)).toEqual(["sourceName"]);
  });

  it("reports nothing when the row it became is gone", () => {
    expect(
      transcriptionDivergence(
        { targetKind: "financial_line", proposedJson: { entryKind: "revenue", sourceName: "X", amount: 1 } },
        recordedState(),
        "line-that-was-deleted"
      )
    ).toEqual([]);
  });
});

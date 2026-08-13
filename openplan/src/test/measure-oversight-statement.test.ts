import { describe, expect, it } from "vitest";
import {
  STATEMENT_FOOTER_NOTE,
  STATEMENT_PREPARED_NOTE,
  buildMeasureAnnualStatementHtml,
  statementCoverageSentence,
  statementDivisionScopeSentence,
  type MeasureAnnualStatementData,
  type MeasureStatementCoverage,
} from "@/lib/measures/oversight-statement";
import { MEASURE_OVERSIGHT_COPY, oversightFigure, type OversightDivision } from "@/lib/measures/oversight";
import { PROHIBITED_PUBLIC_CLAIMS, sourceWithoutExplicitCaveats } from "./public-page-claims-guardrails.test";

/**
 * THE ANNUAL STATEMENT — the two properties that make it safe to hand to a
 * citizens' oversight committee.
 *
 * 1. IT CANNOT ADD ANYTHING UP. Every money value it receives is already a
 *    string, so there is nothing here to sum and no way for the document to
 *    reach a second answer for what the fund received. The proof below is
 *    adversarial rather than trusting: the fixture's parts are DELIBERATELY
 *    inconsistent with its totals — categories that add to 1,000,000.00 under a
 *    receipt of 9,812,340.17 — and the document is required to print both
 *    exactly as given. A builder that recomputed anything would print a
 *    different number and fail.
 *
 * 2. A PARTIAL YEAR SAYS WHICH MONTHS IT HAS. A statement headed "FY 2026" that
 *    silently covers two of four quarters is the most damaging document this
 *    lane can produce, because it reads as a collapse in revenue. The coverage
 *    sentence is required, is rendered before any figure, and names both the
 *    periods it has and the periods it is missing.
 *
 * Mutation results are recorded at the bottom of this file.
 */

const NB = " ";

/** Collapse the non-breaking spaces `Intl` emits, so assertions read as money. */
function plain(text: string): string {
  return text.replaceAll(NB, " ");
}

function coverage(overrides: Partial<MeasureStatementCoverage> = {}): MeasureStatementCoverage {
  return {
    periodsIncluded: ["FY26 Q1", "FY26 Q2"],
    unreportedPeriods: ["FY26 Q3"],
    spanText: "July 1, 2025 to December 31, 2025",
    cadenceLabel: "Quarterly",
    ...overrides,
  };
}

/**
 * WHAT THE ORDINANCE TOOK OUT, as `buildMeasureDivisionSummary` hands it over.
 *
 * Built by hand here for the same reason every other figure in this file is:
 * the document's job is to print what it was given, so the fixture states the
 * sentences the shared builder produces and the assertions check they survive
 * the trip. The arithmetic those sentences describe is proved where it lives —
 * `measure-allocation-arithmetic.test.ts` for the derivation, and the route
 * test for the whole chain against real ledger rows.
 */
function divisionValue(overrides: Partial<Extract<OversightDivision, { kind: "divided" }>> = {}): OversightDivision {
  return {
    kind: "divided",
    received: oversightFigure({
      amount: 9812340.17,
      currencyCode: "USD",
      coverageSentence:
        "Adds up what the fund received in the 2 reporting periods this measure has divided up (FY26 Q1 and FY26 Q2).",
      isFloor: false,
    }),
    takenOut: oversightFigure({
      amount: 98123.4,
      currencyCode: "USD",
      coverageSentence:
        "Adds up what the ordinance took out of the 2 reporting periods this measure has divided up " +
        "(FY26 Q1 and FY26 Q2) before the rest was divided.",
      isFloor: false,
    }),
    heldBack: oversightFigure({
      amount: 196246.8,
      currencyCode: "USD",
      coverageSentence:
        "Adds up what the ordinance kept back in reserve out of the 2 reporting periods this measure has " +
        "divided up (FY26 Q1 and FY26 Q2) rather than dividing it. An ordinance that keeps nothing back " +
        "has nothing to record here.",
      isFloor: false,
    }),
    leftToDivide: oversightFigure({
      amount: 9517969.97,
      currencyCode: "USD",
      coverageSentence:
        "What those periods received, less what the ordinance took out of them and less what it kept back " +
        "in reserve. This is the amount the purposes below were given.",
      isFloor: false,
    }),
    clauses: [
      {
        offTheTopId: "admin",
        label: "Running the programme",
        amountText: `USD${NB}98,123.40`,
        noteSentence:
          "The ordinance's own working came to USD 100,000.00; USD 98,123.40 was taken, because the " +
          "ordinance sets a limit on it.",
      },
      {
        offTheTopId: "checking",
        label: "Checking how the money is spent",
        amountText: `USD${NB}12,000.00`,
        noteSentence: null,
      },
    ],
    /*
     * ONE RESERVE OF EACH KIND. They render identically except in the third
     * column, and that column is the whole reason the reserve table is not more
     * rows in the clause table: a purpose-level reserve changes what one
     * heading below was given, and a pool reserve changes what all of them were
     * given together.
     */
    reserves: [
      {
        reserveId: "rainy_day",
        label: "Rainy-day fund",
        amountText: `USD${NB}96,246.80`,
        heldOutOfText: "Everything that came in",
        noteSentence: `The ordinance sets this at 2% of USD${NB}4,812,340.17.`,
      },
      {
        reserveId: "bus_replacement",
        label: "Bus replacement fund",
        amountText: `USD${NB}100,000.00`,
        heldOutOfText: "Transit service",
        noteSentence: null,
      },
    ],
    noClausesSentence: null,
    noReservesSentence: null,
    /*
     * DELIBERATELY NOT the sum of this fixture's own category rows.
     *
     * In production this sentence names Σ of the printed set-aside column, and
     * for this fixture that would be 2,858,530.06 — the very number the test
     * below requires to appear NOWHERE, because a document that reached it
     * would have added up its own lines. Naming a different total here keeps
     * that assertion meaning what it says, and proves at the same time that the
     * settlement sentence is printed as given rather than recomputed.
     */
    settlementSentence:
      "The purposes below add up to USD 3,101,777.44, which is USD 6,416,192.53 less than the amount left " +
      "for them. Treat the difference as unexplained here rather than as money that has gone astray.",
    ...overrides,
  };
}

/**
 * A statement whose PARTS DO NOT ADD UP TO ITS TOTALS, on purpose.
 *
 * Received 9,812,340.17; the two categories set aside 1,905,686.71 + 952,843.35
 * = 2,858,530.06 and were claimed against for 1,500,000.00 + 750,000.50 =
 * 2,250,000.50 — which happens to equal the "asked for" total, while "paid" is
 * 1,200,000.00 and the recipient rows say 1,500,000.00 and 750,000.50. Nothing
 * reconciles, and nothing should be reconciled HERE: these figures come from
 * ledgers that already did the arithmetic, and this document's only job is to
 * print them.
 */
function statementData(overrides: Partial<MeasureAnnualStatementData> = {}): MeasureAnnualStatementData {
  return {
    measureTitle: "Example County Transportation Measure",
    agencyName: "Example County Transportation Commission",
    fiscalYearLabel: "FY 2026",
    rateLabel: "Half-cent sales tax",
    ordinanceReference: "Ordinance 2024-11",
    coverage: coverage(),
    received: oversightFigure({
      amount: 9812340.17,
      currencyCode: "USD",
      coverageSentence: "Adds up the 2 reporting periods the agency has recorded a receipt for.",
      isFloor: true,
    }),
    askedFor: oversightFigure({
      amount: 2250000.5,
      currencyCode: "USD",
      coverageSentence: "Adds up the 3 claims that have been filed and not taken back.",
      isFloor: false,
    }),
    paidOut: oversightFigure({
      amount: 1200000,
      currencyCode: "USD",
      coverageSentence: "Adds up the 1 claim the agency has recorded as paid.",
      isFloor: false,
    }),
    division: divisionValue(),
    categories: [
      {
        categoryId: "local_streets",
        label: "Local streets and roads",
        shareText: "40% of what is left to divide",
        setAsideText: `USD${NB}1,905,686.71`,
        setAsideUnavailable: false,
        claimedText: `USD${NB}1,500,000.00`,
        isStaffEntered: false,
      },
      {
        categoryId: "transit",
        label: "Transit service",
        shareText: "35% of what is left to divide",
        setAsideText: `USD${NB}952,843.35`,
        setAsideUnavailable: false,
        claimedText: `USD${NB}750,000.50`,
        isStaffEntered: true,
      },
    ],
    recipients: [
      {
        recipientId: "r-city",
        name: "City of Example Falls",
        kindLabel: "City or town",
        askedForText: `USD${NB}1,500,000.00`,
        paidText: `USD${NB}1,200,000.00`,
        askedForCount: 2,
        paidCount: 1,
        awaitingDecisionCount: 1,
        notCountedCount: 1,
        yearsText: "FY 2026",
      },
    ],
    moe: {
      rows: [
        {
          recipientName: "City of Example Falls",
          fiscalYearLabel: "FY 2026",
          requiredText: `USD${NB}500,000.00`,
          reportedText: `USD${NB}465,000.00`,
          notDeterminedSentence: null,
          differenceText: `USD${NB}35,000.00`,
          isShortfall: true,
        },
        {
          recipientName: "Example Valley Transit District",
          fiscalYearLabel: "FY 2026",
          requiredText: `USD${NB}200,000.00`,
          reportedText: null,
          notDeterminedSentence: "The recipient has not reported its own spending for this year.",
          differenceText: null,
          isShortfall: false,
        },
      ],
      summarySentence: "1 of 2 records have both figures recorded and can be compared.",
    },
    hasStaffEnteredAmounts: true,
    generatedOnText: "2026-08-12",
    ...overrides,
  };
}

describe("the measure annual statement", () => {
  it("says which reporting periods it has and which it is missing, before any figure", () => {
    const html = plain(buildMeasureAnnualStatementHtml(statementData()));

    const sentence = statementCoverageSentence(coverage(), "FY 2026");
    expect(sentence).toBe(
      "Covers 2 reporting periods in FY 2026 — FY26 Q1, FY26 Q2 (July 1, 2025 to December 31, 2025). " +
        "1 further period has been opened for this year with no amount recorded yet (FY26 Q3). The totals " +
        "below are therefore at least what came in, not necessarily all of it. " +
        "The ordinance's reporting cadence for this fund is: quarterly."
    );

    // Rendered, and rendered BEFORE the first money figure — a caveat under the
    // number is a caveat most readers never reach.
    expect(html).toContain("Covers 2 reporting periods in FY 2026");
    expect(html.indexOf("Covers 2 reporting periods")).toBeLessThan(html.indexOf("9,812,340.17"));
  });

  it("states the coverage even when the year is complete", () => {
    // A sentence that appears only when something is wrong teaches readers to
    // skip it, so the complete case says so too.
    const sentence = statementCoverageSentence(
      coverage({ unreportedPeriods: [], periodsIncluded: ["FY26 Q1", "FY26 Q2", "FY26 Q3", "FY26 Q4"] }),
      "FY 2026"
    );
    expect(sentence).toContain("Covers 4 reporting periods in FY 2026");
    expect(sentence).not.toContain("at least what came in");
  });

  it("says so when a year has periods open and none of them reported", () => {
    const sentence = statementCoverageSentence(
      coverage({ periodsIncluded: [], unreportedPeriods: ["FY27 Q1"], spanText: null }),
      "FY 2027"
    );
    expect(sentence).toContain(
      "No reporting period in FY 2027 has an amount recorded, so this statement has no receipts to report"
    );
    expect(sentence).toContain("FY27 Q1");
  });

  it("refuses to produce a statement for a year with no periods at all", () => {
    // A document with an agency's name, a fiscal year and nothing behind it is
    // the shape somebody files and cites.
    expect(() =>
      buildMeasureAnnualStatementHtml(
        statementData({ coverage: coverage({ periodsIncluded: [], unreportedPeriods: [], spanText: null }) })
      )
    ).toThrow(/nothing to state/);
  });

  it("prints every figure exactly as it was handed them, adding nothing up", () => {
    const html = plain(buildMeasureAnnualStatementHtml(statementData()));

    // THE TOTALS. Each is a string the ledgers produced.
    expect(html).toContain("USD 9,812,340.17");
    expect(html).toContain("USD 2,250,000.50");
    expect(html).toContain("USD 1,200,000.00");

    // THE PARTS, which do not reconcile with the totals and must survive
    // unchanged anyway. 1,905,686.71 + 952,843.35 = 2,858,530.06 — a figure
    // that must appear NOWHERE, because nothing here may add its own lines.
    expect(html).toContain("USD 1,905,686.71");
    expect(html).toContain("USD 952,843.35");
    expect(html).not.toContain("2,858,530.06");
    expect(html).not.toContain("1,905,686.72");
  });

  it("carries every coverage sentence beside its figure", () => {
    const html = plain(buildMeasureAnnualStatementHtml(statementData()));

    expect(html).toContain("Adds up the 2 reporting periods the agency has recorded a receipt for.");
    expect(html).toContain("Adds up the 3 claims that have been filed and not taken back.");
    expect(html).toContain("Adds up the 1 claim the agency has recorded as paid.");
    // And the floor flag on the one figure that is a lower bound.
    expect(html).toContain("At least this much");
  });

  it("labels a hand-entered category and only a hand-entered one", () => {
    const html = plain(buildMeasureAnnualStatementHtml(statementData()));

    const transitRow = html.slice(html.indexOf("Transit service"), html.indexOf("USD 750,000.50"));
    expect(transitRow).toContain("Entered by staff");

    const streetsRow = html.slice(
      html.indexOf("Local streets and roads"),
      html.indexOf("USD 1,500,000.00")
    );
    expect(streetsRow).not.toContain("Entered by staff");
  });

  /* ---------------- what the ordinance took out before the rest was divided ---------------- */

  /**
   * THE DEFECT THIS SECTION CLOSES, on the surface that gets filed.
   *
   * The statement printed received, asked for, paid out and the category table
   * and nothing about the amount in between, so a committee member doing the
   * obvious subtraction on a document in their own packet found money with
   * nothing on the page to say where it had gone.
   */
  it("prints the whole chain — received, what was taken out, what was kept back, and what was left", () => {
    const html = plain(buildMeasureAnnualStatementHtml(statementData()));

    expect(html).toContain(MEASURE_OVERSIGHT_COPY.divisionHeading);
    for (const heading of [
      MEASURE_OVERSIGHT_COPY.divisionReceivedHeading,
      MEASURE_OVERSIGHT_COPY.divisionTakenOutHeading,
      MEASURE_OVERSIGHT_COPY.divisionHeldBackHeading,
      MEASURE_OVERSIGHT_COPY.divisionLeftHeading,
    ]) {
      expect(html, `the chain is missing "${heading}"`).toContain(heading);
    }

    // The four amounts, exactly as given:
    // 9,812,340.17 − 98,123.40 − 196,246.80 = 9,517,969.97.
    expect(html).toContain("USD 98,123.40");
    expect(html).toContain("USD 196,246.80");
    expect(html).toContain("USD 9,517,969.97");

    // The middle figure is the one that was missing, so it must sit BEFORE the
    // ordinance's own table — a reader who reaches the purposes first has
    // already done the subtraction that does not come out.
    expect(html.indexOf(MEASURE_OVERSIGHT_COPY.divisionTakenOutHeading)).toBeLessThan(
      html.indexOf(MEASURE_OVERSIGHT_COPY.ordinanceHeading)
    );
  });

  it("carries the coverage sentence on every figure in the chain, not just the headline totals", () => {
    const html = plain(buildMeasureAnnualStatementHtml(statementData()));

    expect(html).toContain(
      "Adds up what the fund received in the 2 reporting periods this measure has divided up"
    );
    expect(html).toContain("Adds up what the ordinance took out of the 2 reporting periods");
    expect(html).toContain("Adds up what the ordinance kept back in reserve out of the 2 reporting periods");
    expect(html).toContain("This is the amount the purposes below were given.");
  });

  it("names each clause of the ordinance and what the ordinance says about it", () => {
    const html = plain(buildMeasureAnnualStatementHtml(statementData()));

    expect(html).toContain("Running the programme");
    expect(html).toContain("Checking how the money is spent");
    expect(html).toContain("USD 12,000.00");
    // A clause where a limit bit says so. Printing only what was taken cannot
    // tell a committee that the ordinance's own working called for more.
    // HTML-escaped on the way out, like every other apostrophe in this document.
    expect(html).toContain("The ordinance&#39;s own working came to USD 100,000.00");
    expect(html).toContain("because the ordinance sets a limit on it");
  });

  /**
   * THE RESERVE TABLE, and the column that is its whole reason for existing.
   *
   * A reserve held out of ONE purpose and a reserve held out of the whole
   * payment print the same amount and mean different things: the first changes
   * what a single heading below was given, the second changes what all of them
   * were given together. A document that dropped "kept back out of" would leave
   * a committee unable to tell them apart.
   */
  it("names each reserve, what it was kept out of, and the rate the ordinance sets", () => {
    const html = plain(buildMeasureAnnualStatementHtml(statementData()));

    expect(html).toContain(MEASURE_OVERSIGHT_COPY.divisionReserveClauseColumn);
    expect(html).toContain(MEASURE_OVERSIGHT_COPY.divisionReserveAmountColumn);
    expect(html).toContain(MEASURE_OVERSIGHT_COPY.divisionReserveSourceColumn);

    expect(html).toContain("Rainy-day fund");
    expect(html).toContain("USD 96,246.80");
    expect(html).toContain("Everything that came in");
    expect(html).toContain("The ordinance sets this at 2% of USD 4,812,340.17.");

    expect(html).toContain("Bus replacement fund");
    expect(html).toContain("USD 100,000.00");
    expect(html).toContain("Transit service");
  });

  it("ends the section with the settlement sentence, printed as given", () => {
    const html = plain(buildMeasureAnnualStatementHtml(statementData()));

    expect(html).toContain(
      "The purposes below add up to USD 3,101,777.44, which is USD 6,416,192.53 less than the amount left for them."
    );
    // THE SENTENCE THAT MUST NOT COME BACK. Before reserves were persisted the
    // shared builder had to offer a held-back reserve as a cause of every
    // shortfall — a cause it could neither show nor rule out. It shows them
    // now, so a document still saying "this page does not yet show what was
    // held back" would be describing a gap that has been closed.
    expect(html).not.toContain("Some ordinances hold an amount back in reserve");
    expect(html).not.toContain("does not yet show what was held back");
    // The refusal to call a difference money gone astray survives.
    expect(html).toContain("rather than as money that has gone astray");
  });

  /**
   * THE ONE THING THIS DOCUMENT SAYS THAT THE PAGE DOES NOT.
   *
   * The shared builder's coverage sentences speak of "the periods this measure
   * has divided up", which on the public page means the fund's whole history
   * and here means one year of it. Left unsaid, a committee holding four annual
   * statements would read four separate lifetimes.
   */
  it("says the section covers one fiscal year, before any figure in it", () => {
    const html = plain(buildMeasureAnnualStatementHtml(statementData()));
    const scope = statementDivisionScopeSentence("FY 2026");

    expect(scope).toContain("limited to FY 2026");
    expect(html).toContain("Everything in this section is limited to FY 2026.");
    expect(html.indexOf("limited to FY 2026")).toBeLessThan(
      html.indexOf(MEASURE_OVERSIGHT_COPY.divisionReceivedHeading)
    );
    // The year travels with it — a hardcoded label would say FY 2026 on every
    // statement the fund ever produces.
    expect(statementDivisionScopeSentence("FY 2031")).toContain("limited to FY 2031");
  });

  it("prints the ordinance's own sentence when no period has been divided up, not a row of zeros", () => {
    const html = plain(
      buildMeasureAnnualStatementHtml(
        statementData({
          division: {
            kind: "none",
            sentence:
              "No reporting period has been divided up under the ordinance yet, so nothing has been taken " +
              "out of this measure and nothing has been set aside for the purposes below.",
          },
        })
      )
    );

    expect(html).toContain("No reporting period has been divided up under the ordinance yet");
    // The scope sentence still frames it, so "yet" is read against one year.
    expect(html).toContain("Everything in this section is limited to FY 2026.");
    // And no chain of zeros beside it.
    expect(html).not.toContain(MEASURE_OVERSIGHT_COPY.divisionLeftHeading);
  });

  it("prints the ordinance-took-nothing sentence instead of an empty clause table", () => {
    const html = plain(
      buildMeasureAnnualStatementHtml(
        statementData({
          division: divisionValue({
            clauses: [],
            noClausesSentence:
              "The ordinance took nothing out of these periods before the rest was divided.",
          }),
        })
      )
    );

    expect(html).toContain("The ordinance took nothing out of these periods before the rest was divided.");
    expect(html).not.toContain(MEASURE_OVERSIGHT_COPY.divisionClauseColumn);
    // The chain is still printed — "nothing was taken" is a figure of zero with
    // a sentence, not a section that disappears.
    expect(html).toContain(MEASURE_OVERSIGHT_COPY.divisionTakenOutHeading);
    // And the reserve table is untouched by the clause table's emptiness: the
    // two are separate facts and an ordinance can have one and not the other.
    expect(html).toContain(MEASURE_OVERSIGHT_COPY.divisionReserveClauseColumn);
  });

  it("prints the kept-nothing-back sentence instead of an empty reserve table", () => {
    const html = plain(
      buildMeasureAnnualStatementHtml(
        statementData({
          division: divisionValue({
            reserves: [],
            noReservesSentence: "The ordinance kept nothing back in reserve out of these periods.",
          }),
        })
      )
    );

    expect(html).toContain("The ordinance kept nothing back in reserve out of these periods.");
    expect(html).not.toContain(MEASURE_OVERSIGHT_COPY.divisionReserveClauseColumn);
    // The chain still carries the figure — a reserve of zero is a fact with a
    // sentence, not a heading that vanishes — and the clause table is untouched.
    expect(html).toContain(MEASURE_OVERSIGHT_COPY.divisionHeldBackHeading);
    expect(html).toContain(MEASURE_OVERSIGHT_COPY.divisionClauseColumn);
  });

  it("prints not-determined where one side of a commitment is absent, never a zero", () => {
    const html = plain(buildMeasureAnnualStatementHtml(statementData()));

    const districtRow = html.slice(html.indexOf("Example Valley Transit District"));
    expect(districtRow).toContain("Not enough recorded to say");
    expect(districtRow).toContain("The recipient has not reported its own spending for this year.");
    expect(districtRow).toContain("Not recorded");
    expect(districtRow).not.toContain("more than required");

    // The comparable row DOES resolve, in the direction the ledger decided.
    expect(html).toContain("Spent USD 35,000.00 less than required");
  });

  it("says it is not an audited financial statement, in the body and in the footer", () => {
    const html = plain(buildMeasureAnnualStatementHtml(statementData()));

    // The note reaches the page HTML-escaped (it contains an apostrophe), so
    // the assertion is on the apostrophe-free head of it plus the escaped tail.
    expect(html).toContain(
      "Prepared by OpenPlan from the records this agency has entered. It is not an audited financial statement"
    );
    expect(html).toContain("it is not the agency&#39;s official accounting");
    expect(html).toContain(STATEMENT_FOOTER_NOTE);
    expect(STATEMENT_PREPARED_NOTE).toContain("not an audited financial statement");
    // The short form exists BECAUSE a fixed footer only repeats under Chrome —
    // it must therefore be a distinct string that also carries the disclaimer.
    expect(STATEMENT_FOOTER_NOTE).not.toBe(STATEMENT_PREPARED_NOTE);
    expect(STATEMENT_FOOTER_NOTE).toContain("Not an audited financial statement");
  });

  it("is not indexable and escapes text a person typed", () => {
    const html = buildMeasureAnnualStatementHtml(
      statementData({ measureTitle: 'Measure "A" <script>alert(1)</script>' })
    );

    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  /**
   * THE SAME LIST THE PUBLIC PAGE IS HELD TO, and it was NOT the same list.
   *
   * Until 2026-08-12 this checked four terms where `measure-oversight-public-
   * page.test.tsx` checks seven, and the three it was missing — "off the top"
   * unhyphenated, "allocable", "descriptor" — are precisely the words that
   * appear in the section this document just gained. "Off the top" is what
   * every module in this lane calls that amount, which is exactly why a
   * committee member may never read it.
   */
  const RESIDENT_JARGON = [
    "off the top",
    "off-the-top",
    "apportionment",
    "apportionment basis",
    "sub-recipient",
    "allocable",
    "residual",
    "computation basis",
    "descriptor",
    "maintenance of effort",
  ];

  it("does not speak to staff", () => {
    const html = plain(buildMeasureAnnualStatementHtml(statementData())).toLowerCase();
    for (const jargon of RESIDENT_JARGON) {
      expect(html, `the statement must not say "${jargon}"`).not.toContain(jargon);
    }
  });

  it("keeps the same words out of the section a year with nothing divided up produces", () => {
    // The empty-division branch has its own copy and would otherwise be checked
    // by nothing — the sentence a reader gets when the ordinance has not been
    // applied to a single period of the year they asked for.
    const html = plain(
      buildMeasureAnnualStatementHtml(
        statementData({
          division: { kind: "none", sentence: "No reporting period has been divided up under the ordinance yet." },
        })
      )
    ).toLowerCase();
    for (const jargon of RESIDENT_JARGON) {
      expect(html, `the statement must not say "${jargon}"`).not.toContain(jargon);
    }
  });

  /**
   * THE PUBLIC CLAIM BOUNDARY, on a surface no derived guard could see.
   *
   * `public-page-claims-guardrails.test.ts` walks `src/app/(public)` and the
   * modules those pages import. This document is served from
   * `src/app/api/measures/[measureId]/statement/route.ts`, so neither the route
   * nor `oversight-statement.ts` was in that corpus — a whole committee-facing
   * document, with the same reader and the same money, outside the net. The
   * guard now derives HTML-serving API routes too; this is the deep net over
   * the rendered output, which also covers the sentences assembled at runtime.
   */
  it("makes no audited, official, certified or final claim about the figures it prints", () => {
    const html = plain(buildMeasureAnnualStatementHtml(statementData()));
    const scanned = sourceWithoutExplicitCaveats(html);

    for (const { label, pattern } of PROHIBITED_PUBLIC_CLAIMS) {
      expect(scanned, `the rendered statement makes a prohibited claim: ${label}`).not.toMatch(pattern);
    }
    // The caveat the guard above must never make anyone delete.
    expect(html).toContain("not an audited financial statement");
  });
});

/**
 * ============================================================================
 * MUTATION LOG — recorded after a GREEN BASELINE and a NEGATIVE CONTROL.
 * ============================================================================
 *
 * BASELINE: 11 passed before any mutation.
 * NEGATIVE CONTROL: a semantically neutral edit inside
 * `statementCoverageSentence` (`coverage.periodsIncluded` ->
 * `coverage.periodsIncluded.slice()`) left it green, so a pass here is
 * distinguishable from a failure. A lane last cycle reported 18/18 killed from
 * a runner that always exited 1; this is the check that rules that out.
 *
 * Applied to the source, RUN, and reverted:
 *
 *  S1 `assertStatementCoverage` removed -> the empty-year case builds a
 *     document with an agency's name and nothing behind it. 1 failed.
 *  S2 the unreported-periods clause dropped from `statementCoverageSentence`
 *     -> 2 failed. This is the partial-year defect made executable.
 *  S3 the coverage paragraph moved BELOW the first figure -> the `indexOf`
 *     ordering assertion fails. A caveat under the number is one most readers
 *     never reach.
 *  S4 `figureBlock` stops rendering `figure.coverageSentence` -> 1 failed.
 *  S5 `figureBlock` ignores `isFloor` -> 'At least this much' absent.
 *  S6 `categoriesSection` ignores `isStaffEntered` -> the transit row loses
 *     its badge.
 *  S7 the not-determined branch removed from `moeSection` -> the district row
 *     prints 'more than required' against an absent figure.
 *  S8 `esc` dropped from the document title -> the raw script tag reaches the
 *     output.
 *  S9 NEUTRAL, predicted as such BEFORE it was run, and SURVIVED: swapping the
 *     recipients and maintenance-of-effort sections changed nothing this file
 *     asserts. That is the correct outcome — section order is not a property
 *     worth pinning, and saying so is more useful than inventing an assertion
 *     to make a mutation die.
 *
 * 8 real mutations, 8 killed; 1 declared-neutral mutation, survived as
 * predicted.
 *
 * ============================================================================
 * SECOND ROUND — 2026-08-12, the division section
 * ============================================================================
 *
 * BASELINE: 392 passed across this file, the route file, the public page and
 * the claim guard. NEGATIVE CONTROL: a throwaway `expect(received).toBe(1)` in
 * the route file's reconciliation test exited 1; removing it exited 0, so a
 * pass here is distinguishable from a runner that cannot fail.
 *
 *  S10 `${divisionSection(data)}` removed from the document — the statement as
 *      it stood before this change. 12 failed across the four files. This is
 *      the defect made executable.
 *  S11 `figureBody` stops rendering `figure.coverageSentence`. 4 failed,
 *      including the chain's own three figures — the proof that splitting the
 *      body out of `figureBlock` did not give the chain a second renderer that
 *      could lose the sentence.
 *  S12 the clause's `noteSentence` replaced with a dash. 1 failed: a document
 *      printing what was taken but not that a limit bit cannot tell a committee
 *      the ordinance's own working called for more.
 *  S13 `noClausesSentence` ignored and the clause table always rendered. 1
 *      failed — an empty table where a sentence should say the ordinance took
 *      nothing.
 *  S14 `statementDivisionScopeSentence` hardcodes "FY 2026". 1 failed. Every
 *      statement the fund ever produced would have named the same year.
 *  S15 the scope sentence rendered after the chain instead of before it. 3
 *      failed. A caveat under the number is one most readers never reach.
 *  S16 NEUTRAL, predicted before running and SURVIVED: renaming
 *      `divisionSection`'s local `head`. Nothing here pins an identifier.
 *
 * 6 real mutations, 6 killed; 1 declared-neutral, survived as predicted.
 */

// @vitest-environment node
/**
 * THE ATP EQUITY APPENDIX SAYS WHAT ITS NUMBERS COUNT (KI-2026-11-16-111).
 *
 * A recorded ATP application PDF for a real tribal area printed "Low-income
 * tracts (ACS proxy): 0", "Tracts the ACS income and burden proxy flags: 0"
 * and an equity screening score of 0.0, with nothing saying that the proxy
 * calls a tract low-income below a fixed median household income or what the
 * score adds up. A reader could take the zeros as a finding about the people
 * who live there. The appendix now prints each count with the total it is out
 * of and its rule, says what the score adds up and what a low value means,
 * and says the Guidelines use their own threshold.
 *
 * These tests build the application document with the product's own builder
 * and read the text the built-in PDF tier extracts from it. The thresholds
 * and weights are changed through the test, on the objects the calculation
 * reads, so a line that prints a fixed number cannot pass and a line that
 * drifts from the calculation cannot pass either.
 *
 * Blind category: where a line wraps in Chrome's PDF, and whether the third
 * proven job's checker accepts that PDF. The second is the business of
 * proven-job-atp-application-real-pdf-with-tract-data.test.ts. Also blind:
 * whether the proxy's lines are the right lines. These tests hold the words
 * to the code, not the code to planning practice.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  EQUITY_PROXY_THRESHOLDS,
  EQUITY_SCORE_WEIGHTS,
  evaluateProxyDisadvantage,
  screenEquity,
} from "@/lib/data-sources/equity";
import { proxyEquityNarrativeLine } from "@/lib/data-sources/equity-designation/disclosure";
import { buildGrantApplicationHtml } from "@/lib/grants/application-html";
import {
  ATP_APPENDIX_FRAME,
  ATP_EQUITY_SCORE_MEANING_LABEL,
  ATP_PROXY_IS_NOT_THE_GUIDELINES_NOTE,
  atpCoverLines,
  buildAtpEvidenceAppendices,
  type AtpAppendix,
  type AtpEvidenceRecords,
} from "@/lib/grants/atp-evidence-appendices";
import { ATP_APPENDIX_KEYS } from "@/lib/grants/evidence-appendix-keys";
import { htmlToPdfBlocks } from "@/lib/reports/pdf-text";
import { pdfTextHasPhrase } from "../../scripts/lib/pdf-text-match.mjs";
import { ATP_GENERATED_AT, ATP_IDS, atpProject, atpRun, atpRunMetrics, completeAtpRecords } from "./fixtures/grants/atp-evidence";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the job definition is untyped JSON
type Json = any;
const DEFINITIONS: Json = JSON.parse(readFileSync(fileURLToPath(new URL("../../../schemas/proven_job_definitions.v1.json", import.meta.url)), "utf8"));
const RULE: Json = DEFINITIONS.jobs.find((job: Json) => job.id === "california-atp-application-in-three-places").application;

const SCORE_LABEL = "Equity screening score (OpenPlan, not a CTC score)";
const FLAGGED_LABEL = "Tracts the ACS income and burden proxy flags";
const LOW_INCOME_LABEL = "Low-income tracts (ACS proxy)";
const E_HEADING = "Appendix E. Disadvantaged-community and equity inputs";

// The calculation's own objects. `as const` makes them read-only to the
// compiler only, so a test can move a line and watch both the calculation and
// the printed words follow. Put back after every test.
type Loose<T> = { -readonly [K in keyof T]: number };
const thresholds = EQUITY_PROXY_THRESHOLDS as Loose<typeof EQUITY_PROXY_THRESHOLDS>;
const weights = EQUITY_SCORE_WEIGHTS as Loose<typeof EQUITY_SCORE_WEIGHTS>;
const ORIGINAL_THRESHOLDS = { ...EQUITY_PROXY_THRESHOLDS };
const ORIGINAL_WEIGHTS = { ...EQUITY_SCORE_WEIGHTS };
afterEach(() => {
  Object.assign(thresholds, ORIGINAL_THRESHOLDS);
  Object.assign(weights, ORIGINAL_WEIGHTS);
});

const CRASH_SNAPSHOT = { label: "California Crash Reporting System (CCRS)", yearsQueried: [2022, 2023, 2024, 2025], fetchedAt: "2026-11-02T03:40:33.341Z" };
const TRIBAL_PLACE = { place_source: "tigerweb", place_kind: "aiannh", place_ref: "9998R", place_label: "Synthetic Reservation, CA" };

/** A run that retrieved tract data: the counts, the total and a printed equity score. */
function retrieved(tracts: number, flagged: number, lowIncome: number, score = 0): Record<string, unknown> {
  return atpRunMetrics({
    equityScore: score,
    scorePresentation: {
      safety: { value: 60, eligible: true, withheldReason: null },
      equity: { value: score, eligible: true, withheldReason: null },
    },
    dataQuality: { censusAvailable: true, crashDataAvailable: true, crashDataComplete: true },
    tractCount: tracts,
    disadvantagedTracts: flagged,
    lowIncomeTracts: lowIncome,
    sourceSnapshots: { crashes: CRASH_SNAPSHOT, census: { dataset: "ACS 5-Year", vintage: 2023, tractCount: tracts, clipScale: "corridor" } },
  });
}

function recordsFor(metrics: Record<string, unknown>, project: Record<string, unknown> = {}): AtpEvidenceRecords {
  return {
    ...completeAtpRecords(),
    project: { status: "ready", project: atpProject(project) },
    run: { status: "ready", run: atpRun({ metrics }) },
  };
}

function appendices(records: AtpEvidenceRecords): AtpAppendix[] {
  return buildAtpEvidenceAppendices(records, new Set<string>(ATP_APPENDIX_KEYS));
}

/** The whole application document as the built-in PDF tier reads it, one block a line. */
function documentText(records: AtpEvidenceRecords): string {
  const html = buildGrantApplicationHtml({
    opportunity: { id: ATP_IDS.opportunity, title: "ATP application", agency_name: null, summary: null, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
    programTitle: null, sections: [], attachments: [], generatedAt: ATP_GENERATED_AT,
    evidenceAppendices: appendices(records), evidenceAppendixFrame: ATP_APPENDIX_FRAME, coverLines: atpCoverLines(records.project),
  });
  return htmlToPdfBlocks(html).map((block) => ("text" in block ? block.text : JSON.stringify(block))).join("\n");
}

/** Appendix E's own lines: from its heading to the next appendix's. The index names the heading first, so take the last. */
function appendixE(text: string): string {
  const start = text.lastIndexOf(E_HEADING);
  const end = text.indexOf("Appendix F.", start);
  expect(start, "the document carries Appendix E").toBeGreaterThan(-1);
  expect(end, "Appendix F follows Appendix E").toBeGreaterThan(start);
  return text.slice(start, end);
}

function fact(appendix: AtpAppendix, label: string): string | undefined {
  return appendix.facts.find((entry) => entry.label === label)?.value;
}
const equityOf = (records: AtpEvidenceRecords) => appendices(records).find((appendix) => appendix.key === "equity")!;
const packetOf = (records: AtpEvidenceRecords) => appendices(records).find((appendix) => appendix.key === "scoring_packet")!;
const dollars = (value: number) => `$${value.toLocaleString("en-US")}`;

/** A tract for the calculation: median income and poverty rate given, nothing else over a line. */
function tract(geoid: string, medianIncome: number | null, pctBelowPoverty: number) {
  return { geoid, pctMinority: 0, pctBelowPoverty, medianIncome, zeroVehicleHouseholds: 0, totalHouseholds: 100, transitCommuters: 0, totalCommuters: 100 };
}
function screen(tracts: ReturnType<typeof tract>[]) {
  return screenEquity({ pctMinority: 0, pctBelowPoverty: 0, pctZeroVehicle: 0, pctTransit: 0, medianIncomeWeighted: null, tracts });
}

/**
 * The checker's score rule (capability-evidence.mjs), from the definition's
 * own words and labels: a label ending in "score", "scores" or "points", a
 * colon and a number must end one of the two labels OpenPlan prints.
 */
function unlabeledScores(text: string): string[] {
  const flat = text.replace(/\s+/g, " ");
  const words = (RULE.scores.words as string[]).join("|");
  const found: string[] = [];
  for (const match of flat.matchAll(new RegExp(`\\b(?:${words})\\)?\\s*:\\s*-?\\d`, "g"))) {
    const before = flat.slice(0, match.index + match[0].lastIndexOf(":")).trimEnd();
    if (!(RULE.scores.labels as string[]).some((label) => before.endsWith(label))) found.push(flat.slice(Math.max(0, match.index - 40), match.index + match[0].length));
  }
  return found;
}

describe("Appendix E prints each proxy count with its total and its rule", () => {
  it("names the income line in dollars and the total, for one tract", () => {
    const body = appendixE(documentText(recordsFor(retrieved(1, 0, 0), TRIBAL_PLACE)));
    const line = dollars(EQUITY_PROXY_THRESHOLDS.lowIncomeMedian);
    expect(body).toContain(
      `${LOW_INCOME_LABEL}: 0 of 1 tract. A tract counts as low-income here when the ACS reports a median household income for it below ${line}. A tract with no reported median is not counted.`
    );
    expect(body).toContain(
      `${FLAGGED_LABEL}: 0 of 1 tract. The proxy flags a tract when its median household income is below ${line} and at least one of these holds: ` +
        `a poverty rate of ${EQUITY_PROXY_THRESHOLDS.highPovertyPct} percent or more, a minority population share of ${EQUITY_PROXY_THRESHOLDS.highMinorityPct} percent or more, ` +
        `${EQUITY_PROXY_THRESHOLDS.lowVehicleAccessPct} percent or more of households without a vehicle, or ${EQUITY_PROXY_THRESHOLDS.transitDependencyPct} percent or more of commuters using transit.`
    );
  });

  it("moves the printed income line and the calculation together when the constant moves", () => {
    // A tract at $55,000 with a 35 percent poverty rate: over today's income line, under a line of $61,000.
    const between = tract("06000000100", 55_000, 35);
    expect(ORIGINAL_THRESHOLDS.lowIncomeMedian).toBeLessThan(55_000);
    expect(evaluateProxyDisadvantage(between)).toMatchObject({ lowIncome: false, disadvantaged: false });
    expect(screen([between])).toMatchObject({ lowIncomeTracts: 0, disadvantagedTracts: 0 });
    const before = appendixE(documentText(recordsFor(retrieved(1, 0, 0))));
    expect(before).toContain(`income for it below ${dollars(ORIGINAL_THRESHOLDS.lowIncomeMedian)}.`);

    thresholds.lowIncomeMedian = 61_000;

    expect(evaluateProxyDisadvantage(between)).toMatchObject({ lowIncome: true, disadvantaged: true });
    expect(screen([between])).toMatchObject({ lowIncomeTracts: 1, disadvantagedTracts: 1 });
    const after = appendixE(documentText(recordsFor(retrieved(1, 1, 1, 60))));
    expect(after).toContain(`${LOW_INCOME_LABEL}: 1 of 1 tract. A tract counts as low-income here when the ACS reports a median household income for it below $61,000.`);
    expect(after).toContain(`${FLAGGED_LABEL}: 1 of 1 tract. The proxy flags a tract when its median household income is below $61,000 and`);
    // The only dollar figure in the appendix is the proxy's own line, and the old one is gone.
    expect([...new Set(after.match(/\$[\d,.]*\d/g))]).toEqual(["$61,000"]);
  });

  it("moves each printed burden line with the calculation", () => {
    const poor = tract("06000000200", 30_000, 31);
    expect(evaluateProxyDisadvantage(poor).highPoverty).toBe(true);
    Object.assign(thresholds, { highPovertyPct: 33, highMinorityPct: 55, lowVehicleAccessPct: 12, transitDependencyPct: 17 });
    expect(evaluateProxyDisadvantage(poor).highPoverty).toBe(false);
    const body = appendixE(documentText(recordsFor(retrieved(3, 1, 2, 20))));
    expect(body).toContain(
      "at least one of these holds: a poverty rate of 33 percent or more, a minority population share of 55 percent or more, 12 percent or more of households without a vehicle, or 17 percent or more of commuters using transit."
    );
    // The score's own sentence names the same three lines it counts.
    expect(body).toContain("of the share with a poverty rate of 33 percent or more,");
    expect(body).toContain("of the share with 12 percent or more of households without a vehicle, and");
    expect(body).toContain("of the share with 17 percent or more of commuters using transit.");
  });

  it("does not count a tract with no reported median as low-income, as the line says", () => {
    expect(evaluateProxyDisadvantage(tract("06000000300", null, 60))).toMatchObject({ lowIncome: false, disadvantaged: false });
  });

  it("writes 1 tract and 2 tracts", () => {
    const one = documentText(recordsFor(retrieved(1, 1, 1, 40)));
    expect(appendixE(one)).toContain("Demographic source: ACS 5-Year 2023, 1 tract, clipped to the corridor");
    expect(appendixE(one)).toContain(`${FLAGGED_LABEL}: 1 of 1 tract. `);
    expect(one).not.toMatch(/\b1 tracts\b/);

    const two = documentText(recordsFor(retrieved(2, 1, 2, 40)));
    expect(appendixE(two)).toContain("Demographic source: ACS 5-Year 2023, 2 tracts, clipped to the corridor");
    expect(appendixE(two)).toContain(`${FLAGGED_LABEL}: 1 of 2 tracts. `);
    expect(appendixE(two)).toContain(`${LOW_INCOME_LABEL}: 2 of 2 tracts. `);
    expect(two).not.toMatch(/\b2 tract\b(?!s)/);

    const many = appendixE(documentText(recordsFor(retrieved(1204, 3, 5, 12))));
    expect(many).toContain("Demographic source: ACS 5-Year 2023, 1,204 tracts, clipped to the corridor");
    expect(many).toContain(`${FLAGGED_LABEL}: 3 of 1,204 tracts. `);
  });

  it("prints a count without a total when the run stored none, and never a made-up one", () => {
    const metrics = retrieved(4, 1, 2, 10);
    delete metrics.tractCount;
    (metrics.sourceSnapshots as { census: Record<string, unknown> }).census = { dataset: "ACS 5-Year", vintage: 2023, clipScale: "corridor" };
    const equity = equityOf(recordsFor(metrics));
    expect(fact(equity, FLAGGED_LABEL)).toMatch(/^1\. The proxy flags a tract when /);
    expect(fact(equity, LOW_INCOME_LABEL)).toMatch(/^2\. A tract counts as low-income here when /);
  });
});

describe("the same fault and the same numbers elsewhere", () => {
  it("writes a one-year benefit-cost horizon as 1 year in Appendix F", () => {
    const screening = (analysisHorizonYears: number) => ({
      id: "screening-1", projectId: ATP_IDS.project, netPresentValue: 1000, benefitCostRatio: 1.2, presentValueBenefits: 6000, presentValueCosts: 5000,
      analysisHorizonYears, discountRatePct: 3.1, baseYear: 2026, engineVersion: "openplan-bca-ts", createdAt: "2026-11-02T16:00:00+00:00",
    });
    const horizon = (years: number) =>
      fact(appendices({ ...completeAtpRecords(), bca: { status: "screening", screening: screening(years) } }).find((appendix) => appendix.key === "bca")!, "Analysis horizon");
    expect(horizon(1)).toBe("1 year");
    expect(horizon(20)).toBe("20 years");
  });

  it("keeps the corridor summary's proxy sentence on the calculation's numbers", () => {
    // That sentence is saved in each run's summary and cited by narratives, so its words stay as they
    // are. Its numbers are written out in it, not read from the constants: this holds the two together.
    const line = proxyEquityNarrativeLine({ disadvantagedTracts: 1, totalTracts: 4 });
    expect(line).toContain(
      `median household income <$${EQUITY_PROXY_THRESHOLDS.lowIncomeMedian / 1000}k plus at least one of: poverty ≥${EQUITY_PROXY_THRESHOLDS.highPovertyPct}%, ` +
        `minority ≥${EQUITY_PROXY_THRESHOLDS.highMinorityPct}%, zero-vehicle ≥${EQUITY_PROXY_THRESHOLDS.lowVehicleAccessPct}%, transit commute ≥${EQUITY_PROXY_THRESHOLDS.transitDependencyPct}%`
    );
  });
});

describe("the equity screening score says what it adds up and what a low value means", () => {
  it("prints the meaning directly under the score in Appendix E and as a note in Appendix A", () => {
    const records = recordsFor(retrieved(1, 0, 0, 0), TRIBAL_PLACE);
    const equity = equityOf(records);
    const labels = equity.facts.map((entry) => entry.label);
    expect(labels.indexOf(ATP_EQUITY_SCORE_MEANING_LABEL)).toBe(labels.indexOf(SCORE_LABEL) + 1);
    const meaning = fact(equity, ATP_EQUITY_SCORE_MEANING_LABEL)!;
    expect(meaning).toBe(
      "The equity screening score adds four shares of the run's tracts: 40 percent of the share the ACS proxy flags, " +
        "20 percent of the share with a poverty rate of 30 percent or more, 20 percent of the share with 10 percent or more of households without a vehicle, " +
        "and 20 percent of the share with 15 percent or more of commuters using transit. " +
        "A low score means few tracts met those fixed lines. It is not a finding that no disadvantaged community is present."
    );
    expect(packetOf(records).notes).toContain(meaning);
    const text = documentText(records);
    expect(appendixE(text)).toContain(`${SCORE_LABEL}: 0.0\n${ATP_EQUITY_SCORE_MEANING_LABEL}: ${meaning}`);
  });

  it("moves the printed weights and the score together when the weights move", () => {
    // Two tracts, one flagged for its poverty rate alone: half the tracts flagged, half over the poverty line.
    const tracts = [tract("06000000400", 30_000, 40), tract("06000000500", 90_000, 5)];
    expect(screen(tracts).equityScore).toBe(30); // 50 x 0.4 + 50 x 0.2
    Object.assign(weights, { proxyFlagged: 0.7, highPoverty: 0.1, lowVehicleAccess: 0.15, highTransitDependency: 0.05 });
    expect(screen(tracts).equityScore).toBe(40); // 50 x 0.7 + 50 x 0.1
    const meaning = fact(equityOf(recordsFor(retrieved(2, 1, 1, 40))), ATP_EQUITY_SCORE_MEANING_LABEL)!;
    expect(meaning).toContain("70 percent of the share the ACS proxy flags, 10 percent of the share with a poverty rate");
    expect(meaning).toContain("15 percent of the share with 10 percent or more of households without a vehicle, and 5 percent of the share with 15 percent or more of commuters using transit.");
  });

  it("leaves the meaning out where no score prints", () => {
    // The fixture's own run: Census inputs unavailable, so the score is withheld.
    const records = completeAtpRecords();
    const equity = equityOf(records);
    expect(fact(equity, SCORE_LABEL)).toMatch(/^Not recorded\./);
    expect(fact(equity, ATP_EQUITY_SCORE_MEANING_LABEL)).toBeUndefined();
    expect(packetOf(records).notes.join(" ")).not.toContain("adds four shares");
    expect(documentText(records)).not.toContain("A low score means");
  });

  it("uses a label that cannot read as a second score", () => {
    expect(ATP_EQUITY_SCORE_MEANING_LABEL).not.toMatch(/(score|scores|points)\)?$/i);
  });
});

describe("the note says the proxy is not the Guidelines' test, with no figure that goes stale", () => {
  it("points to the Guidelines' section and prints no dollar amount or year of its own", () => {
    const equity = equityOf(recordsFor(retrieved(1, 0, 0), TRIBAL_PLACE));
    expect(equity.notes.at(-1)).toBe(ATP_PROXY_IS_NOT_THE_GUIDELINES_NOTE);
    expect(ATP_PROXY_IS_NOT_THE_GUIDELINES_NOTE).toContain("The Guidelines use their own income threshold and Census data years, set for each cycle and stated in section 12.A, Disadvantaged Communities.");
    expect(ATP_PROXY_IS_NOT_THE_GUIDELINES_NOTE).toContain("A count of zero here does not show that an area fails a criterion of the Guidelines, and a flagged tract does not show that it meets one.");
    expect(ATP_PROXY_IS_NOT_THE_GUIDELINES_NOTE).not.toMatch(/\$|\d{4}|percent|%/);
  });
});

describe("the lines the third proven job's checker reads still print, each in its own case", () => {
  const equityRule = RULE.appendices.equity;
  const otherSentences = (value: string): string[] =>
    Object.entries<{ sentences: string[] }>(equityRule.values).filter(([key]) => key !== value).flatMap(([, entry]) => entry.sentences);

  it("retrieved: the Demographic source line, and neither other case's sentence", () => {
    for (const metrics of [retrieved(1, 0, 0), retrieved(9, 3, 5, 22)]) {
      const body = appendixE(documentText(recordsFor(metrics, TRIBAL_PLACE)));
      expect(pdfTextHasPhrase(body, equityRule.label)).toBe(true);
      expect(equityRule.values.retrieved.sentences).toEqual([]);
      for (const sentence of otherSentences("retrieved")) expect(pdfTextHasPhrase(body, sentence), sentence).toBe(false);
    }
  });

  it("none retrieved: its sentence, no count, no rule and no score meaning", () => {
    const metrics = atpRunMetrics({ sourceSnapshots: { crashes: CRASH_SNAPSHOT, census: { dataset: "ACS 5-Year", vintage: 2023, tractCount: 0, clipScale: "county" } } });
    const body = appendixE(documentText(recordsFor(metrics)));
    expect(body).toContain("Demographic source: ACS 5-Year 2023: no tract data was retrieved for this run");
    for (const sentence of equityRule.values["none-retrieved"].sentences) expect(pdfTextHasPhrase(body, sentence), sentence).toBe(true);
    for (const sentence of otherSentences("none-retrieved")) expect(pdfTextHasPhrase(body, sentence), sentence).toBe(false);
    expect(body).toContain(`${FLAGGED_LABEL}: Not recorded\n`);
    expect(body).toContain(`${LOW_INCOME_LABEL}: Not recorded\n`);
    expect(body).not.toContain("The proxy flags a tract when");
    expect(body).not.toContain(ATP_EQUITY_SCORE_MEANING_LABEL);
  });

  it("not recorded: one of its two sentences, in each of the two shapes a run leaves", () => {
    const [noCensusRecord, availabilityUnsaid] = equityRule.values["not-recorded"].sentences as string[];
    const without = appendixE(documentText(recordsFor(atpRunMetrics())));
    expect(without).toContain("Demographic source: Not recorded in the analysis run");
    expect(pdfTextHasPhrase(without, noCensusRecord)).toBe(true);

    const unsaid = appendixE(documentText(recordsFor(atpRunMetrics({
      dataQuality: { crashDataAvailable: true, crashDataComplete: true },
      scorePresentation: undefined,
      sourceSnapshots: { crashes: CRASH_SNAPSHOT, census: { dataset: "ACS 5-Year", vintage: 2023, tractCount: 4 } },
    }))));
    expect(pdfTextHasPhrase(unsaid, availabilityUnsaid)).toBe(true);
    for (const body of [without, unsaid]) {
      for (const sentence of otherSentences("not-recorded")) expect(pdfTextHasPhrase(body, sentence), sentence).toBe(false);
      expect(body).toContain(`${FLAGGED_LABEL}: Not recorded\n`);
    }
  });
});

describe("nothing added states a determination or reads as another score", () => {
  const documents = () => [
    documentText(recordsFor(retrieved(1, 0, 0, 0), TRIBAL_PLACE)),
    documentText(recordsFor(retrieved(9, 3, 5, 22))),
    documentText(completeAtpRecords()),
  ];

  it("prints none of the phrases the third proven job refuses", () => {
    for (const text of documents()) {
      for (const phrase of RULE.refusedPhrases.phrases as string[]) expect(pdfTextHasPhrase(text, phrase), phrase).toBe(false);
    }
  });

  it("prints no number under a score label other than the two OpenPlan uses", () => {
    for (const text of documents()) expect(unlabeledScores(text)).toEqual([]);
    // The check can fail: the same document with one unlabeled score in it.
    expect(unlabeledScores(`${documents()[0]}\nEquity score: 0`)).toHaveLength(1);
  });

  it("adds no row under the Guidelines criterion label", () => {
    const equity = equityOf(recordsFor(retrieved(1, 0, 0), TRIBAL_PLACE));
    const text = [...equity.facts.map((entry) => entry.value), ...equity.notes].join("\n");
    // Six rows, the Guidelines' six. A sentence that held the row label could wrap to open a line with it.
    expect(equity.facts.filter((entry) => entry.label.startsWith(RULE.appendices.list.find((item: Json) => item.item === "appendix-e").rowLabel))).toHaveLength(6);
    expect(text).not.toContain("Guidelines criterion,");
  });

  it("says nothing about the people of a Census tribal area beyond the counts and what they count", () => {
    const body = appendixE(documentText(recordsFor(retrieved(1, 0, 0, 0), TRIBAL_PLACE)));
    // The two disclaimers are the only sentences that put "disadvantaged" beside "is" or "no", and each denies a finding.
    const disclaimers = [
      "No row above is a determination that a community is disadvantaged or that the project benefits one.",
      "It is not a finding that no disadvantaged community is present.",
    ];
    let rest = body;
    for (const disclaimer of disclaimers) {
      expect(rest).toContain(disclaimer);
      rest = rest.replaceAll(disclaimer, "");
    }
    // No other sentence calls the place, its tracts or its residents low-income, poor or disadvantaged, or not.
    expect(rest).not.toMatch(/\b(is|are|is not|are not|has no|have no)\s+(a\s+)?(low-income|poor|disadvantaged|burdened)\b/i);
    expect(rest).not.toMatch(/\bno (low-income|disadvantaged) (tracts?|residents|households|community)\b/i);
    // The check can fail: a sentence of the kind the appendix must not print.
    expect(`${rest}\nThe study place has no low-income tracts.`).toMatch(/\bno (low-income|disadvantaged) (tracts?|residents|households|community)\b/i);
  });
});

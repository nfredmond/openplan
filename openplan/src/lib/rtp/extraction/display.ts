/**
 * THE WORDS. Everything a person reads about a transcribed figure — on the
 * review screen, beside a line in the plan's ledger, on the public plan page,
 * and in the board export body — is composed here.
 *
 * ONE HOME, because copy with two homes drifts, and this copy is a DISCLOSURE.
 * A chip that says "page 112" on the review screen and says nothing on the
 * public page is not a smaller disclosure; it is a different plan appearing in
 * two places. Nathaniel's Q2 decision of 2026-08-11 is that a transcribed
 * figure names its source document and page WHEREVER IT APPEARS, including the
 * body of the board export rather than an appendix.
 *
 * TWO AUDIENCES, ONE FACT. The planner reading the review screen and the
 * resident reading the published plan are told the same thing in different
 * words. The public wording carries no internal vocabulary — no "candidate",
 * no "extraction run", no "verifier", no instruction aimed at an operator —
 * because a resident reading a plan is not being asked to run anything.
 *
 * WHAT IS NEVER SAID HERE:
 *
 *   - No confidence, certainty, likelihood or quality score, in any wording, on
 *     any surface. A model scoring its own transcription is the model grading
 *     itself, and a reader who sees "97%" beside a figure stops reading the
 *     quote. What the reader gets instead is the page and the sentence, which
 *     they can check.
 *   - Nothing that implies the machine decided anything. Every figure carrying
 *     a chip was accepted by a person through the ordinary write route with the
 *     ordinary permission check.
 *   - No citation for a value that is no longer the document's. If a planner
 *     edited a figure after accepting it, the chip says so — see
 *     `transcriptionDivergence` in `reconcile.ts`. A citation that is quietly
 *     wrong is worse than no citation at all.
 */

import {
  RTP_EXTRACTION_TARGETS,
  type RtpExtractionTargetKind,
} from "./contract";
import type {
  CandidateReconciliation,
  ComparedValueKind,
  FieldComparison,
  ReconciliationRollup,
  ReconciliationVerdict,
} from "./reconcile";

// ---------------------------------------------------------------------------
// Values, written out.
// ---------------------------------------------------------------------------

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const PLAIN_NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

/**
 * ABSENT IS ITS OWN WORD, and it is never "0" and never blank. The RTP schema
 * is explicit that a missing cost means UNPRICED, a different answer from zero
 * (20260805000003), and a blank cell in a comparison reads as agreement.
 */
export const VALUE_NOT_STATED = "Not stated";

export function formatComparedValue(kind: ComparedValueKind, value: string | number | null): string {
  if (value === null || value === undefined || value === "") return VALUE_NOT_STATED;
  if (kind === "money") {
    return typeof value === "number" ? MONEY.format(value) : String(value);
  }
  if (kind === "year") {
    return String(value);
  }
  if (kind === "number") {
    return typeof value === "number" ? PLAIN_NUMBER.format(value) : String(value);
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Reconciliation, in planner words.
// ---------------------------------------------------------------------------

export type ReconciliationTone = "neutral" | "info" | "warning";

export type ReconciliationCopy = {
  /** The badge on the card. */
  label: string;
  tone: ReconciliationTone;
  /** One sentence under the badge, saying what accepting would do. */
  detail: string;
  /** Which action the card should put first. Never "accept" for a duplicate. */
  primaryAction: "accept" | "dismiss";
};

export const RECONCILIATION_COPY: Record<ReconciliationVerdict, ReconciliationCopy> = {
  new: {
    label: "Not in this plan yet",
    tone: "neutral",
    detail: "Nothing recorded in this plan matches this. Accepting it records something new.",
    primaryAction: "accept",
  },
  already_recorded: {
    label: "Already recorded",
    tone: "info",
    detail:
      "This plan already records the same values under the same name, so accepting would record the same thing twice. Set it aside unless you meant to add a second entry.",
    primaryAction: "dismiss",
  },
  conflicts: {
    label: "Disagrees with what you have",
    tone: "warning",
    detail:
      "This plan already records something under the same name, and the figures do not match. Both are shown below with the page the document states its figure on — decide which one this plan should carry.",
    primaryAction: "accept",
  },
};

/**
 * The review header's roll-up: "18 new · 6 already recorded · 3 conflict with
 * what you have".
 *
 * Zeroes are DROPPED rather than printed, except when everything is zero — a
 * header reading "0 conflict with what you have" invites a reader to skim past
 * the number rather than read it, and the count that matters is the one that is
 * not zero.
 */
export function describeReconciliationRollup(rollup: ReconciliationRollup): string {
  const parts: string[] = [];
  if (rollup.new > 0) parts.push(`${rollup.new} new`);
  if (rollup.already_recorded > 0) parts.push(`${rollup.already_recorded} already recorded`);
  if (rollup.conflicts > 0) {
    parts.push(
      `${rollup.conflicts} ${rollup.conflicts === 1 ? "conflicts" : "conflict"} with what you have`
    );
  }
  return parts.length > 0 ? parts.join(" · ") : "Nothing is waiting for review.";
}

/** The sentence a conflicting card puts above the two figures. */
export function describeConflict(reconciliation: CandidateReconciliation): string {
  if (reconciliation.verdict !== "conflicts") return "";
  const differing = reconciliation.matches
    .flatMap((match) => match.fields)
    .filter((field) => !field.same).length;
  return differing === 1
    ? "One value disagrees with what this plan records."
    : `${differing} values disagree with what this plan records.`;
}

// ---------------------------------------------------------------------------
// A run, in planner words.
// ---------------------------------------------------------------------------

export type ExtractionRunSummary = {
  status: string;
  candidateCount: number | null;
  discardedCount: number | null;
  failureReason: string | null;
};

/**
 * WHAT THIS READING OF THE DOCUMENT PRODUCED, INCLUDING WHAT IT THREW AWAY.
 *
 * The discard count is the load-bearing half. A header that showed only what
 * survived would present a clean-looking extraction and conceal how much of it
 * the model got wrong: "35 proposals" reads as a good reading of the document,
 * while "41 proposed; 6 dropped because their figures were not in the text they
 * cited" tells a planner what actually happened and why the six are not there.
 *
 * A dropped proposal is the feature working, and none of this apologises for
 * it.
 */
export function describeRunOutcome(run: ExtractionRunSummary): string {
  if (run.status === "failed") {
    return (
      run.failureReason?.trim() ||
      "This reading failed and the reason was not recorded, so nothing from it was kept."
    );
  }
  if (run.status === "running") {
    return "This document is being read now. Nothing from it is ready to review yet.";
  }

  const proposed = run.candidateCount ?? 0;
  const discarded = run.discardedCount ?? 0;
  const total = proposed + discarded;

  if (total === 0) {
    return "Nothing in this document matched what OpenPlan knows how to record. Nothing was dropped and nothing was proposed — this is not a finding that the document contains no figures.";
  }
  if (discarded === 0) {
    return `${proposed} ${proposed === 1 ? "proposal was" : "proposals were"} kept; none were dropped.`;
  }
  return `${total} proposed; ${discarded} dropped because ${
    discarded === 1 ? "its figures were" : "their figures were"
  } not in the text ${discarded === 1 ? "it" : "they"} cited.`;
}

// ---------------------------------------------------------------------------
// The Q5 blast radius.
// ---------------------------------------------------------------------------

/**
 * ACCEPTING THE PLAN'S DOLLAR YEAR CHANGES EVERY ESCALATED FIGURE IN THE PLAN,
 * and the reviewer is told so BEFORE the click (Nathaniel's Q5 decision,
 * 2026-08-11).
 *
 * `rtp_cycles.financial_basis_year` is not one more field: it is the year every
 * constant-dollar figure in the ledger is understood to be in, and the fiscal
 * engine escalates from it to each period's expenditure year. Changing it
 * re-derives the year-of-expenditure value of every line and every programmed
 * cost at once — silently, on the next page load, with no row visibly edited.
 * That is the widest single change this feature can make, and it is the one
 * that looks smallest on a card.
 */
export function describeCycleBasisBlastRadius(counts: {
  lineCount: number;
  programmedProjectCount: number;
  recordedBasisYear: number | null;
  proposedBasisYear: number | null;
}): string {
  const affected = counts.lineCount + counts.programmedProjectCount;
  const change =
    counts.recordedBasisYear === null
      ? `This plan has no dollar year recorded yet. Accepting ${
          counts.proposedBasisYear === null ? "this" : `${counts.proposedBasisYear}`
        } sets the year every constant-dollar figure in the plan is read in.`
      : `This plan currently reads its money in ${counts.recordedBasisYear} dollars. Accepting ${
          counts.proposedBasisYear === null ? "this" : `${counts.proposedBasisYear}`
        } changes that for the whole plan.`;

  if (affected === 0) {
    return `${change} Nothing is recorded against it yet, so no figure changes today — but every figure entered afterwards will be read in the new year.`;
  }

  return `${change} It re-derives the escalated value of ${affected} recorded ${
    affected === 1 ? "figure" : "figures"
  } — ${counts.lineCount} revenue and cost ${counts.lineCount === 1 ? "line" : "lines"} and ${
    counts.programmedProjectCount
  } programmed project ${
    counts.programmedProjectCount === 1 ? "cost" : "costs"
  } — without editing any of them.`;
}

// ---------------------------------------------------------------------------
// A candidate's own fields.
// ---------------------------------------------------------------------------

export type CandidateFieldView = {
  key: string;
  label: string;
  value: string;
  kind: ComparedValueKind;
  /**
   * False for the classification fields (revenue vs cost, constrained vs
   * illustrative). The plan does not spell those the way the database does, so
   * the verifier could not check them against the quote and the reviewer must.
   * Badged rather than blended in, because an unchecked value that looks like a
   * checked one is the thing a review screen exists to prevent.
   */
  checkedAgainstQuote: boolean;
};

const FIELD_LABELS: Record<string, string> = {
  entryKind: "Kind",
  sourceName: "Name",
  amount: "Amount",
  amountBasisYear: "Dollar year",
  horizonBandLabel: "Period, as the document writes it",
  horizonBandId: "Period",
  label: "Name",
  unit: "Unit",
  baselineValue: "Baseline",
  baselineYear: "Baseline year",
  targetValue: "Target",
  targetYear: "Target year",
  dataSource: "Source",
  startYear: "First year",
  endYear: "Last year",
  escalationTargetYear: "Escalation year",
  costEstimateBasis: "Cost basis",
  projectName: "Project, as the document names it",
  estimatedCost: "Programmed cost",
  costBasisYear: "Dollar year",
  portfolioRole: "Role in the plan",
  financialBasisYear: "Dollar year for the whole plan",
  text: "The document's text",
};

const MONEY_FIELDS = new Set(["amount", "estimatedCost"]);
const YEAR_FIELDS = new Set([
  "amountBasisYear",
  "baselineYear",
  "targetYear",
  "startYear",
  "endYear",
  "escalationTargetYear",
  "costBasisYear",
  "financialBasisYear",
]);

function fieldValueKind(key: string, specKind: string | undefined): ComparedValueKind {
  if (MONEY_FIELDS.has(key)) return "money";
  if (YEAR_FIELDS.has(key)) return "year";
  if (specKind === "numeric") return "number";
  if (specKind === "classification") return "classification";
  return "text";
}

/**
 * A staged candidate's values, in the order the extraction contract declares
 * them, so the card and the prompt describe one record.
 *
 * `horizonBandId` is dropped: it is a uuid the VERIFIER resolved from this
 * plan's own periods, and a uuid on a review card is a string a planner cannot
 * check. The period is shown by the label the document used.
 */
export function describeCandidateFields(
  targetKind: string,
  proposedJson: unknown
): CandidateFieldView[] {
  const spec = RTP_EXTRACTION_TARGETS[targetKind as RtpExtractionTargetKind];
  const values =
    proposedJson && typeof proposedJson === "object" && !Array.isArray(proposedJson)
      ? (proposedJson as Record<string, unknown>)
      : {};

  const ordered = spec ? spec.fields.map((field) => field.key) : Object.keys(values);
  const seen = new Set(ordered);
  const extras = Object.keys(values).filter((key) => !seen.has(key));

  return [...ordered, ...extras]
    .filter((key) => key !== "horizonBandId")
    .filter((key) => {
      const value = values[key];
      return value !== undefined && value !== null && value !== "";
    })
    .map((key) => {
      const fieldSpec = spec?.fields.find((field) => field.key === key);
      const kind = fieldValueKind(key, fieldSpec?.kind);
      return {
        key,
        label: FIELD_LABELS[key] ?? key,
        value: formatComparedValue(kind, values[key] as string | number),
        kind,
        checkedAgainstQuote: fieldSpec?.kind !== "classification",
      };
    });
}

/** The sentence shown against a value the verifier could not check. */
export const UNCHECKED_FIELD_NOTE =
  "The document does not word this the way OpenPlan does, so it was not matched against the quote. Confirm it yourself.";

// ---------------------------------------------------------------------------
// The provenance chip.
// ---------------------------------------------------------------------------

export type TranscriptionRecord = {
  candidateId: string;
  /** The document this figure was copied out of. */
  kbDocumentId: string | null;
  documentTitle: string | null;
  page: number;
  quote: string;
  /**
   * Fields whose recorded value is no longer what the document said, because a
   * person edited them after accepting. Empty is the ordinary case.
   */
  divergentFields: readonly FieldComparison[];
};

export type ProvenanceChipAudience = "planner" | "public";

export type ProvenanceChipContent = {
  /** The short line beside the figure. Names the document and the page, always. */
  headline: string;
  /** One sentence of context, or null when the headline says it all. */
  detail: string | null;
  /** The document's own words. Never paraphrased, never trimmed to fit. */
  quote: string;
  documentTitle: string;
  page: number;
  /** True when the recorded figure has been changed since it was copied. */
  edited: boolean;
};

/** What a document with no title is called. Never a blank, never an id. */
const UNTITLED_DOCUMENT = "a document in this plan's library";

/**
 * The chip, for either audience.
 *
 * THE EDITED CASE IS THE ONE THAT MATTERS. A row keeps its
 * `extraction_candidate_id` forever, so a figure a planner corrected after
 * accepting would otherwise keep citing a page that does not contain it. The
 * chip states the correction instead: the document is still where the figure
 * came from, and the agency is who changed it. Both halves are true and a
 * reader needs both.
 */
export function buildProvenanceChip(
  record: TranscriptionRecord,
  audience: ProvenanceChipAudience
): ProvenanceChipContent {
  const documentTitle = record.documentTitle?.trim() || UNTITLED_DOCUMENT;
  const edited = record.divergentFields.length > 0;

  if (audience === "public") {
    return {
      headline: edited
        ? `Copied from “${documentTitle}”, page ${record.page}, and revised since`
        : `Copied from “${documentTitle}”, page ${record.page}`,
      detail: edited
        ? "The agency changed this figure after copying it from the document, so the page below is where it came from rather than what it now says."
        : "This figure was copied from the plan document, on the page named, and checked by the agency before it was recorded.",
      quote: record.quote,
      documentTitle,
      page: record.page,
      edited,
    };
  }

  return {
    headline: edited
      ? `From “${documentTitle}”, p. ${record.page} — edited since`
      : `From “${documentTitle}”, p. ${record.page}`,
    detail: edited
      ? `Changed after it was accepted: ${record.divergentFields
          .map(
            (field) =>
              `${field.label} now reads ${formatComparedValue(
                field.kind,
                field.recordedValue
              )}, the document says ${formatComparedValue(field.kind, field.documentValue)}`
          )
          .join("; ")}.`
      : null,
    quote: record.quote,
    documentTitle,
    page: record.page,
    edited,
  };
}

/**
 * The chip's line in the board export BODY (Q2 — never an appendix).
 *
 * Plain text, because the export composes an HTML string and escapes every
 * value it prints; returning markup here would be a second escaping regime in a
 * document a board reads.
 */
export function exportProvenanceLine(record: TranscriptionRecord): string {
  const chip = buildProvenanceChip(record, "public");
  return `${chip.headline}: “${record.quote}”`;
}

/**
 * Where a member can open the document a figure was copied from.
 *
 * `null` when the run's document could not be resolved — a chip still names the
 * page and prints the quote, because a citation with no clickable door is
 * strictly better than no citation. Never used on a public surface: the
 * document lives behind workspace membership and the route would answer 401.
 */
export function transcriptionDocumentHref(record: TranscriptionRecord): string | undefined {
  return record.kbDocumentId
    ? `/api/knowledge-base/documents/${record.kbDocumentId}/download`
    : undefined;
}

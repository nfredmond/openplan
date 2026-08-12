/**
 * RECONCILIATION — what the plan document says, set against what this plan
 * already records.
 *
 * WHY THIS FILE EXISTS AT ALL. The extraction run is deliberately BLIND to the
 * database: nothing from OpenPlan's own RTP rows is ever in the prompt, because
 * a model shown the existing ledger can copy it back and hand it in wearing a
 * page citation — a figure that left OpenPlan and returned as though the
 * adopted plan had printed it. That blindness is not free. It means the model
 * cannot know that the revenue line it just transcribed is already recorded,
 * and it cannot know that the figure a planner typed last month disagrees with
 * the plan the board actually adopted.
 *
 * So the novelty judgement is made HERE, AFTER the model, and it is made in
 * code. No model call, no heuristic, no similarity score. The model contributes
 * transcription; the database comparison contributes novelty; keeping the two
 * in different systems is what lets each be trusted on its own terms.
 *
 * THE THREE ANSWERS:
 *
 *   new              — nothing in this plan has the same identity. Accepting it
 *                      records something the plan did not have.
 *   already_recorded — a row with the same identity holds the same values.
 *                      Accepting it would record the same figure twice, so the
 *                      review surface offers "set aside" as the primary action.
 *   conflicts        — a row with the same identity holds a DIFFERENT value.
 *                      Both figures are shown side by side with the page and
 *                      the quote.
 *
 * THE CONFLICT CASE IS THE POINT OF THE WHOLE FEATURE. It is how a planner
 * catches a ledger typed out of a draft that the adopted plan superseded: the
 * number in OpenPlan and the number the board adopted appear beside each other,
 * with the document's own sentence under them, and a person decides. Nothing
 * here decides anything — reconciliation never writes, never accepts, never
 * ranks, and never says which figure is right.
 *
 * TWO RULES THAT KEEP THE COMPARISON HONEST:
 *
 *   1. A FIELD THE DOCUMENT DID NOT SPEAK ABOUT IS NOT COMPARED. If a candidate
 *      carries an amount and no dollar year, and the recorded line has a dollar
 *      year, that is not a conflict — the plan's page simply did not state one.
 *      Comparing an absent field against a recorded value would manufacture
 *      disagreements out of silence, and a screen full of false conflicts is
 *      how a reviewer learns to click through them.
 *   2. A NEAR MISS IS A CONFLICT, NOT A MATCH. $412,000,000 and $412,500,000
 *      are different figures and there is no tolerance band anywhere in this
 *      file. Same amount, different basis year is also a conflict: 2020 dollars
 *      and 2026 dollars are not the same money, which is the whole reason
 *      `amount_basis_year` exists.
 */

// ---------------------------------------------------------------------------
// What the cycle already holds. Deliberately the shapes the existing loaders
// already return, so no surface has to reshape its data to reconcile against
// it — `loadRtpFinancialElement` produces the first three almost verbatim.
// ---------------------------------------------------------------------------

export type ExistingFinancialLine = {
  id: string;
  horizonBandId: string | null;
  entryKind: string;
  sourceName: string;
  /** PostgREST returns NUMERIC as a string. Parsed here, never coerced to 0. */
  amount: number | string | null;
  amountBasisYear: number | null;
};

export type ExistingPerformanceMeasure = {
  id: string;
  measureKey: string;
  label: string;
  unit: string | null;
  baselineValue: number | string | null;
  baselineYear: number | null;
  targetValue: number | string | null;
  targetYear: number | null;
  dataSource: string | null;
};

export type ExistingHorizonBand = {
  id: string;
  label: string;
  startYear: number;
  endYear: number;
  escalationTargetYear: number | null;
  costEstimateBasis: string | null;
};

export type ExistingProgrammedProject = {
  id: string;
  projectId: string;
  projectName: string | null;
  horizonBandId: string | null;
  portfolioRole: string | null;
  estimatedCost: number | string | null;
  costBasisYear: number | null;
};

export type ExistingCycleFinancialBasis = {
  id: string;
  financialBasisYear: number | null;
};

/** Everything the comparison may look at. One object so a caller cannot forget a half. */
export type RtpCycleRecordedState = {
  lines: readonly ExistingFinancialLine[];
  measures: readonly ExistingPerformanceMeasure[];
  bands: readonly ExistingHorizonBand[];
  programmedProjects: readonly ExistingProgrammedProject[];
  cycle: ExistingCycleFinancialBasis;
};

// ---------------------------------------------------------------------------
// The verdict.
// ---------------------------------------------------------------------------

export const RECONCILIATION_VERDICTS = ["new", "already_recorded", "conflicts"] as const;
export type ReconciliationVerdict = (typeof RECONCILIATION_VERDICTS)[number];

/** How a value is compared and, later, how it is written on a screen. */
export type ComparedValueKind = "money" | "year" | "number" | "text" | "classification";

export type FieldComparison = {
  key: string;
  /** The field's name in planner words, from the extraction contract. */
  label: string;
  kind: ComparedValueKind;
  /** What the document says, as the candidate staged it. */
  documentValue: string | number | null;
  /** What this plan currently records. */
  recordedValue: string | number | null;
  same: boolean;
};

export type ReconciliationMatch = {
  /** The recorded row this candidate lines up with. */
  rowId: string;
  /** How that row reads to a planner, so the two can be told apart on screen. */
  rowLabel: string;
  /** Every field the document actually spoke about, agreeing or not. */
  fields: FieldComparison[];
};

export type CandidateReconciliation = {
  verdict: ReconciliationVerdict;
  /** What made these the same thing — stated, because an identity rule a reviewer cannot see is a rule they cannot check. */
  identityNote: string;
  /** Empty for `new`; exactly one for `already_recorded`; one or more for `conflicts`. */
  matches: ReconciliationMatch[];
};

// ---------------------------------------------------------------------------
// Value normalisation. Small, blunt, and shared by every kind.
// ---------------------------------------------------------------------------

/**
 * A number, or null. `"412000000.00"` and `412000000` are the same figure;
 * `""`, `null` and `"not stated"` are all the absence of one.
 *
 * NEVER returns 0 for an unparseable value — the RTP schema is explicit
 * (20260805000003) that NULL means UNPRICED and is a distinct answer from zero.
 */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,\s]/g, "");
    if (cleaned === "") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Whitespace-collapsed, case-folded text. `null` for anything blank. */
function toComparableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  return normalized === "" ? null : normalized;
}

/** The display form of a text value: normalised for spacing, but NOT case-folded. */
function toDisplayText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  return trimmed === "" ? null : trimmed;
}

function sameValue(kind: ComparedValueKind, documentValue: unknown, recordedValue: unknown): boolean {
  if (kind === "text" || kind === "classification") {
    return toComparableText(documentValue) === toComparableText(recordedValue);
  }
  return toNumber(documentValue) === toNumber(recordedValue);
}

function comparableValue(kind: ComparedValueKind, value: unknown): string | number | null {
  return kind === "text" || kind === "classification" ? toDisplayText(value) : toNumber(value);
}

type ComparisonPlan = {
  key: string;
  label: string;
  kind: ComparedValueKind;
  /** What the recorded row holds for this field. */
  recorded: unknown;
};

/**
 * Compare only the fields the DOCUMENT spoke about.
 *
 * A key absent from `proposedJson` is skipped entirely — see rule 1 in this
 * file's header. A key present with a null value is also skipped: the verifier
 * drops blank fields before staging, so a null here means the same silence.
 */
function compareFields(
  proposedJson: Record<string, unknown>,
  plan: readonly ComparisonPlan[]
): FieldComparison[] {
  const comparisons: FieldComparison[] = [];
  for (const entry of plan) {
    if (!(entry.key in proposedJson)) continue;
    const documentValue = proposedJson[entry.key];
    if (documentValue === null || documentValue === undefined || documentValue === "") continue;
    comparisons.push({
      key: entry.key,
      label: entry.label,
      kind: entry.kind,
      documentValue: comparableValue(entry.kind, documentValue),
      recordedValue: comparableValue(entry.kind, entry.recorded),
      same: sameValue(entry.kind, documentValue, entry.recorded),
    });
  }
  return comparisons;
}

/**
 * The verdict follows from the comparisons, in one place for every kind.
 *
 * A match that agrees on EVERY compared field wins over one that does not: if
 * this plan holds both an identical line and a differing one, the honest answer
 * is that accepting would duplicate something, which is the more consequential
 * of the two.
 */
function decide(
  identityNote: string,
  matches: readonly ReconciliationMatch[]
): CandidateReconciliation {
  if (matches.length === 0) return { verdict: "new", identityNote, matches: [] };

  const identical = matches.find((match) => match.fields.every((field) => field.same));
  if (identical) return { verdict: "already_recorded", identityNote, matches: [identical] };

  return { verdict: "conflicts", identityNote, matches: [...matches] };
}

// ---------------------------------------------------------------------------
// Per-kind rules.
//
// Each kind is described ONCE, as three things: which recorded rows could be
// the same thing (identity), how one of those rows reads to a planner (label),
// and which fields are compared against it (plan). Both questions this file
// answers — "is this candidate new?" and "does an accepted transcription still
// match the row it became?" — run through the same description, so a chip and a
// review card can never disagree about whether two figures are the same.
// ---------------------------------------------------------------------------

function bandLabelById(bands: readonly ExistingHorizonBand[], bandId: string | null): string | null {
  if (!bandId) return null;
  const band = bands.find((candidate) => candidate.id === bandId);
  return band ? `${band.label} (${band.startYear}–${band.endYear})` : null;
}

type KindRule<Row> = {
  /** The recorded rows of this kind, in the order a planner would read them. */
  rows: (state: RtpCycleRecordedState) => readonly Row[];
  rowId: (row: Row) => string;
  label: (row: Row, state: RtpCycleRecordedState) => string;
  plan: (row: Row, state: RtpCycleRecordedState) => ComparisonPlan[];
  /**
   * Which recorded rows could be the SAME thing as this candidate. Returning
   * an empty list is the answer "nothing like it is recorded"; returning null
   * means the candidate carries nothing to compare on at all, which is a
   * different sentence.
   */
  identify: (
    proposedJson: Record<string, unknown>,
    state: RtpCycleRecordedState
  ) => { rows: readonly Row[]; note: string } | { rows: null; note: string };
  /**
   * Some kinds rewrite a compared value for reading — an id is a string a
   * planner cannot check, so a period is shown by name.
   */
  present?: (field: FieldComparison, state: RtpCycleRecordedState) => FieldComparison;
};

const financialLineRule: KindRule<ExistingFinancialLine> = {
  rows: (state) => state.lines,
  rowId: (line) => line.id,
  label: (line, state) =>
    [line.sourceName, bandLabelById(state.bands, line.horizonBandId)]
      .filter((part): part is string => Boolean(part))
      .join(" · "),
  plan: (line) => [
    { key: "amount", label: "Amount", kind: "money", recorded: line.amount },
    { key: "amountBasisYear", label: "Dollar year", kind: "year", recorded: line.amountBasisYear },
    { key: "sourceName", label: "Name", kind: "text", recorded: line.sourceName },
  ],
  identify: (proposedJson, state) => {
    const entryKind = toComparableText(proposedJson.entryKind);
    const sourceName = toComparableText(proposedJson.sourceName);
    if (!entryKind || !sourceName) {
      return { rows: null, note: "This line has no name to compare against what you have recorded." };
    }

    // When the document named a period and the verifier resolved it, only that
    // period's lines are candidates: the same revenue source in two periods is
    // two lines, not a disagreement about one.
    const horizonBandId =
      typeof proposedJson.horizonBandId === "string" ? proposedJson.horizonBandId : null;

    // Identity is the kind of line plus the name the plan gives it — the two
    // things a ledger row is FOR. The amount is what is being compared, so it
    // cannot also be part of what makes two rows the same row.
    const rows = state.lines.filter(
      (line) =>
        (horizonBandId === null || line.horizonBandId === horizonBandId) &&
        toComparableText(line.entryKind) === entryKind &&
        toComparableText(line.sourceName) === sourceName
    );

    return {
      rows,
      note: horizonBandId
        ? "Compared against lines of the same kind, with the same name, in the same period."
        : "Compared against lines of the same kind with the same name, in any period.",
    };
  },
};

/**
 * A measure has no key in the document — a plan prints a name, not a database
 * key — so identity is the NAME, matched against a recorded measure's label or
 * its key. That is the honest reading of "the same measure": two rows both
 * called "Fatalities and serious injuries" are one measure whatever key
 * somebody typed.
 */
const performanceMeasureRule: KindRule<ExistingPerformanceMeasure> = {
  rows: (state) => state.measures,
  rowId: (measure) => measure.id,
  label: (measure) => measure.label,
  plan: (measure) => [
    { key: "baselineValue", label: "Baseline", kind: "number", recorded: measure.baselineValue },
    { key: "baselineYear", label: "Baseline year", kind: "year", recorded: measure.baselineYear },
    { key: "targetValue", label: "Target", kind: "number", recorded: measure.targetValue },
    { key: "targetYear", label: "Target year", kind: "year", recorded: measure.targetYear },
    { key: "unit", label: "Unit", kind: "text", recorded: measure.unit },
    { key: "dataSource", label: "Source", kind: "text", recorded: measure.dataSource },
  ],
  identify: (proposedJson, state) => {
    const label = toComparableText(proposedJson.label);
    if (!label) {
      return { rows: null, note: "This measure has no name to compare against what you have recorded." };
    }
    return {
      rows: state.measures.filter(
        (measure) =>
          toComparableText(measure.label) === label || toComparableText(measure.measureKey) === label
      ),
      note: "Compared against measures recorded under the same name.",
    };
  },
};

/**
 * A period is the years it covers OR the name it goes by. Either one matching
 * makes two rows the same period, so a plan that renamed "Tier 1" to
 * "Near-term" without moving its years reconciles against it — and the rename
 * shows up as the conflict it is, instead of staging a duplicate period whose
 * escalation exponent would then be applied twice.
 */
const horizonBandRule: KindRule<ExistingHorizonBand> = {
  rows: (state) => state.bands,
  rowId: (band) => band.id,
  label: (band) => `${band.label} (${band.startYear}–${band.endYear})`,
  plan: (band) => [
    { key: "label", label: "Name", kind: "text", recorded: band.label },
    { key: "startYear", label: "First year", kind: "year", recorded: band.startYear },
    { key: "endYear", label: "Last year", kind: "year", recorded: band.endYear },
    {
      key: "escalationTargetYear",
      label: "Escalation year",
      kind: "year",
      recorded: band.escalationTargetYear,
    },
    { key: "costEstimateBasis", label: "Cost basis", kind: "classification", recorded: band.costEstimateBasis },
  ],
  identify: (proposedJson, state) => {
    const label = toComparableText(proposedJson.label);
    const startYear = toNumber(proposedJson.startYear);
    const endYear = toNumber(proposedJson.endYear);
    if (label === null && (startYear === null || endYear === null)) {
      return { rows: null, note: "This period has neither a name nor a span of years to compare." };
    }
    return {
      rows: state.bands.filter((band) => {
        const sameLabel = label !== null && toComparableText(band.label) === label;
        const sameYears =
          startYear !== null && endYear !== null && band.startYear === startYear && band.endYear === endYear;
        return sameLabel || sameYears;
      }),
      note: "Compared against periods with the same name or the same span of years.",
    };
  },
};

/**
 * A programmed project is staged as a NAME STRING and never a project id (Q6),
 * so identity is that name against the names of the projects already in this
 * plan. A name matching nothing is `new` — which is also the case where the
 * reviewer must bind the row to a project by hand before it can be accepted.
 */
const programmedProjectRule: KindRule<ExistingProgrammedProject> = {
  rows: (state) => state.programmedProjects,
  rowId: (link) => link.id,
  label: (link) => link.projectName ?? "A project in this plan",
  plan: (link) => [
    { key: "estimatedCost", label: "Programmed cost", kind: "money", recorded: link.estimatedCost },
    { key: "costBasisYear", label: "Dollar year", kind: "year", recorded: link.costBasisYear },
    { key: "portfolioRole", label: "Role in the plan", kind: "classification", recorded: link.portfolioRole },
    { key: "horizonBandId", label: "Period", kind: "text", recorded: link.horizonBandId },
  ],
  identify: (proposedJson, state) => {
    const projectName = toComparableText(proposedJson.projectName);
    if (!projectName) {
      return { rows: null, note: "This row has no project name to compare against this plan." };
    }
    return {
      rows: state.programmedProjects.filter(
        (link) => toComparableText(link.projectName) === projectName
      ),
      note: "Compared against projects already in this plan with the same name.",
    };
  },
  // A band id on a review card is a string a planner cannot check, so both
  // sides of a period comparison are read out as the period's own name.
  present: (field, state) =>
    field.key === "horizonBandId"
      ? {
          ...field,
          documentValue:
            bandLabelById(state.bands, typeof field.documentValue === "string" ? field.documentValue : null) ??
            (field.documentValue === null ? null : "A period this plan does not have"),
          recordedValue:
            bandLabelById(state.bands, typeof field.recordedValue === "string" ? field.recordedValue : null) ??
            (field.recordedValue === null ? null : "A period this plan does not have"),
        }
      : field,
};

/**
 * The plan's own dollar year. There is exactly one row it can be compared
 * against — the cycle itself — and accepting it re-derives every escalated
 * figure in the plan, which is why the review surface states that blast radius
 * before the click (Q5).
 */
const cycleFinancialBasisRule: KindRule<ExistingCycleFinancialBasis> = {
  rows: (state) => [state.cycle],
  rowId: (cycle) => cycle.id,
  label: () => "This plan",
  plan: (cycle) => [
    {
      key: "financialBasisYear",
      label: "Dollar year for the whole plan",
      kind: "year",
      recorded: cycle.financialBasisYear,
    },
  ],
  identify: (proposedJson, state) => {
    const note = "Compared against the dollar year recorded for this plan.";
    // No basis year recorded is a real absence, not a row to disagree with.
    if (state.cycle.financialBasisYear === null || state.cycle.financialBasisYear === undefined) {
      return { rows: [], note };
    }
    return { rows: [state.cycle], note };
  },
};

/**
 * The registry holds rules whose row type has been erased to `unknown`, and the
 * erasure is done by CLOSING OVER the typed rule rather than by casting it.
 * Every cast is confined to `eraseKindRule`, where the row a function receives
 * is provably the row its own `rows()` produced.
 */
type ErasedKindRule = KindRule<unknown>;

function eraseKindRule<Row>(rule: KindRule<Row>): ErasedKindRule {
  return {
    rows: (state) => rule.rows(state),
    rowId: (row) => rule.rowId(row as Row),
    label: (row, state) => rule.label(row as Row, state),
    plan: (row, state) => rule.plan(row as Row, state),
    identify: (proposedJson, state) => rule.identify(proposedJson, state),
    present: rule.present,
  };
}

const KIND_RULES: Record<string, ErasedKindRule> = {
  financial_line: eraseKindRule(financialLineRule),
  performance_measure: eraseKindRule(performanceMeasureRule),
  horizon_band: eraseKindRule(horizonBandRule),
  programmed_project: eraseKindRule(programmedProjectRule),
  cycle_financial_basis: eraseKindRule(cycleFinancialBasisRule),
};

/** The kinds this file knows how to compare. `chapter_block` is deliberately absent. */
export const RECONCILABLE_TARGET_KINDS = Object.keys(KIND_RULES);

function buildMatch<Row>(
  rule: KindRule<Row>,
  row: Row,
  proposedJson: Record<string, unknown>,
  state: RtpCycleRecordedState
): ReconciliationMatch {
  const fields = compareFields(proposedJson, rule.plan(row, state)).map((field) =>
    rule.present ? rule.present(field, state) : field
  );
  return { rowId: rule.rowId(row), rowLabel: rule.label(row, state), fields };
}

// ---------------------------------------------------------------------------
// The one entry point.
// ---------------------------------------------------------------------------

export type ReconcilableCandidate = {
  targetKind: string;
  proposedJson: unknown;
};

function readProposedJson(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Label one staged candidate against what this plan already records.
 *
 * `chapter_block` and any kind this function does not know are answered `new`
 * with a stated reason rather than silently: chapter narrative lands in
 * `document_narrative_drafts` (Q3), which has its own review path and its own
 * idea of what a duplicate is, and inventing a comparison for it here would put
 * a verdict on a card that the acceptance path does not share.
 */
export function reconcileExtractionCandidate(
  candidate: ReconcilableCandidate,
  state: RtpCycleRecordedState
): CandidateReconciliation {
  const rule: ErasedKindRule | undefined = KIND_RULES[candidate.targetKind];
  if (!rule) {
    return {
      verdict: "new",
      identityNote:
        "This kind of passage is reviewed on its own, so it is not compared against what this plan records.",
      matches: [],
    };
  }

  const proposedJson = readProposedJson(candidate.proposedJson);
  const identified = rule.identify(proposedJson, state);
  if (identified.rows === null) {
    return { verdict: "new", identityNote: identified.note, matches: [] };
  }

  const matches = identified.rows.map((row) => buildMatch(rule, row, proposedJson, state));

  // A candidate whose only compared field the document never stated cannot be
  // said to agree with anything: there is nothing to have agreed about.
  const comparable = matches.filter((match) => match.fields.length > 0);
  if (comparable.length === 0) return { verdict: "new", identityNote: identified.note, matches: [] };

  return decide(identified.note, comparable);
}

export type ReconciliationRollup = Record<ReconciliationVerdict, number>;

/** The counts the review header shows. Every verdict is present, including zeroes. */
export function rollUpReconciliations(
  reconciliations: readonly CandidateReconciliation[]
): ReconciliationRollup {
  const rollup: ReconciliationRollup = { new: 0, already_recorded: 0, conflicts: 0 };
  for (const reconciliation of reconciliations) {
    rollup[reconciliation.verdict] += 1;
  }
  return rollup;
}

/**
 * Whether an ACCEPTED transcription still matches the row it became.
 *
 * The same comparison engine pointed at a different question, and it is what
 * keeps a provenance chip from becoming a small lie. A planner may edit a
 * figure after accepting it; the row keeps its `extraction_candidate_id`
 * forever, so without this check the chip would go on citing page 112 for a
 * number page 112 does not contain.
 *
 * It compares against the row BY ID rather than by identity, deliberately: a
 * planner who corrected the transcribed NAME would otherwise fall out of the
 * identity match and read as unedited, which is the one case where a wrong
 * citation is most likely.
 *
 * Returns the fields that no longer agree. Empty means the recorded values are
 * still the document's own.
 */
export function transcriptionDivergence(
  candidate: ReconcilableCandidate,
  state: RtpCycleRecordedState,
  acceptedRowId: string
): FieldComparison[] {
  const rule: ErasedKindRule | undefined = KIND_RULES[candidate.targetKind];
  if (!rule) return [];

  const row = rule.rows(state).find((entry) => rule.rowId(entry) === acceptedRowId);
  if (row === undefined) return [];

  return buildMatch(rule, row, readProposedJson(candidate.proposedJson), state).fields.filter(
    (field) => !field.same
  );
}

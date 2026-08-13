import {
  isMeasureClaimAwaitingDecision,
  type MeasureAllocationLike,
  type MeasureClaimLedger,
  type MeasureClaimLedgerResult,
  type MeasureMoeSummary,
} from "@/lib/measures/claims";
import { isNarrativeRule, type MeasureAllocationRule } from "@/lib/measures/allocation";
import { roundCurrencyAmount } from "@/lib/invoicing/invoice-records";
import { parseOptionalAmount } from "@/lib/money/optional-amount";
import type {
  MeasureOffTheTopTakeRead,
  MeasureReceiptLedger,
  MeasureReceiptLedgerResult,
  MeasureReserveRead,
} from "@/lib/measures/receipts";
import { formatMoney } from "@/lib/money/format";

/**
 * THE OVERSIGHT RECORD — what a resident and a citizens' oversight committee
 * are shown about a local measure fund.
 *
 * ============================================================================
 * WHO IS READING, AND WHY THAT CHANGES THE CODE AND NOT JUST THE WORDS
 * ============================================================================
 *
 * Voters passed the tax. The committee that audits it is made of members of the
 * public who have no OpenPlan account, no access to the workspace, and no way
 * to tell an empty query from an empty fund. Everything below is built for that
 * reader, and three of the decisions are structural rather than editorial:
 *
 * 1. A FIGURE AND ITS COVERAGE ARE ONE VALUE. `OversightFigure` carries
 *    `amountText` and `coverageSentence` together and the sentence is a
 *    REQUIRED, non-empty string. There is no way to obtain the number without
 *    the sentence that says what it counted and over what period, so a page
 *    cannot print a bare total by forgetting a caveat — it would have to delete
 *    a field. "$14.2 million received" with no note that two quarters were
 *    never reported is the single most damaging thing this surface could say,
 *    because it is the figure a committee compares against next year's.
 *
 * 2. A FAILED READ IS A SENTENCE, NOT AN EMPTY SECTION. Every section is
 *    `{ ok: true, … } | { ok: false, sentence }`. `buildMeasureOversightModel`
 *    takes the LEDGER RESULTS rather than ledgers, so the page has no branch to
 *    forget: a query that failed reaches the reader as "this could not be read"
 *    instead of as a fund that received nothing.
 *
 * 3. NO INTERNAL VOCABULARY REACHES THE PAGE. "Off the top", "apportionment
 *    basis", "maintenance of effort", "sub-recipient", "computation basis" are
 *    staff words. The copy constants below are the only words this surface
 *    uses, they live here where a test can read them, and the section headings
 *    are questions a resident would actually ask.
 *
 * ============================================================================
 * WHAT THIS MODULE COMPUTES, AND WHAT IT REFUSES TO
 * ============================================================================
 *
 * Almost nothing. The receipt ledger (`receipts.ts`), the claim ledger and the
 * maintenance-of-effort summary (`claims.ts`) already derived every money
 * figure, and this module composes their output into sentences. TWO pieces of
 * arithmetic live here, both isolated, exported and pinned by hand-derived
 * fixtures:
 *
 *   `summarizeMeasureRecipientOutcomes` rolls the ledger's per-claim lines up to
 *   one row per recipient — the public page's central question ("who asked for
 *   it and what did they get?") has no answer in the ledger's own shape. It sums
 *   the LINES rather than the buckets, because a bucket is per (recipient,
 *   category, year) and summing buckets would be correct only by accident.
 *
 *   `buildMeasureDivisionSummary` closes the arithmetic a committee member does
 *   in their head: received, less what the ordinance took out first, against
 *   what reached the purposes voters approved. See its own header for why it is
 *   scoped to the periods that have actually been divided up.
 *
 * `roundCurrencyAmount` is imported from the invoice register so a recipient's
 * total on this page agrees to the cent with the same money elsewhere in the
 * product.
 *
 * It computes NO percentage of a total, no per-capita figure, and no share of
 * the tax "your city gets". Every one of those is a derived claim a resident
 * would quote, and each needs a denominator this product does not hold.
 */

/* ------------------------------------------------------------------ *
 * Resident-facing copy
 *
 * Constants rather than inline JSX so that the words a member of the public
 * reads are in one file, reviewable in one place, and assertable by a test that
 * renders the real page.
 * ------------------------------------------------------------------ */

export const MEASURE_OVERSIGHT_COPY = {
  pageEyebrow: "Voter-approved local measure · Public view",
  receiptsHeading: "Where the money came from",
  divisionHeading: "What was taken out and kept back before the rest was divided",
  ordinanceHeading: "What the ordinance says it must pay for",
  recipientsHeading: "Who asked for it and what they got",
  moeHeading: "What each area promised to keep spending on its own",
  periodsHeading: "Every reporting period on the record",

  /**
   * The standing note under the title. It says three things a committee member
   * has to know before reading a single figure: who entered this, that it is
   * not an audit, and that it is as good as the records behind it.
   */
  preparedNote:
    "These figures come from the records the agency has entered into OpenPlan. This page is not an " +
    "audited financial statement and it is not the agency's official accounting — it is a running " +
    "view of what has been recorded, shown so it can be checked.",

  /** Printed wherever any hand-entered allocation is in scope. Guard (ii). */
  staffEnteredNote:
    "Some of the amounts below were typed in by agency staff rather than worked out from the " +
    "ordinance's own formula. They are marked where they appear.",

  staffEnteredBadge: "Entered by staff",

  /** What a resident is told when a read failed. Never "no records". */
  readFailureNote:
    "Part of this page could not be loaded, so some sections are shown as unavailable rather than as " +
    "zero. An empty section here would not mean there is nothing to report.",

  /**
   * WHY THIS SECTION EXISTS AT ALL.
   *
   * Most self-help ordinances take an amount out of every payment before the
   * rest is divided — to collect the tax, to run the programme, to audit it.
   * Until 2026-08-12 this page showed what came in and what the purposes below
   * received and NOTHING about the amount in between, so a committee member
   * doing the obvious subtraction found money that had simply vanished from the
   * page, with nothing on it to say where. That gap is the shape of dishonesty
   * this product refuses everywhere else, and it was on the surface with the
   * least equipped reader.
   *
   * THE SECOND HALF OF THE SAME GAP, closed later the same day. Many of those
   * ordinances also KEEP an amount back — a rainy-day fund out of the whole
   * payment, a vehicle-replacement hold out of one purpose. That amount was
   * computed by the allocator and stored nowhere, so the subtraction still did
   * not come out for any fund that holds one, and the settlement sentence had
   * to offer a held-back reserve as a cause it could neither show nor rule out.
   * `measure_period_reserve` (20260812000019) records it, and the chain below
   * now has three subtractions rather than two.
   */
  divisionExplainer:
    "Most measures take an amount out of every payment before the rest is divided up — to collect the " +
    "tax, to run the programme, or to check how the money is spent. Many also keep an amount back in " +
    "reserve, either out of the whole payment or out of one of the purposes below. What the ordinance " +
    "took out, what it kept back, and what was left is shown here so the figures on this page can be " +
    "added up and checked.",

  /*
   * THE CHAIN'S OWN LABELS, shared by the public page and the annual statement.
   *
   * They were inline JSX on the page until the statement grew the same section.
   * Two spellings of "Taken out first" would drift within a release, and a
   * committee member reading the page beside the document they filed has no way
   * to tell a renamed heading from a different figure. `division-copy-is-shared`
   * in `measure-oversight-statement.test.ts` holds both surfaces to these.
   */
  divisionReceivedHeading: "Received in these periods",
  divisionTakenOutHeading: "Taken out first",
  divisionHeldBackHeading: "Kept back in reserve",
  /*
   * RENAMED FROM "Left to divide" on 2026-08-12, because the figure under it
   * changed meaning. It used to be `received − taken out`, which for a fund
   * that keeps money back was more than the purposes below ever saw. It is now
   * `received − taken out − kept back`, which is exactly what they were given,
   * and a heading saying "left to divide" over that number would invite the
   * reader to look for a division that had already happened.
   */
  divisionLeftHeading: "Left for the purposes below",
  divisionClauseColumn: "What it is for",
  divisionAmountColumn: "Amount taken",
  divisionNoteColumn: "What the ordinance says about it",
  divisionReserveClauseColumn: "What is being kept back",
  divisionReserveAmountColumn: "Amount kept back",
  divisionReserveSourceColumn: "Kept back out of",

  moeExplainer:
    "Some measures require each area to keep spending its own money on the same purposes, so that the " +
    "new tax adds to local spending instead of replacing it. Where either the required amount or the " +
    "amount actually spent has not been recorded, this page says so rather than guessing.",

  notDeterminedLabel: "Not enough recorded to say",
} as const;

/* ------------------------------------------------------------------ *
 * Money and dates, in a resident's units
 * ------------------------------------------------------------------ */

/**
 * A money string, or an honest fallback when the currency code is one `Intl`
 * refuses.
 *
 * `currency_code` carries a `^[A-Z]{3}$` CHECK but not a membership test
 * against ISO 4217, so a typo reaches the formatter as a RangeError. A public
 * page that 500s because somebody typed "USF" is worse than one that prints
 * the code beside the number, and silently substituting USD would mislabel the
 * unit on every figure — which is the one thing a money page may never do.
 * `formatMoney` holds that fallback for every surface now; `currencyDisplay:
 * "code"` stays because a resident reading a fund report should not have to
 * infer which country's dollar a "$" means.
 */
export function formatOversightMoney(value: number, currencyCode: string): string {
  return formatMoney(value, { precision: "cents", currency: currencyCode, currencyDisplay: "code" });
}

/**
 * A date a resident reads, in UTC.
 *
 * UTC because every date on this page is a plain `DATE` column, and rendering
 * one through a server's local zone moves a period that ended on the 30th to
 * the 29th for any deployment west of UTC — on a page whose whole job is to say
 * which months a figure covers.
 */
export function formatOversightDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "March 1, 2026 to June 30, 2026", or null when neither end is known. */
export function formatOversightSpan(start: string | null, end: string | null): string | null {
  const from = formatOversightDate(start);
  const to = formatOversightDate(end);
  if (from && to) return `${from} to ${to}`;
  if (from) return `${from} onwards`;
  if (to) return `up to ${to}`;
  return null;
}

/** English list: "A", "A and B", "A, B and C". */
function joinList(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/* ------------------------------------------------------------------ *
 * A figure and the sentence it may not be printed without
 * ------------------------------------------------------------------ */

/**
 * ONE VALUE, TWO INSEPARABLE HALVES.
 *
 * `coverageSentence` is not optional and is never empty — `oversightFigure`
 * refuses to build one without it. The point is that the type system, not a
 * reviewer's memory, is what keeps a total on this page from appearing without
 * what it counted.
 */
export type OversightFigure = {
  amountText: string;
  /** What this counted, over what period, and what is missing from it. */
  coverageSentence: string;
  /** True when the figure is a lower bound rather than the answer. */
  isFloor: boolean;
};

export function oversightFigure(input: {
  amount: number;
  currencyCode: string;
  coverageSentence: string;
  isFloor: boolean;
}): OversightFigure {
  const sentence = input.coverageSentence.trim();
  if (!sentence) {
    // Thrown rather than defaulted. A blank caveat is the defect this whole
    // type exists to prevent, and a silent fallback ("counts all records") is
    // the same lie with a nicer failure mode.
    throw new Error("measure oversight: a public figure may not be built without a coverage sentence");
  }
  return {
    amountText: formatOversightMoney(input.amount, input.currencyCode),
    coverageSentence: sentence,
    isFloor: input.isFloor,
  };
}

/* ------------------------------------------------------------------ *
 * Coverage sentences
 * ------------------------------------------------------------------ */

/**
 * What the received total counted, over what period, and what it is missing.
 *
 * Three distinct shapes, because the three states of a period are the whole
 * design of `measure_fund_periods`: no period opened at all, periods opened and
 * fully reported, periods opened with receipts still unreported. The third also
 * names the periods, because "two periods are missing" sends a committee
 * member to ask which — and the answer is already in the ledger.
 */
export function receiptCoverageSentence(ledger: MeasureReceiptLedger): string {
  const coverage = ledger.coverage;
  if (coverage.openedPeriodCount === 0) {
    return "No reporting period has been opened for this measure yet, so there is nothing to add up here.";
  }

  // The span of the periods that WERE reported, not of every period on the
  // books. A span taken over all rows would say the total covers a quarter
  // whose amount nobody has entered — the exact overstatement the rest of this
  // sentence exists to prevent.
  const reported = ledger.lines.filter((line) => line.receivedAmount !== null);
  const span = formatOversightSpan(
    reported[0]?.periodStart ?? null,
    reported[reported.length - 1]?.periodEnd ?? null
  );
  const parts: string[] = [
    `Adds up the ${coverage.reportedPeriodCount} reporting ${plural(
      coverage.reportedPeriodCount,
      "period",
      "periods"
    )} the agency has recorded a receipt for${span ? `, covering ${span}` : ""}.`,
  ];

  if (coverage.missingPeriodCount > 0) {
    parts.push(
      `${coverage.missingPeriodCount} ${plural(
        coverage.missingPeriodCount,
        "period has",
        "periods have"
      )} been opened with no amount recorded yet (${joinList(coverage.missingPeriods)}), so this is at ` +
        "least what came in — not necessarily all of it."
    );
  }

  for (const gap of coverage.calendarGaps) {
    const gapSpan = formatOversightSpan(gap.gapStart, gap.gapEnd);
    parts.push(
      `No period covers ${gapSpan ?? "part of the calendar"} (after ${gap.afterPeriodLabel}), so any money ` +
        "that arrived then is not counted here."
    );
  }

  return parts.join(" ");
}

/**
 * What the "asked for" and "paid out" totals counted.
 *
 * The two exclusions are stated rather than left implicit. A committee member
 * who adds the claims listed further down and gets a different number needs to
 * know that drafts, denials and withdrawals were kept out of the total on
 * purpose — otherwise the discrepancy reads as an error, or worse, as money
 * unaccounted for.
 */
export function claimCoverageSentence(
  ledger: MeasureClaimLedger,
  what: "asked" | "paid",
  /**
   * The one fiscal year these claims were scoped to, when they were.
   *
   * NOT COSMETIC. The annual statement route filters its claims read to a
   * single `fiscal_year_label` and then printed "across every year on the
   * record" over the result — on a document a citizens' oversight committee
   * files, whose entire purpose is to be about one year. A reader adding the
   * fund's four annual statements together would have believed they were
   * adding four copies of the same lifetime total. The figure was right; the
   * sentence describing it was wrong, which on this surface is the same defect,
   * because the sentence is the only thing that says what the figure counted.
   */
  fiscalYearLabel?: string | null
): string {
  const excluded = ledger.draftCount + ledger.deniedCount + ledger.withdrawnCount;
  const span = fiscalYearLabel ? `in ${fiscalYearLabel}` : "across every year on the record";
  const base =
    what === "asked"
      ? `Adds up the ${ledger.claimedCount} ${plural(
          ledger.claimedCount,
          "claim that has",
          "claims that have"
        )} been filed and not taken back, ${span}.`
      : `Adds up the ${ledger.paidCount} ${plural(
          ledger.paidCount,
          "claim",
          "claims"
        )} the agency has recorded as paid, ${span}.`;

  const parts = [base];
  if (excluded > 0) {
    parts.push(
      `Not included: ${ledger.draftCount} still being prepared, ${ledger.deniedCount} turned down and ` +
        `${ledger.withdrawnCount} withdrawn.`
    );
  }
  if (what === "paid" && ledger.retentionHeld > 0) {
    parts.push("Amounts the agency is holding back until work is finished are not part of this figure.");
  }
  if (ledger.allocationsWithUnknownPeriodCount > 0) {
    parts.push(
      `${ledger.allocationsWithUnknownPeriodCount} allocation ${plural(
        ledger.allocationsWithUnknownPeriodCount,
        "line",
        "lines"
      )} could not be matched to a reporting period, so anything below comparing claims against what was ` +
        "set aside is incomplete."
    );
  }
  return parts.join(" ");
}

/* ------------------------------------------------------------------ *
 * The one piece of arithmetic: claims rolled up per recipient
 * ------------------------------------------------------------------ */

export type MeasureRecipientOutcome = {
  recipientId: string;
  /** Σ gross over claims that were filed and not taken back. */
  askedForGross: number;
  askedForCount: number;
  /** Σ net over claims recorded as paid. */
  paidNet: number;
  paidCount: number;
  /** Filed and still waiting on the agency. */
  awaitingDecisionCount: number;
  /** Drafts, denials and withdrawals — reported, folded into no total. */
  notCountedCount: number;
  /** The years this recipient has claims in, earliest label first. */
  fiscalYearLabels: string[];
};

/**
 * One row per recipient, from the ledger's per-claim LINES.
 *
 * WHY LINES AND NOT BUCKETS. A bucket is per (recipient, category, fiscal
 * year), and a recipient's row is the sum over all of them — which is right
 * only while every claim lands in exactly one bucket. Lines are the atoms: one
 * per claim, each with its own `isClaimed` and `isPaid` already decided by the
 * ledger against the shared status partition. Summing the atoms cannot
 * double-count and cannot silently drop a claim whose bucket key was empty.
 *
 * WHY THE PREDICATES ARE IMPORTED. `isClaimed`/`isPaid` come off the line, and
 * "waiting on the agency" is asked of `isMeasureClaimAwaitingDecision`. A local
 * `status === "submitted" || status === "under_review"` here would be a second
 * definition of the review queue, and the reminder sweep, the workspace page
 * and this public page would eventually disagree about what is outstanding.
 *
 * Rounded at every addition with the invoice register's own rounding, so a
 * recipient's total here and the same money on the staff page agree to the cent.
 */
export function summarizeMeasureRecipientOutcomes(
  ledger: MeasureClaimLedger
): MeasureRecipientOutcome[] {
  const byRecipient = new Map<string, MeasureRecipientOutcome>();
  const yearsSeen = new Map<string, Set<string>>();

  for (const line of ledger.lines) {
    const recipientId = line.recipientId;
    if (!recipientId) continue;

    let row = byRecipient.get(recipientId);
    if (!row) {
      row = {
        recipientId,
        askedForGross: 0,
        askedForCount: 0,
        paidNet: 0,
        paidCount: 0,
        awaitingDecisionCount: 0,
        notCountedCount: 0,
        fiscalYearLabels: [],
      };
      byRecipient.set(recipientId, row);
      yearsSeen.set(recipientId, new Set());
    }

    if (line.isClaimed) {
      row.askedForCount += 1;
      row.askedForGross = roundCurrencyAmount(row.askedForGross + line.grossAmount);
    } else {
      row.notCountedCount += 1;
    }

    if (line.isPaid) {
      row.paidCount += 1;
      row.paidNet = roundCurrencyAmount(row.paidNet + line.netAmount);
    }

    if (isMeasureClaimAwaitingDecision(line.status)) {
      row.awaitingDecisionCount += 1;
    }

    if (line.fiscalYearLabel) yearsSeen.get(recipientId)?.add(line.fiscalYearLabel);
  }

  for (const [recipientId, years] of yearsSeen) {
    const row = byRecipient.get(recipientId);
    if (row) row.fiscalYearLabels = [...years].sort();
  }

  return [...byRecipient.values()];
}

/* ------------------------------------------------------------------ *
 * The second piece of arithmetic: the subtraction a committee member does
 * ------------------------------------------------------------------ */

/** One clause of the ordinance that takes an amount out before the rest is divided. */
export type OversightTakeRow = {
  offTheTopId: string;
  label: string;
  amountText: string;
  /**
   * Why what was taken differs from what the ordinance's own formula called
   * for, or that a yearly limit could not be checked when it was applied. Null
   * when the clause was applied plainly.
   */
  noteSentence: string | null;
};

/** One reserve clause of the ordinance: money kept in the measure rather than divided. */
export type OversightReserveRow = {
  reserveId: string;
  label: string;
  amountText: string;
  /**
   * What it was kept back out of, in a resident's words: everything that came
   * in, what was left after the amounts taken out first, or one of the purposes
   * below by its own name.
   */
  heldOutOfText: string;
  /**
   * The rate the ordinance sets and the figure it was applied to, and — when
   * they differ — why less was kept back than the rate called for. Null when
   * neither can be stated from the record.
   */
  noteSentence: string | null;
};

export type OversightDivision =
  | { kind: "none"; sentence: string }
  | {
      kind: "divided";
      /** What the fund received in the periods it has divided up. */
      received: OversightFigure;
      takenOut: OversightFigure;
      /** What the ordinance kept in the measure rather than dividing. */
      heldBack: OversightFigure;
      /**
       * `received − takenOut − heldBack`: what the headings below were actually
       * given. Not "the pool the ordinance cut its percentages out of" — that
       * figure excludes only the pool reserves, and a purpose-level reserve
       * comes out after the cut. The three subtractions are chosen to match
       * what the page PRINTS under the headings, because closing the reader's
       * own arithmetic is the whole purpose of the section.
       */
      leftToDivide: OversightFigure;
      clauses: OversightTakeRow[];
      reserves: OversightReserveRow[];
      /** Non-null when nothing was taken out of these periods at all. */
      noClausesSentence: string | null;
      /** Non-null when nothing was kept back out of these periods at all. */
      noReservesSentence: string | null;
      /**
       * Whether the ordinance's headings add up to `leftToDivide`, and by how
       * much they do not. Never a verdict — the difference is stated as a
       * figure with the reasons it can legitimately exist.
       */
      settlementSentence: string;
    };

/**
 * THE ARITHMETIC A COMMITTEE MEMBER DOES IN THEIR HEAD, CLOSED.
 *
 * ============================================================================
 * WHY IT IS SCOPED TO THE PERIODS THAT HAVE BEEN DIVIDED UP
 * ============================================================================
 *
 * The temptation is to subtract every recorded take from the fund's lifetime
 * received total. That produces a number that cannot close: a quarter whose
 * receipt has been recorded but which nobody has applied the ordinance to
 * contributes its whole receipt to the left side and nothing to the right, so
 * the page would show a shortfall that is an artefact of when a clerk last
 * pressed a button. A reader cannot tell that apart from money going missing,
 * and on this surface they have no way to ask.
 *
 * So the three figures span exactly the periods that HAVE been divided up — the
 * periods with at least one recorded allocation — and the coverage sentences
 * name every reporting period left out of them and why. Over that scope the
 * subtraction is real: it is the same receipt, the same clauses and the same
 * division that `allocateMeasureReceipt` performed, read back out of what it
 * wrote.
 *
 * ============================================================================
 * WHAT IT WILL NOT DO
 * ============================================================================
 *
 * It does not assert that the page balances. `setAsideShownTotal` is Σ of the
 * amounts the page actually PRINTS under the ordinance's headings, and the
 * difference between that and `leftToDivide` is stated as a figure whenever it
 * is not zero.
 *
 * ============================================================================
 * WHY THE CHAIN GAINED A THIRD SUBTRACTION (2026-08-12)
 * ============================================================================
 *
 * It used to be `received − takenOut`, and for any ordinance that keeps money
 * back that number was larger than anything the purposes below ever saw. The
 * settlement sentence had to offer a held-back reserve as a possible cause of a
 * difference it could neither show nor rule out, because reserves were computed
 * by the allocator and stored nowhere. `measure_period_reserve` records them,
 * so the cause is now a LINE, and the sentence stops naming an unrecoverable
 * one.
 *
 * What can still produce a difference, and is named when it does:
 *   * a period divided up before reserves were recorded separately — named by
 *     period, and ONLY when the arithmetic actually fails to close (see the
 *     settlement block, which explains why this is not a standing caveat);
 *   * an allocation recorded under a heading the ordinance in force does not
 *     list, which the page cannot print in its table.
 * What is refused is the alternative: printing a difference of nothing by
 * comparing a figure against itself.
 *
 * Every amount is rounded with the invoice register's `roundCurrencyAmount`, so
 * this section agrees to the cent with the same money elsewhere in the product.
 */
export function buildMeasureDivisionSummary(input: {
  currencyCode: string;
  receiptLedger: MeasureReceiptLedger;
  /** The fund's allocation rows. Which periods have been divided up comes from these. */
  allocations: readonly MeasureAllocationLike[];
  takeRead: MeasureOffTheTopTakeRead;
  reserveRead: MeasureReserveRead;
  /** Σ the set-aside amounts the page SHOWS under the ordinance's headings. Null when it shows none. */
  setAsideShownTotal: number | null;
  /** Σ every recorded allocation the claim ledger could place, whatever heading it names. */
  allocatedTotal: number | null;
}): OversightSection<OversightDivision> {
  const { currencyCode } = input;

  if (!input.takeRead.ok) {
    return {
      ok: false,
      sentence:
        "What the ordinance took out before the rest was divided could not be loaded, so this part of the " +
        "page is not shown. That is a problem loading the page — it does not mean nothing was taken out.",
    };
  }

  // A SEPARATE SENTENCE, not the one above. The two reads fail independently and
  // a reader told "what was taken out could not be loaded" when in fact the
  // reserves were the problem has been handed a wrong explanation for a missing
  // section — which on this surface is its own small dishonesty. The section is
  // withheld whole either way, because the three figures only mean anything
  // together.
  if (!input.reserveRead.ok) {
    return {
      ok: false,
      sentence:
        "What the ordinance kept back in reserve could not be loaded, so this part of the page is not " +
        "shown. That is a problem loading the page — it does not mean nothing was kept back.",
    };
  }

  const dividedPeriodIds = new Set(
    input.allocations
      .map((allocation) => (typeof allocation.period_id === "string" ? allocation.period_id.trim() : ""))
      .filter((periodId) => periodId.length > 0)
  );

  const dividedLines = input.receiptLedger.lines.filter(
    (line) => line.periodId !== null && dividedPeriodIds.has(line.periodId)
  );

  if (dividedLines.length === 0) {
    return {
      ok: true,
      value: {
        kind: "none",
        sentence:
          "No reporting period has been divided up under the ordinance yet, so nothing has been taken out " +
          "of this measure, nothing has been kept back in reserve, and nothing has been set aside for the " +
          "purposes below.",
      },
    };
  }

  /* ---- What those periods received ---- */
  let received = 0;
  const dividedWithNoReceipt: string[] = [];
  for (const line of dividedLines) {
    if (line.receivedAmount === null) {
      dividedWithNoReceipt.push(line.periodLabel);
      continue;
    }
    received = roundCurrencyAmount(received + line.receivedAmount);
  }

  // Reporting periods with money recorded that nobody has divided up yet. Named
  // rather than counted: "one period is missing" sends a reader to ask which.
  const reportedNotDivided = input.receiptLedger.lines
    .filter((line) => line.receivedAmount !== null && !(line.periodId && dividedPeriodIds.has(line.periodId)))
    .map((line) => line.periodLabel);

  /* ---- What was taken out of them ---- */
  const clauseOrder: string[] = [];
  const byClause = new Map<
    string,
    { label: string; amount: number; uncapped: number; hasCapped: boolean; hasNotEvaluable: boolean }
  >();
  const periodsWithATake = new Set<string>();
  let takenOut = 0;
  let unreadableTakeCount = 0;

  for (const take of input.takeRead.takes) {
    const periodId = typeof take.period_id === "string" ? take.period_id : null;
    const offTheTopId = typeof take.off_the_top_id === "string" ? take.off_the_top_id.trim() : "";
    if (!periodId || !offTheTopId) continue;
    // A take recorded against a period nobody has divided up cannot be set
    // against anything on this page, so it is left out of the subtraction
    // rather than folded into a figure whose scope it does not share.
    if (!dividedPeriodIds.has(periodId)) continue;

    const amount = parseOptionalAmount(take.amount ?? null);
    if (amount === null) {
      // An unreadable amount is not zero. It cannot be added, and a reader is
      // told rather than shown a total that quietly dropped it.
      unreadableTakeCount += 1;
      continue;
    }
    periodsWithATake.add(periodId);

    const existing = byClause.get(offTheTopId);
    const label = typeof take.label === "string" && take.label.trim() ? take.label.trim() : offTheTopId;
    const uncapped = parseOptionalAmount(take.uncapped_amount ?? null) ?? amount;
    if (existing) {
      existing.amount = roundCurrencyAmount(existing.amount + amount);
      existing.uncapped = roundCurrencyAmount(existing.uncapped + uncapped);
      existing.hasCapped = existing.hasCapped || take.cap_status === "capped";
      existing.hasNotEvaluable = existing.hasNotEvaluable || take.cap_status === "not_evaluable";
    } else {
      clauseOrder.push(offTheTopId);
      byClause.set(offTheTopId, {
        label,
        amount,
        uncapped,
        hasCapped: take.cap_status === "capped",
        hasNotEvaluable: take.cap_status === "not_evaluable",
      });
    }
    takenOut = roundCurrencyAmount(takenOut + amount);
  }

  const dividedWithNoTake = dividedLines
    .filter((line) => line.periodId && !periodsWithATake.has(line.periodId))
    .map((line) => line.periodLabel);

  const clauses: OversightTakeRow[] = clauseOrder.map((offTheTopId) => {
    const clause = byClause.get(offTheTopId) as NonNullable<ReturnType<typeof byClause.get>>;
    const notes: string[] = [];
    if (clause.uncapped > clause.amount) {
      notes.push(
        `The ordinance's own working came to ${formatOversightMoney(clause.uncapped, currencyCode)}; ` +
          `${formatOversightMoney(clause.amount, currencyCode)} was taken` +
          (clause.hasCapped ? ", because the ordinance sets a limit on it." : ", because no more was left to take.")
      );
    }
    if (clause.hasNotEvaluable) {
      notes.push(
        "When this was worked out, what had already been taken this year could not be checked, so the " +
          "ordinance's yearly limit on it may not have held across the whole year."
      );
    }
    return {
      offTheTopId,
      label: clause.label,
      amountText: formatOversightMoney(clause.amount, currencyCode),
      noteSentence: notes.length > 0 ? notes.join(" ") : null,
    };
  });

  /* ---- What was kept back out of them ---- */
  //
  // The same aggregation as the takes, one clause at a time, with one extra
  // question: what the percentage was applied to. A committee member checking a
  // reserve needs the rate AND the figure it was taken of, and stating a rate
  // over periods that used different ones would be worse than stating none —
  // so `percents` is a SET and the sentence appears only when it holds one
  // value. The same for `basisTotal`, which goes null the moment one period's
  // basis figure cannot be read.
  const reserveOrder: string[] = [];
  const byReserve = new Map<
    string,
    {
      label: string;
      amount: number;
      computed: number;
      heldOutOfText: string;
      percents: Set<number>;
      basisTotal: number | null;
    }
  >();
  const periodsWithAReserve = new Set<string>();
  let heldBack = 0;
  let unreadableReserveCount = 0;

  for (const reserve of input.reserveRead.reserves) {
    const periodId = typeof reserve.period_id === "string" ? reserve.period_id : null;
    const reserveId = typeof reserve.reserve_id === "string" ? reserve.reserve_id.trim() : "";
    if (!periodId || !reserveId) continue;
    // Out of a period nobody has divided up, exactly as a take is: it cannot be
    // set against anything on this page.
    if (!dividedPeriodIds.has(periodId)) continue;

    const amount = parseOptionalAmount(reserve.amount ?? null);
    if (amount === null) {
      // An unreadable amount is not zero. It cannot be added, and a reader is
      // told rather than shown a total that quietly dropped it.
      unreadableReserveCount += 1;
      continue;
    }
    periodsWithAReserve.add(periodId);

    const label = typeof reserve.label === "string" && reserve.label.trim() ? reserve.label.trim() : reserveId;
    const computed = parseOptionalAmount(reserve.computed_amount ?? null) ?? amount;
    const percent = parseOptionalAmount(reserve.percent ?? null);
    const basisAmount = parseOptionalAmount(reserve.basis_amount ?? null);
    const categoryLabel =
      typeof reserve.basis_category_label === "string" && reserve.basis_category_label.trim()
        ? reserve.basis_category_label.trim()
        : null;
    // The purpose's own name where there is one. Never the raw category id: a
    // resident cannot use it and it is the agency's internal spelling.
    const heldOutOfText =
      reserve.basis_kind === "category"
        ? categoryLabel ?? "One of the purposes below"
        : reserve.basis_kind === "gross"
          ? "Everything that came in"
          : reserve.basis_kind === "after_off_the_top"
            ? "What was left after the amounts taken out first"
            : "Not recorded";

    const existing = byReserve.get(reserveId);
    if (existing) {
      existing.amount = roundCurrencyAmount(existing.amount + amount);
      existing.computed = roundCurrencyAmount(existing.computed + computed);
      if (percent !== null) existing.percents.add(percent);
      existing.basisTotal =
        existing.basisTotal === null || basisAmount === null
          ? null
          : roundCurrencyAmount(existing.basisTotal + basisAmount);
    } else {
      reserveOrder.push(reserveId);
      byReserve.set(reserveId, {
        label,
        amount,
        computed,
        heldOutOfText,
        percents: percent === null ? new Set() : new Set([percent]),
        basisTotal: basisAmount,
      });
    }
    heldBack = roundCurrencyAmount(heldBack + amount);
  }

  const reserves: OversightReserveRow[] = reserveOrder.map((reserveId) => {
    const reserve = byReserve.get(reserveId) as NonNullable<ReturnType<typeof byReserve.get>>;
    const notes: string[] = [];
    const agreedPercent = reserve.percents.size === 1 ? [...reserve.percents][0] : null;
    if (agreedPercent !== null && reserve.basisTotal !== null) {
      notes.push(
        `The ordinance sets this at ${agreedPercent}% of ` +
          `${formatOversightMoney(reserve.basisTotal, currencyCode)}.`
      );
    }
    if (reserve.computed > reserve.amount) {
      notes.push(
        `The ordinance's own working came to ${formatOversightMoney(reserve.computed, currencyCode)}; ` +
          `${formatOversightMoney(reserve.amount, currencyCode)} was kept back, because no more was left ` +
          "to keep back."
      );
    }
    return {
      reserveId,
      label: reserve.label,
      amountText: formatOversightMoney(reserve.amount, currencyCode),
      heldOutOfText: reserve.heldOutOfText,
      noteSentence: notes.length > 0 ? notes.join(" ") : null,
    };
  });

  // Named rather than counted, and used ONLY by the settlement sentence below.
  // See the block there for why it is not a standing caveat on the figure.
  const dividedWithNoReserve = dividedLines
    .filter((line) => line.periodId && !periodsWithAReserve.has(line.periodId))
    .map((line) => line.periodLabel);

  /* ---- The sentences ---- */
  const periodWord = (count: number) => plural(count, "period", "periods");
  const scope =
    `the ${dividedLines.length} reporting ${periodWord(dividedLines.length)} this measure has divided up ` +
    `(${joinList(dividedLines.map((line) => line.periodLabel))})`;

  const scopeCaveats: string[] = [];
  if (reportedNotDivided.length > 0) {
    scopeCaveats.push(
      `${reportedNotDivided.length} further ${plural(
        reportedNotDivided.length,
        "period has",
        "periods have"
      )} money recorded but ${plural(reportedNotDivided.length, "has", "have")} not been divided up yet ` +
        `(${joinList(reportedNotDivided)}), so nothing from ${plural(
          reportedNotDivided.length,
          "it",
          "them"
        )} is counted here.`
    );
  }
  if (dividedWithNoReceipt.length > 0) {
    scopeCaveats.push(
      `${dividedWithNoReceipt.length} of them ` +
        `(${joinList(dividedWithNoReceipt)}) ${plural(
          dividedWithNoReceipt.length,
          "was",
          "were"
        )} divided up with no amount recorded as received, so this is at least what came in.`
    );
  }

  const takeCaveats: string[] = [];
  if (dividedWithNoTake.length > 0) {
    takeCaveats.push(
      `${dividedWithNoTake.length} of them ` +
        `(${joinList(dividedWithNoTake)}) ${plural(
          dividedWithNoTake.length,
          "has",
          "have"
        )} no amount recorded as taken out — either those amounts were worked out by hand, or the period ` +
        "was divided up before this was written down — so this is at least what was taken."
    );
  }
  if (unreadableTakeCount > 0) {
    takeCaveats.push(
      `${unreadableTakeCount} recorded ${plural(unreadableTakeCount, "amount", "amounts")} could not be ` +
        "read and could not be added, so this is lower than what was actually taken."
    );
  }

  const receivedFigure = oversightFigure({
    amount: received,
    currencyCode,
    coverageSentence: [`Adds up what the fund received in ${scope}.`, ...scopeCaveats].join(" "),
    isFloor: dividedWithNoReceipt.length > 0,
  });

  const takenOutFigure = oversightFigure({
    amount: takenOut,
    currencyCode,
    coverageSentence: [
      `Adds up what the ordinance took out of ${scope} before the rest was divided.`,
      ...takeCaveats,
    ].join(" "),
    isFloor: dividedWithNoTake.length > 0 || unreadableTakeCount > 0,
  });

  /*
   * WHY THIS FIGURE IS NOT A FLOOR WHENEVER A PERIOD HAS NO RESERVE ROW.
   *
   * The take figure above is, and copying that here was the first draft. It is
   * wrong for reserves, and the difference is not cosmetic. MOST ordinances
   * keep nothing back at all — a fund with no reserve clause has no reserve row
   * for any period it has ever divided up — so a floor flag driven by "no row"
   * would sit permanently on a correct 0.00 and, worse, would propagate to the
   * figure below it and put "this could be lower" under the one number the
   * whole section exists to close. A flag that is always on is a flag nobody
   * reads, and this one would be attached to the arithmetic a committee member
   * is being invited to check.
   *
   * The only thing that genuinely makes this figure a lower bound is a recorded
   * amount that could not be READ. A period divided up before reserves were
   * recorded is a real possibility and it is named — in the settlement
   * sentence, which fires exactly when the arithmetic does not close, i.e.
   * exactly when that possibility is doing any harm.
   */
  const heldBackFigure = oversightFigure({
    amount: heldBack,
    currencyCode,
    coverageSentence: [
      `Adds up what the ordinance kept back in reserve out of ${scope} rather than dividing it. An ` +
        "ordinance that keeps nothing back has nothing to record here.",
      ...(unreadableReserveCount > 0
        ? [
            `${unreadableReserveCount} recorded ${plural(
              unreadableReserveCount,
              "amount",
              "amounts"
            )} could not be read and could not be added, so this is lower than what was actually kept back.`,
          ]
        : []),
    ].join(" "),
    isFloor: unreadableReserveCount > 0,
  });

  const leftToDivide = roundCurrencyAmount(received - takenOut - heldBack);
  const leftSentences = [
    "What those periods received, less what the ordinance took out of them and less what it kept back in " +
      "reserve. This is the amount the purposes below were given.",
  ];
  if (takenOutFigure.isFloor || heldBackFigure.isFloor) {
    leftSentences.push(
      "Because not everything taken out or kept back is on the record, this could be lower."
    );
  }
  const leftToDivideFigure = oversightFigure({
    amount: leftToDivide,
    currencyCode,
    coverageSentence: leftSentences.join(" "),
    isFloor: receivedFigure.isFloor && !takenOutFigure.isFloor && !heldBackFigure.isFloor,
  });

  /* ---- Does it close? ---- */
  const settlement: string[] = [];
  /**
   * The closing instruction, held back until every cause has been given.
   *
   * It used to be welded onto the shortfall sentence, and once the causes
   * became sentences of their own the reader was told to treat the difference
   * as unexplained and THEN handed part of the explanation. Ordering copy is
   * not decoration on a surface whose whole job is that a person can follow the
   * arithmetic in one pass.
   */
  let closeAsUnexplained = false;
  if (input.setAsideShownTotal === null) {
    settlement.push(
      "What each of the ordinance's purposes has been given is not shown on this page, so it cannot be " +
        "set against this figure here."
    );
  } else {
    const shownText = formatOversightMoney(input.setAsideShownTotal, currencyCode);
    // Half a cent: the figures compared are both at-the-cent, so anything
    // smaller is float residue rather than money.
    const difference = roundCurrencyAmount(leftToDivide - input.setAsideShownTotal);
    if (Math.abs(difference) < 0.005) {
      settlement.push(
        `The purposes below add up to ${shownText} — the same as the amount left for them, so nothing ` +
          "these periods received is left unexplained on this page."
      );
    } else if (difference > 0) {
      settlement.push(
        `The purposes below add up to ${shownText}, which is ` +
          `${formatOversightMoney(difference, currencyCode)} less than the amount left for them.`
      );
      /*
       * THE CAUSE THAT USED TO BE UNRECOVERABLE, now named only when it can
       * apply. Before reserves were recorded this sentence had to offer "some
       * ordinances hold an amount back" on every shortfall, whether or not the
       * fund held anything back, because the product could not tell. It can
       * now: a period with recorded reserves has them in the figure above, so
       * the only periods that can still hide one are those with no reserve row
       * at all — and they are named, not counted.
       */
      if (dividedWithNoReserve.length > 0) {
        settlement.push(
          `${dividedWithNoReserve.length} of the ${periodWord(dividedWithNoReserve.length)} counted here ` +
            `(${joinList(dividedWithNoReserve)}) ${plural(
              dividedWithNoReserve.length,
              "has",
              "have"
            )} nothing recorded as kept back in reserve — either the ordinance keeps nothing back out of ` +
            `${plural(dividedWithNoReserve.length, "it", "them")}, or ${plural(
              dividedWithNoReserve.length,
              "it was",
              "they were"
            )} divided up before this page began recording reserves as their own line.`
        );
      }
      closeAsUnexplained = true;
    } else {
      settlement.push(
        `The purposes below add up to ${shownText}, which is ` +
          `${formatOversightMoney(Math.abs(difference), currencyCode)} MORE than the amount left for ` +
          "them. The purposes cannot be given more than came in, so something behind these figures is " +
          "wrong; the agency that published this page is the body to ask."
      );
    }

    // Money the ledger placed under a heading the ordinance in force does not
    // list. It is in neither the table below nor the total above it, so a
    // reader adding the column would be short by exactly this much.
    if (input.allocatedTotal !== null) {
      const unlisted = roundCurrencyAmount(input.allocatedTotal - input.setAsideShownTotal);
      if (Math.abs(unlisted) >= 0.005) {
        settlement.push(
          `${formatOversightMoney(Math.abs(unlisted), currencyCode)} of what has been set aside is ` +
            "recorded under a purpose the ordinance shown here does not list, so it does not appear in " +
            "the table below."
        );
      }
    }

    // LAST, after every cause. See `closeAsUnexplained` above.
    if (closeAsUnexplained) {
      settlement.push(
        "Treat what is still unaccounted for as unexplained on this page rather than as money that has " +
          "gone astray."
      );
    }
  }

  return {
    ok: true,
    value: {
      kind: "divided",
      received: receivedFigure,
      takenOut: takenOutFigure,
      heldBack: heldBackFigure,
      leftToDivide: leftToDivideFigure,
      clauses,
      reserves,
      noClausesSentence:
        clauses.length === 0
          ? "The ordinance took nothing out of these periods before the rest was divided."
          : null,
      noReservesSentence:
        reserves.length === 0
          ? "The ordinance kept nothing back in reserve out of these periods."
          : null,
      settlementSentence: settlement.join(" "),
    },
  };
}

/* ------------------------------------------------------------------ *
 * The page model
 * ------------------------------------------------------------------ */

/** A section that either has content or has a reason it does not. */
export type OversightSection<T> = { ok: true; value: T } | { ok: false; sentence: string };

export type OversightPeriodRow = {
  periodLabel: string;
  fiscalYearLabel: string;
  spanText: string | null;
  /** Null means NOBODY HAS REPORTED IT. Never rendered as a zero. */
  receivedText: string | null;
  receivedOnText: string | null;
};

export type OversightReceipts = {
  total: OversightFigure;
  periods: OversightPeriodRow[];
  /** Rows opened with no amount recorded. Named on the page, not just counted. */
  unreportedPeriodLabels: string[];
};

export type OversightCategoryRow = {
  categoryId: string;
  label: string;
  /** The ordinance's own share, as the descriptor states it. Null for narrative rules. */
  shareText: string | null;
  /** Σ what has been set aside under this heading. Null when nothing has been. */
  setAsideText: string | null;
  /**
   * TRUE when the allocations could not be READ, which is a different fact from
   * `setAsideText === null` ("nothing has been set aside"). The page prints one
   * as an amount that is genuinely absent and the other as a section it could
   * not load; before 2026-08-12 a failed allocations read arrived here as `[]`
   * and every category printed "Nothing set aside on the record".
   */
  setAsideUnavailable: boolean;
  /** Σ what has been claimed against it. */
  claimedText: string;
  /** Guard (ii): true when any figure behind this row was typed in by staff. */
  isStaffEntered: boolean;
};

export type OversightOrdinance =
  | {
      kind: "categories";
      rows: OversightCategoryRow[];
      /** True when ANY row is staff-entered, so the page can lead with the note. */
      hasStaffEnteredAmounts: boolean;
      /**
       * Non-null when the allocations could not be read. The ordinance's own
       * headings and shares still render — they come from the rule, which read
       * fine — but every "Set aside" cell is unavailable, and a column of
       * unexplained amber is worse than no column. This is the explanation.
       */
      setAsideUnavailableSentence: string | null;
    }
  | { kind: "narrative"; text: string }
  | { kind: "unavailable"; sentence: string };

export type OversightRecipientRow = {
  recipientId: string;
  name: string;
  kindLabel: string;
  askedForText: string;
  paidText: string;
  askedForCount: number;
  paidCount: number;
  awaitingDecisionCount: number;
  notCountedCount: number;
  yearsText: string | null;
};

export type OversightMoeRow = {
  recipientName: string;
  fiscalYearLabel: string;
  requiredText: string | null;
  reportedText: string | null;
  /** Guard (iii): the sentence printed whenever either side is absent. */
  notDeterminedSentence: string | null;
  differenceText: string | null;
  isShortfall: boolean;
};

export type MeasureOversightModel = {
  title: string;
  subtitleParts: string[];
  currencyCode: string;
  receipts: OversightSection<OversightReceipts>;
  askedFor: OversightSection<OversightFigure>;
  paidOut: OversightSection<OversightFigure>;
  /**
   * NULL when the caller did not supply the recorded takes AND reserves — which
   * is a different thing from a read that failed, and the two must not share a
   * sentence. A surface that silently printed "could not be loaded" for a
   * section its author never wired up would be lying about a database. Both
   * surfaces supply both reads today; the null branch is what keeps the next
   * one honest while it is being written.
   */
  division: OversightSection<OversightDivision> | null;
  ordinance: OversightOrdinance;
  recipients: OversightSection<OversightRecipientRow[]>;
  /**
   * `unavailableSentence` is non-null when the maintenance-of-effort read
   * FAILED. It is not the same as an empty `rows`: the summary sentence for no
   * records says "No local-spending commitments have been recorded for this
   * measure", which is a statement about an agency's compliance obligations
   * that a failed query must never make on its behalf.
   */
  moe: { rows: OversightMoeRow[]; summarySentence: string; unavailableSentence: string | null };
  /** True when anything anywhere on the page was typed in rather than computed. */
  hasStaffEnteredAmounts: boolean;
};

export type MeasureOversightInput = {
  programTitle: string;
  currencyCode: string;
  rateLabel: string | null;
  ordinanceReference: string | null;
  adoptedOn: string | null;
  sunsetOn: string | null;
  sunsetPosture: string;
  receiptResult: MeasureReceiptLedgerResult;
  claimResult: MeasureClaimLedgerResult;
  moeSummary: MeasureMoeSummary;
  rule: MeasureAllocationRule | null;
  /** The reason the rule is absent, when it is. Rendered instead of the split. */
  ruleUnavailableSentence: string | null;
  recipients: ReadonlyArray<{ id: string; name: string; kindLabel: string }>;

  /*
   * ==========================================================================
   * THE THREE READS THAT USED TO ARRIVE AS `[]`
   * ==========================================================================
   *
   * The public page passed `allocationsResult.data ?? []`, `moeResult.data ??
   * []` and the recipients the same way. Each `??` turned a failed query into
   * an answer, and the answers were the worst available ones:
   *
   *   allocations -> every category printed "Nothing set aside on the record"
   *   moe         -> "No local-spending commitments have been recorded"
   *   recipients  -> every row named "An area the agency has not named"
   *
   * All three read as facts about the agency. The page's own banner said, at
   * the same time, that sections it could not load are "shown as unavailable
   * rather than as zero" — so the surface was contradicting itself in the
   * reader's favour and losing.
   *
   * Each is a SENTENCE rather than a boolean so the reason travels with the
   * refusal, and each is null on the ordinary path. The ledger results above
   * already work this way; these three are the reads that had no result shape
   * of their own.
   */
  allocationsUnavailableSentence?: string | null;
  moeUnavailableSentence?: string | null;
  recipientsUnavailableSentence?: string | null;

  /*
   * ==========================================================================
   * WHAT THE ORDINANCE TOOK OUT BEFORE THE REST WAS DIVIDED
   * ==========================================================================
   *
   * All optional, and ALL ARE NEEDED for the section to be built: the takes say
   * what was taken, the reserves say what was kept back, and the allocation
   * rows say which periods have been divided up at all, which is the scope the
   * four figures span. Supplying none leaves `division` null and the section off
   * the surface entirely.
   *
   * WHY THE RESERVES ARE REQUIRED RATHER THAN DEFAULTED TO NONE. A caller that
   * supplied takes and forgot reserves would get a chain that looks complete
   * and understates what was kept back by the whole amount — the defect this
   * lane exists to close, reintroduced by omission. `division` is therefore
   * null unless both reads are handed over, and a surface that wires up one of
   * them gets no section rather than a wrong one.
   */
  offTheTopRead?: MeasureOffTheTopTakeRead;
  reserveRead?: MeasureReserveRead;
  allocations?: readonly MeasureAllocationLike[];

  /**
   * The one fiscal year every figure was scoped to, when it was. Null for the
   * public page, which spans the fund's whole history; set by the annual
   * statement, which does not. See `claimCoverageSentence`.
   */
  fiscalYearLabel?: string | null;
};

/**
 * Build everything the public page renders.
 *
 * Takes the ledger RESULTS, not the ledgers: a page handed only the happy path
 * has to remember to branch, and the branch it forgets renders a failed read as
 * an empty fund. Here the failure is a sentence in the model and there is
 * nothing to forget.
 */
export function buildMeasureOversightModel(input: MeasureOversightInput): MeasureOversightModel {
  const currencyCode = input.currencyCode;
  const recipientNames = new Map(input.recipients.map((recipient) => [recipient.id, recipient]));

  /**
   * Who a row is about, or the honest answer that we could not find out.
   *
   * The three cases are genuinely different and none may borrow another's
   * words: the list could not be loaded; the list loaded and does not contain
   * this id; the list loaded and does. "An area the agency has not named" is a
   * mild criticism of the agency's record-keeping and must not be printed
   * because a query failed.
   */
  const recipientNameFor = (recipientId: string | null | undefined): string => {
    if (input.recipientsUnavailableSentence) return "Which area this is could not be loaded";
    return recipientNames.get(recipientId ?? "")?.name ?? "An area the agency has not named";
  };

  /* ---- Where the money came from ---- */
  let receipts: OversightSection<OversightReceipts>;
  if (!input.receiptResult.ok) {
    receipts = {
      ok: false,
      sentence:
        "The record of what this measure has received could not be loaded. This is a problem loading the " +
        "page — it does not mean the measure has received nothing.",
    };
  } else {
    const ledger = input.receiptResult.ledger;
    const coverage = receiptCoverageSentence(ledger);
    receipts = {
      ok: true,
      value: {
        total: oversightFigure({
          amount: ledger.receivedTotal,
          currencyCode,
          coverageSentence: coverage,
          isFloor: ledger.coverage.isFloor,
        }),
        unreportedPeriodLabels: [...ledger.coverage.missingPeriods],
        periods: ledger.lines.map((line) => ({
          periodLabel: line.periodLabel,
          fiscalYearLabel: line.fiscalYearLabel,
          spanText: formatOversightSpan(line.periodStart, line.periodEnd),
          receivedText:
            line.receivedAmount === null ? null : formatOversightMoney(line.receivedAmount, currencyCode),
          receivedOnText: formatOversightDate(line.receivedOn),
        })),
      },
    };
  }

  /* ---- Claims ---- */
  const claimsUnavailable =
    "The record of what has been claimed against this measure could not be loaded. This is a problem " +
    "loading the page — it does not mean nobody has claimed anything.";

  let askedFor: OversightSection<OversightFigure>;
  let paidOut: OversightSection<OversightFigure>;
  let recipients: OversightSection<OversightRecipientRow[]>;
  let ledgerHasStaffEntered = false;

  if (!input.claimResult.ok) {
    askedFor = { ok: false, sentence: claimsUnavailable };
    paidOut = { ok: false, sentence: claimsUnavailable };
    recipients = { ok: false, sentence: claimsUnavailable };
  } else {
    const ledger = input.claimResult.ledger;
    ledgerHasStaffEntered = ledger.hasManualAllocation;

    askedFor = {
      ok: true,
      value: oversightFigure({
        amount: ledger.claimedGrossTotal,
        currencyCode,
        coverageSentence: claimCoverageSentence(ledger, "asked", input.fiscalYearLabel),
        isFloor: false,
      }),
    };
    paidOut = {
      ok: true,
      value: oversightFigure({
        amount: ledger.paidNetTotal,
        currencyCode,
        coverageSentence: claimCoverageSentence(ledger, "paid", input.fiscalYearLabel),
        isFloor: false,
      }),
    };

    const outcomes = summarizeMeasureRecipientOutcomes(ledger);
    recipients = input.recipientsUnavailableSentence
      ? // The claims loaded and the recipient LIST did not. Every row would be
        // a money figure against "an area the agency has not named", which
        // reads as an agency paying out to bodies it never identified.
        { ok: false, sentence: input.recipientsUnavailableSentence }
      : {
      ok: true,
      value: outcomes.map((outcome) => {
        const known = recipientNames.get(outcome.recipientId);
        return {
          recipientId: outcome.recipientId,
          // Never the raw uuid. A public page that prints a database id is
          // showing a reader something they cannot use and leaking a handle.
          name: known?.name ?? "An area the agency has not named on this page",
          kindLabel: known?.kindLabel ?? "",
          askedForText: formatOversightMoney(outcome.askedForGross, currencyCode),
          paidText: formatOversightMoney(outcome.paidNet, currencyCode),
          askedForCount: outcome.askedForCount,
          paidCount: outcome.paidCount,
          awaitingDecisionCount: outcome.awaitingDecisionCount,
          notCountedCount: outcome.notCountedCount,
          yearsText: outcome.fiscalYearLabels.length ? joinList(outcome.fiscalYearLabels) : null,
        };
      }),
    };
  }

  /* ---- What the ordinance says it must pay for ---- */
  let ordinance: OversightOrdinance;
  /**
   * Σ THE AMOUNTS THIS PAGE ACTUALLY PRINTS under the ordinance's headings.
   *
   * Accumulated from the rows themselves rather than taken from
   * `ledger.allocatedTotal`, and the difference is the whole point: the ledger
   * total includes allocations recorded under headings the rule in force does
   * not list, which this page does not print. The reconciliation compares what
   * a reader can add up on the page against what the page says was left to
   * divide, so it has to be the printed column — and the ledger total is passed
   * separately so the gap between them can be disclosed instead of hidden.
   */
  let setAsideShownTotal: number | null = null;
  if (input.ruleUnavailableSentence) {
    ordinance = { kind: "unavailable", sentence: input.ruleUnavailableSentence };
  } else if (!input.rule) {
    ordinance = {
      kind: "unavailable",
      sentence:
        "The agency has not yet recorded how the ordinance divides this money, so this page cannot show " +
        "the split.",
    };
  } else if (isNarrativeRule(input.rule)) {
    ordinance = { kind: "narrative", text: input.rule.text };
  } else {
    const categoryTotals = input.claimResult.ok ? input.claimResult.ledger.categoryTotals : [];
    const rows: OversightCategoryRow[] = input.rule.categories.map((category) => {
      // Every recorded year for this heading, each counted once by the ledger.
      const totals = categoryTotals.filter((total) => total.categoryId === category.id);
      const setAside = totals.reduce<number | null>((accumulated, total) => {
        if (total.allocatedAmount === null) return accumulated;
        return roundCurrencyAmount((accumulated ?? 0) + total.allocatedAmount);
      }, null);
      const claimed = totals.reduce(
        (accumulated, total) => roundCurrencyAmount(accumulated + total.claimedGross),
        0
      );
      // A FAILED ALLOCATIONS READ IS NOT AN EMPTY SET-ASIDE. With the read
      // failed the ledger was handed no allocation rows at all, so `setAside`
      // is null for every category and the page would print "Nothing set aside
      // on the record" under each heading of the ordinance.
      const setAsideUnavailable = Boolean(input.allocationsUnavailableSentence);
      if (!setAsideUnavailable && setAside !== null) {
        setAsideShownTotal = roundCurrencyAmount((setAsideShownTotal ?? 0) + setAside);
      }
      return {
        categoryId: category.id,
        label: category.label,
        shareText: `${category.percentOfAllocable}% of what is left to divide`,
        setAsideText: setAsideUnavailable || setAside === null ? null : formatOversightMoney(setAside, currencyCode),
        setAsideUnavailable,
        claimedText: formatOversightMoney(claimed, currencyCode),
        // NOT forced true when the read failed. The badge means "this figure
        // was typed in by staff", and with no figure on the row there is
        // nothing to badge — asserting it would swap one false statement for
        // another. `setAsideUnavailable` is what the row says instead.
        isStaffEntered: totals.some((total) => total.hasManualAllocation),
      };
    });
    ordinance = {
      kind: "categories",
      rows,
      hasStaffEnteredAmounts: rows.some((row) => row.isStaffEntered),
      setAsideUnavailableSentence: input.allocationsUnavailableSentence ?? null,
    };
  }

  /* ---- What was taken out before the rest was divided ---- */
  //
  // BUILT AFTER THE ORDINANCE ON PURPOSE: it needs `setAsideShownTotal`, which
  // is the column the reader can add up, and that only exists once the rows do.
  //
  // Three failures reach it as sentences rather than as a section that quietly
  // does not appear. The receipts one is the subtle case: with the periods
  // unreadable there is no scope to span, so the subtraction cannot be
  // performed at all — and a zero here would say the ordinance takes nothing.
  let division: OversightSection<OversightDivision> | null = null;
  if (input.offTheTopRead && input.reserveRead) {
    if (!input.receiptResult.ok) {
      division = {
        ok: false,
        sentence:
          "Which periods this measure has divided up could not be loaded, so what the ordinance took out " +
          "of them is not shown. That is a problem loading the page — it does not mean nothing was taken.",
      };
    } else if (input.allocationsUnavailableSentence) {
      division = {
        ok: false,
        sentence:
          "What each of the ordinance's purposes has been given could not be loaded, so what was taken " +
          "out before the money was divided cannot be set against it here. That is a problem loading the " +
          "page — it does not mean nothing was taken out.",
      };
    } else {
      division = buildMeasureDivisionSummary({
        currencyCode,
        receiptLedger: input.receiptResult.ledger,
        allocations: input.allocations ?? [],
        takeRead: input.offTheTopRead,
        reserveRead: input.reserveRead,
        setAsideShownTotal: ordinance.kind === "categories" ? setAsideShownTotal : null,
        allocatedTotal: input.claimResult.ok ? input.claimResult.ledger.allocatedTotal : null,
      });
    }
  }

  /* ---- What each area promised to keep spending ---- */
  const moeRows: OversightMoeRow[] = input.moeSummary.lines.map((line) => ({
    recipientName: recipientNameFor(line.recipientId),
    fiscalYearLabel: line.fiscalYearLabel,
    requiredText: line.requiredAmount === null ? null : formatOversightMoney(line.requiredAmount, currencyCode),
    reportedText: line.reportedAmount === null ? null : formatOversightMoney(line.reportedAmount, currencyCode),
    // GUARD (iii). `notDeterminedReason` is non-null on exactly the lines where
    // one side is absent, and the sentence is carried through rather than
    // replaced by a dash — a blank cell reads as zero to everyone.
    notDeterminedSentence: line.notDeterminedReason,
    differenceText:
      line.differenceAmount === null
        ? null
        : formatOversightMoney(Math.abs(line.differenceAmount), currencyCode),
    isShortfall: line.status === "shortfall",
  }));

  // "No local-spending commitments have been recorded for this measure" is a
  // statement about what an ordinance requires of every city in the county. A
  // failed query may not make it on the agency's behalf.
  const moeSummarySentence =
    input.moeUnavailableSentence
      ? input.moeUnavailableSentence
      : input.moeSummary.recordCount === 0
      ? "No local-spending commitments have been recorded for this measure."
      : `${input.moeSummary.comparableCount} of ${input.moeSummary.recordCount} ` +
        `${plural(input.moeSummary.recordCount, "record has", "records have")} both figures recorded and can be ` +
        `compared. ${input.moeSummary.notDeterminedCount} ${plural(
          input.moeSummary.notDeterminedCount,
          "does",
          "do"
        )} not, and ${plural(input.moeSummary.notDeterminedCount, "it is", "they are")} shown as not enough ` +
        "recorded to say. Each area's commitment stands on its own — one area spending more does not make " +
        "up for another spending less, so these are not added together.";

  const subtitleParts = [
    input.rateLabel,
    input.ordinanceReference,
    input.adoptedOn ? `Adopted ${formatOversightDate(input.adoptedOn)}` : null,
    input.sunsetPosture === "dated" && input.sunsetOn
      ? `Runs until ${formatOversightDate(input.sunsetOn)}`
      : input.sunsetPosture === "none_in_ordinance"
        ? "The ordinance sets no end date"
        : null,
  ].filter((part): part is string => Boolean(part));

  return {
    title: input.programTitle,
    subtitleParts,
    currencyCode,
    receipts,
    askedFor,
    paidOut,
    division,
    ordinance,
    recipients,
    moe: {
      // NOT emptied when `moeUnavailableSentence` is set, and the reason is
      // worth writing down: a caller with a failed read has no records to
      // summarise, so `moeSummary.lines` is already empty and a `? [] :` here
      // would be a branch nothing can enter. It was written that way first and
      // removed when a mutation to it changed no test — an unreachable
      // safeguard is a safeguard nobody can check. The surface's own
      // `unavailableSentence ? … : rows.length === 0 ? …` ternary is what keeps
      // a table from appearing beside the notice.
      rows: moeRows,
      summarySentence: moeSummarySentence,
      unavailableSentence: input.moeUnavailableSentence ?? null,
    },
    hasStaffEnteredAmounts:
      ledgerHasStaffEntered || (ordinance.kind === "categories" && ordinance.hasStaffEnteredAmounts),
  };
}

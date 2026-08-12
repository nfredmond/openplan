import { esc } from "@/lib/invoicing/html-escape";
import {
  MEASURE_OVERSIGHT_COPY,
  type OversightCategoryRow,
  type OversightDivision,
  type OversightFigure,
  type OversightMoeRow,
  type OversightRecipientRow,
} from "@/lib/measures/oversight";

/**
 * THE ANNUAL STATEMENT — one year of a local measure fund, as a document a
 * committee member can print and take to a meeting.
 *
 * ============================================================================
 * IT CANNOT ADD ANYTHING UP, AND THAT IS THE DESIGN
 * ============================================================================
 *
 * The `reimbursement-worksheet.ts` posture, copied deliberately. Every money
 * value reaching this module is already a STRING — an `OversightFigure` or a
 * pre-formatted row built by `oversight.ts` from the receipt and claim ledgers.
 * There is no number in `MeasureAnnualStatementData` for this file to sum, so a
 * future session cannot introduce a second definition of what the fund
 * received: there is nothing here to define it from. A document that summed its
 * own lines would eventually disagree with the page it was generated from, in
 * front of the body whose whole job is to notice that.
 *
 * `measure-oversight-statement.test.ts` holds the property by TYPE and by
 * fixture: the data shape carries no `number` money field, and a statement
 * built from figures whose text says one thing prints exactly that text.
 *
 * ============================================================================
 * A PARTIAL YEAR SAYS WHICH MONTHS IT HAS
 * ============================================================================
 *
 * The most dangerous document this lane can produce is a statement headed
 * "FY 2026" that silently covers two of four quarters. A committee compares it
 * against the prior year and reads a collapse in revenue that did not happen.
 *
 * So `coverage` is REQUIRED, it is rendered immediately under the title before
 * any figure, and `statementCoverageSentence` names the periods included, the
 * span they cover, and every period that was opened with no amount recorded.
 * `assertStatementCoverage` refuses to build a statement whose coverage lists
 * no periods at all — a statement about nothing is not a document, it is a
 * blank form with an agency's year on it.
 *
 * ============================================================================
 * THE SUBTRACTION IS PART OF THE DOCUMENT, NOT AN OPTION ON IT
 * ============================================================================
 *
 * Until 2026-08-12 this statement printed what the fund received, what was
 * asked for, what was paid out and the ordinance's category table, and NOTHING
 * about the amount the ordinance takes off the top before the categories are
 * cut. A committee member doing the obvious subtraction on a document they had
 * just filed found money with nothing on the page to say where it went — the
 * same defect the public page carried, on the surface with the higher stakes,
 * because this one gets printed and cited.
 *
 * `division` is therefore REQUIRED and non-null. There is no way to build a
 * statement without the section, in the same spirit as `OversightFigure`'s
 * required coverage sentence: a future caller cannot forget it, it would have
 * to delete a field. The route narrows the model's
 * `OversightSection<OversightDivision> | null` before it gets here and refuses
 * the document when the section could not be built, which is the posture the
 * next paragraph but one describes.
 *
 * The arithmetic itself is `buildMeasureDivisionSummary` in `oversight.ts` —
 * the same function the public page uses, producing the same sentences. This
 * module adds ONE sentence of its own, `statementDivisionScopeSentence`,
 * because the two surfaces genuinely differ in scope: the page spans every
 * period the fund has ever divided up, and this document spans one fiscal
 * year's. That difference is stated in a sentence rather than expressed as a
 * second implementation.
 *
 * KNOWN AND DELIBERATE — RESERVES ARE NOT STORED PER PERIOD. An ordinance that
 * holds an amount back in reserve therefore cannot close this subtraction, and
 * the shared builder's settlement sentence names a held-back reserve as a
 * possible cause of the difference. That sentence is inherited here unchanged.
 * A statement that printed the shortfall without it would tell a committee that
 * money is unaccounted for when the product simply does not yet record where it
 * went, and that is the more damaging of the two errors on a filed document.
 *
 * ============================================================================
 * WHAT IT IS NOT
 * ============================================================================
 *
 * Not the audited financial statement, not the agency's official accounting,
 * and not a legal instrument. `STATEMENT_PREPARED_NOTE` says so on the first
 * page and `STATEMENT_FOOTER_NOTE` repeats it small on every page, for the
 * reason `WORKSHEET_FOOTER_NOTE` exists: a fixed footer only repeats under
 * Chrome, and a self-hosted deployment renders through the built-in typesetter
 * where it does not — so the short form is placed in the flow as well.
 */

export const STATEMENT_DOCUMENT_TITLE = "Annual statement";

/** The framing paragraph, in the spirit of WORKSHEET_PREPARED_NOTE. */
export const STATEMENT_PREPARED_NOTE =
  "Prepared by OpenPlan from the records this agency has entered. It is not an audited financial " +
  "statement, it is not the agency's official accounting, and it carries no auditor's opinion. Every " +
  "figure below is only as complete as the records behind it, and this page says where those records " +
  "are missing rather than filling the gaps in.";

export const STATEMENT_FOOTER_NOTE =
  "Generated by OpenPlan from agency records. Not an audited financial statement.";

/**
 * Which periods this statement actually has.
 *
 * `periodsIncluded` is the list of reporting periods with an amount recorded.
 * `unreportedPeriods` is the list opened with none. Both are named, never
 * counted only: "one period is missing" sends a reader to ask which, and the
 * answer is already known.
 */
export type MeasureStatementCoverage = {
  periodsIncluded: string[];
  unreportedPeriods: string[];
  /** "July 1, 2025 to December 31, 2025", or null when no period carries dates. */
  spanText: string | null;
  /** How the fund's ordinance says money arrives — "Quarterly", "Monthly". */
  cadenceLabel: string | null;
};

/**
 * Everything the statement prints.
 *
 * EVERY MONEY FIELD IS TEXT. Adding a `number` here is how the "cannot sum"
 * property is lost, and `measure-oversight-statement.test.ts` fails when one
 * appears.
 */
export type MeasureAnnualStatementData = {
  measureTitle: string;
  agencyName: string | null;
  fiscalYearLabel: string;
  rateLabel: string | null;
  ordinanceReference: string | null;
  coverage: MeasureStatementCoverage;
  received: OversightFigure;
  askedFor: OversightFigure;
  paidOut: OversightFigure;
  /**
   * What the ordinance took out of this year's divided periods, and what was
   * left. REQUIRED — see the module header. A statement whose arithmetic does
   * not close is the document this field exists to make impossible to produce.
   */
  division: OversightDivision;
  categories: OversightCategoryRow[];
  recipients: OversightRecipientRow[];
  moe: { rows: OversightMoeRow[]; summarySentence: string };
  hasStaffEnteredAmounts: boolean;
  /** The date the document was produced, ISO. Rendered, never used in arithmetic. */
  generatedOnText: string;
};

/**
 * The sentence directly under the title.
 *
 * Never omitted and never empty — see the module header. It is built even when
 * everything is complete, because "all four quarters are here" is itself the
 * fact a reader needs in order to trust the total, and a sentence that appears
 * only when something is wrong teaches readers to skip it.
 */
export function statementCoverageSentence(
  coverage: MeasureStatementCoverage,
  fiscalYearLabel: string
): string {
  const parts: string[] = [];
  const included = coverage.periodsIncluded;

  if (included.length === 0) {
    parts.push(
      `No reporting period in ${fiscalYearLabel} has an amount recorded, so this statement has no ` +
        "receipts to report for the year."
    );
  } else {
    parts.push(
      `Covers ${included.length} reporting ${included.length === 1 ? "period" : "periods"} in ` +
        `${fiscalYearLabel} — ${included.join(", ")}${coverage.spanText ? ` (${coverage.spanText})` : ""}.`
    );
  }

  if (coverage.unreportedPeriods.length > 0) {
    parts.push(
      `${coverage.unreportedPeriods.length} further ${
        coverage.unreportedPeriods.length === 1 ? "period has" : "periods have"
      } been opened for this year with no amount recorded yet (${coverage.unreportedPeriods.join(", ")}). ` +
        "The totals below are therefore at least what came in, not necessarily all of it."
    );
  }

  if (coverage.cadenceLabel) {
    parts.push(`The ordinance's reporting cadence for this fund is: ${coverage.cadenceLabel.toLowerCase()}.`);
  }

  return parts.join(" ");
}

/**
 * THE ONE SENTENCE THIS DOCUMENT ADDS TO THE SHARED SECTION.
 *
 * `buildMeasureDivisionSummary` writes its coverage sentences about "the
 * reporting periods this measure has divided up". On the public page that is
 * the fund's whole history and the phrase is complete. Here every read was
 * filtered to one fiscal year first, so the same phrase would let a reader
 * believe the measure has divided up only the periods this document names —
 * and a committee holding four annual statements would read four separate
 * lifetimes.
 *
 * The scope is therefore stated in words, ONCE, at the head of the section and
 * before any figure. The alternative was a second set of coverage sentences
 * for the statement, which is a second wording of the same arithmetic and the
 * thing this lane keeps paying for.
 */
export function statementDivisionScopeSentence(fiscalYearLabel: string): string {
  return (
    `Everything in this section is limited to ${fiscalYearLabel}. It counts only the reporting periods in ` +
    "that year the ordinance has already been applied to, so amounts taken out in an earlier or later " +
    "year are no part of these figures."
  );
}

/**
 * Refuse a statement that covers nothing at all.
 *
 * Thrown rather than rendered empty. A document with an agency's name, a fiscal
 * year and no periods behind it is the shape somebody files and cites; refusing
 * to produce it is cheaper than explaining it later.
 */
function assertStatementCoverage(coverage: MeasureStatementCoverage): void {
  if (coverage.periodsIncluded.length === 0 && coverage.unreportedPeriods.length === 0) {
    throw new Error(
      "measure annual statement: no reporting period belongs to this fiscal year, so there is nothing to state"
    );
  }
}

const DOCUMENT_STYLES = `
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a2330; margin: 0; padding: 40px 48px 96px; font-size: 12px; line-height: 1.55; }
  header { border-bottom: 2px solid #1a2330; padding-bottom: 14px; margin-bottom: 18px; }
  .doc-title { font-size: 24px; font-weight: 700; margin: 0; letter-spacing: 0.03em; }
  .measure-name { font-size: 15px; margin: 4px 0 0; }
  .header-meta { margin: 8px 0 0; color: #44506a; }
  .header-meta span { display: inline-block; margin-right: 18px; }
  .coverage { border: 1px solid #1a2330; background: #f2f4f8; padding: 10px 14px; margin: 0 0 16px; }
  .prepared-note { border-left: 3px solid #44506a; background: #f7f8fb; padding: 8px 14px; margin: 0 0 20px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #6a7690; margin: 0 0 8px; }
  section { margin-bottom: 22px; }
  table { width: 100%; border-collapse: collapse; }
  table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #6a7690; border-bottom: 1px solid #c6cdda; padding: 5px 8px; }
  table td { border-bottom: 1px solid #e4e8ef; padding: 6px 8px; vertical-align: top; }
  th.num, td.num { text-align: right; white-space: nowrap; }
  .chain-figure { border-left: 3px solid #c6cdda; padding-left: 12px; margin: 0 0 12px; }
  .figure { font-size: 20px; font-weight: 700; margin: 0; }
  .figure-note { color: #44506a; margin: 3px 0 0; }
  .floor-flag { display: inline-block; border: 1px solid #8a3324; color: #8a3324; padding: 1px 6px; font-size: 10px; margin-left: 8px; vertical-align: middle; }
  .staff-flag { display: inline-block; border: 1px solid #6a7690; color: #44506a; padding: 1px 6px; font-size: 10px; }
  .note { color: #6a7690; margin: 6px 0 0; }
  .empty { color: #6a7690; font-style: italic; }
  .undetermined { color: #44506a; font-style: italic; }
  .page-footer { position: fixed; bottom: 0; left: 0; right: 0; padding: 8px 48px; border-top: 1px solid #c6cdda; background: #ffffff; color: #44506a; font-size: 9px; }
`;

/**
 * A headline figure and the sentence it may not be printed without.
 *
 * THE ONLY PLACE `coverageSentence` IS RENDERED in this document, which is what
 * keeps it from becoming optional. The division section below needs three
 * figures INSIDE a section of its own rather than as three sections, so the
 * body is split from its wrapper — a second copy of these four lines is exactly
 * how a figure eventually appears somewhere without its sentence.
 */
function figureBody(heading: string, figure: OversightFigure): string {
  return `
        <h2>${esc(heading)}</h2>
        <p class="figure">${esc(figure.amountText)}${
          figure.isFloor ? `<span class="floor-flag">At least this much</span>` : ""
        }</p>
        <p class="figure-note">${esc(figure.coverageSentence)}</p>`;
}

function figureBlock(heading: string, figure: OversightFigure): string {
  return `
      <section>${figureBody(heading, figure)}
      </section>`;
}

/**
 * WHAT THE ORDINANCE TOOK OUT BEFORE THE REST WAS DIVIDED.
 *
 * The page's section, in the page's words, in the page's order: the scope
 * sentence, the explainer, the three figures in the order the arithmetic runs,
 * the clause table, and the sentence that says whether the ordinance's headings
 * add back up to what was left.
 *
 * The chain is three figures rather than a total and a footnote for the reason
 * the page gives: the middle one is the amount that was missing from this
 * document, and a reader has to be able to see it as a number of its own.
 */
function divisionSection(data: MeasureAnnualStatementData): string {
  const head = `
        <h2>${esc(MEASURE_OVERSIGHT_COPY.divisionHeading)}</h2>
        <p class="note">${esc(statementDivisionScopeSentence(data.fiscalYearLabel))}</p>
        <p class="note">${esc(MEASURE_OVERSIGHT_COPY.divisionExplainer)}</p>`;

  if (data.division.kind === "none") {
    return `
      <section>${head}
        <p class="empty">${esc(data.division.sentence)}</p>
      </section>`;
  }

  const chain = [
    [MEASURE_OVERSIGHT_COPY.divisionReceivedHeading, data.division.received],
    [MEASURE_OVERSIGHT_COPY.divisionTakenOutHeading, data.division.takenOut],
    [MEASURE_OVERSIGHT_COPY.divisionLeftHeading, data.division.leftToDivide],
  ] as const;

  const clauses = data.division.noClausesSentence
    ? `<p class="empty">${esc(data.division.noClausesSentence)}</p>`
    : `<table>
          <thead>
            <tr><th>${esc(MEASURE_OVERSIGHT_COPY.divisionClauseColumn)}</th><th class="num">${esc(
              MEASURE_OVERSIGHT_COPY.divisionAmountColumn
            )}</th><th>${esc(MEASURE_OVERSIGHT_COPY.divisionNoteColumn)}</th></tr>
          </thead>
          <tbody>${data.division.clauses
            .map(
              (clause) => `
            <tr>
              <td>${esc(clause.label)}</td>
              <td class="num">${esc(clause.amountText)}</td>
              <td>${clause.noteSentence ? esc(clause.noteSentence) : "—"}</td>
            </tr>`
            )
            .join("")}
          </tbody>
        </table>`;

  return `
      <section>${head}
        ${chain.map(([heading, figure]) => `<div class="chain-figure">${figureBody(heading, figure)}
        </div>`).join("")}
        ${clauses}
        <p class="note">${esc(data.division.settlementSentence)}</p>
      </section>`;
}

function categoriesSection(data: MeasureAnnualStatementData): string {
  if (data.categories.length === 0) {
    return `
      <section>
        <h2>${esc(MEASURE_OVERSIGHT_COPY.ordinanceHeading)}</h2>
        <p class="empty">The agency has not recorded how the ordinance divides this money.</p>
      </section>`;
  }

  const rows = data.categories
    .map(
      (row) => `
          <tr>
            <td>${esc(row.label)}${
              row.isStaffEntered
                ? ` <span class="staff-flag">${esc(MEASURE_OVERSIGHT_COPY.staffEnteredBadge)}</span>`
                : ""
            }</td>
            <td>${row.shareText ? esc(row.shareText) : '<span class="empty">Set out in the ordinance text</span>'}</td>
            <td class="num">${
              row.setAsideText
                ? esc(row.setAsideText)
                : '<span class="empty">Nothing set aside on the record</span>'
            }</td>
            <td class="num">${esc(row.claimedText)}</td>
          </tr>`
    )
    .join("");

  return `
      <section>
        <h2>${esc(MEASURE_OVERSIGHT_COPY.ordinanceHeading)}</h2>
        <table>
          <thead>
            <tr><th>Purpose</th><th>Share</th><th class="num">Set aside</th><th class="num">Claimed against it</th></tr>
          </thead>
          <tbody>${rows}
          </tbody>
        </table>
        ${
          data.hasStaffEnteredAmounts
            ? `<p class="note">${esc(MEASURE_OVERSIGHT_COPY.staffEnteredNote)}</p>`
            : ""
        }
      </section>`;
}

function recipientsSection(data: MeasureAnnualStatementData): string {
  if (data.recipients.length === 0) {
    return `
      <section>
        <h2>${esc(MEASURE_OVERSIGHT_COPY.recipientsHeading)}</h2>
        <p class="empty">No city, district or other body has filed a claim against this measure.</p>
      </section>`;
  }

  const rows = data.recipients
    .map(
      (row) => `
          <tr>
            <td>${esc(row.name)}${row.kindLabel ? `<br /><span class="note">${esc(row.kindLabel)}</span>` : ""}</td>
            <td class="num">${esc(row.askedForText)}<br /><span class="note">${row.askedForCount} ${
              row.askedForCount === 1 ? "claim" : "claims"
            }</span></td>
            <td class="num">${esc(row.paidText)}<br /><span class="note">${row.paidCount} paid</span></td>
            <td>${
              row.awaitingDecisionCount > 0
                ? `${row.awaitingDecisionCount} still waiting on a decision`
                : '<span class="empty">Nothing outstanding</span>'
            }${
              row.notCountedCount > 0
                ? `<br /><span class="note">${row.notCountedCount} not counted (being prepared, turned down or withdrawn)</span>`
                : ""
            }</td>
          </tr>`
    )
    .join("");

  return `
      <section>
        <h2>${esc(MEASURE_OVERSIGHT_COPY.recipientsHeading)}</h2>
        <table>
          <thead>
            <tr><th>Who</th><th class="num">Asked for</th><th class="num">Paid</th><th>Outstanding</th></tr>
          </thead>
          <tbody>${rows}
          </tbody>
        </table>
      </section>`;
}

function moeSection(data: MeasureAnnualStatementData): string {
  const rows = data.moe.rows
    .map(
      (row) => `
          <tr>
            <td>${esc(row.recipientName)}</td>
            <td>${esc(row.fiscalYearLabel)}</td>
            <td class="num">${
              row.requiredText ? esc(row.requiredText) : '<span class="empty">Not recorded</span>'
            }</td>
            <td class="num">${
              row.reportedText ? esc(row.reportedText) : '<span class="empty">Not recorded</span>'
            }</td>
            <td>${
              row.notDeterminedSentence
                ? `<span class="undetermined">${esc(MEASURE_OVERSIGHT_COPY.notDeterminedLabel)} — ${esc(
                    row.notDeterminedSentence
                  )}</span>`
                : row.isShortfall
                  ? `Spent ${esc(row.differenceText ?? "")} less than required`
                  : `Spent ${esc(row.differenceText ?? "")} more than required`
            }</td>
          </tr>`
    )
    .join("");

  return `
      <section>
        <h2>${esc(MEASURE_OVERSIGHT_COPY.moeHeading)}</h2>
        <p class="note">${esc(MEASURE_OVERSIGHT_COPY.moeExplainer)}</p>
        ${
          data.moe.rows.length === 0
            ? `<p class="empty">${esc(data.moe.summarySentence)}</p>`
            : `<table>
          <thead>
            <tr><th>Who</th><th>Year</th><th class="num">Required</th><th class="num">Spent</th><th>Result</th></tr>
          </thead>
          <tbody>${rows}
          </tbody>
        </table>
        <p class="note">${esc(data.moe.summarySentence)}</p>`
        }
      </section>`;
}

/**
 * Build the complete annual statement as one self-contained HTML string.
 *
 * Pure: data in, markup out, no I/O and no clock — `generatedOnText` is given
 * by the caller so the same inputs always produce the same document, which is
 * what makes a statement two people printed on different days comparable.
 */
export function buildMeasureAnnualStatementHtml(data: MeasureAnnualStatementData): string {
  assertStatementCoverage(data.coverage);

  const meta = [
    data.rateLabel,
    data.ordinanceReference,
    `Prepared ${data.generatedOnText}`,
  ].filter((part): part is string => Boolean(part));

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${esc(STATEMENT_DOCUMENT_TITLE)} ${esc(data.fiscalYearLabel)} — ${esc(data.measureTitle)}</title>
    <style>${DOCUMENT_STYLES}</style>
  </head>
  <body>
    <header>
      <p class="doc-title">${esc(STATEMENT_DOCUMENT_TITLE)} · ${esc(data.fiscalYearLabel)}</p>
      <p class="measure-name">${esc(data.measureTitle)}${
        data.agencyName ? ` — ${esc(data.agencyName)}` : ""
      }</p>
      <p class="header-meta">${meta.map((part) => `<span>${esc(part)}</span>`).join("")}</p>
    </header>

    <p class="coverage">${esc(statementCoverageSentence(data.coverage, data.fiscalYearLabel))}</p>
    <p class="prepared-note">${esc(STATEMENT_PREPARED_NOTE)}</p>
${figureBlock(MEASURE_OVERSIGHT_COPY.receiptsHeading, data.received)}
${figureBlock("What cities and districts asked for", data.askedFor)}
${figureBlock("What the fund paid out", data.paidOut)}
${divisionSection(data)}
${categoriesSection(data)}
${recipientsSection(data)}
${moeSection(data)}

    <p class="page-footer">${esc(STATEMENT_FOOTER_NOTE)}</p>
  </body>
</html>`;
}

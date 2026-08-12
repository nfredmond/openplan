/**
 * THE REIMBURSEMENT WORKSHEET — the printable packet an agency takes into a
 * reimbursement claim against its funder.
 *
 * WHAT THIS IS NOT, said first because the whole design turns on it:
 *
 *   1. It is not OpenPlan billing anyone. The money direction here is an agency
 *      claiming reimbursement FROM its funder. Nothing here prices, charges, or
 *      gates anything.
 *   2. **It is not a funder's form.** It carries no form id, no exhibit number,
 *      no revision date, and it never calls itself official or certified. Every
 *      page says so — see `WORKSHEET_PREPARED_NOTE`, which is asserted by
 *      `src/test/a-reimbursement-worksheet-is-not-a-funders-form.test.ts`. A
 *      document that LOOKS like the exhibit a funder requires, and is not, is
 *      worse than no document: a planner would submit it.
 *
 * THE SEAM THAT MAKES THE MONEY TRUSTWORTHY. This builder is handed an
 * `AwardDrawdownLedger` and `LedgerInvoiceLine` objects — never raw invoice
 * rows. It therefore CANNOT compute what the award has claimed, been paid, or
 * has left; it can only render figures the ledger already derived. That is a
 * structural property, not a convention: there is nothing here to sum from.
 * A document that summed its own lines would be a second definition of the same
 * money, and the two would eventually disagree in front of a funder.
 *
 * The one exception is the itemized cost section, whose rows come from a table
 * (`project_spend_entries`) the ledger knows nothing about. Its arithmetic is
 * isolated in `summarizeWorksheetCostEntries` — one exported pure function,
 * pinned by a hand-derived fixture — rather than inlined into the markup, for
 * exactly the same reason.
 *
 * WHERE THE WORDS COME FROM. Every jurisdiction-specific string on the packet
 * comes off the bound `ReimbursementProfileBinding`: the profile name, its
 * framing note, its documentation checklist, its submit-to hint. This file
 * names no country, no state, no funder, and no program. Adding a jurisdiction
 * is a descriptor under `profiles/` plus a registration line — never an edit
 * here. `src/test/reimbursement-worksheet.test.ts` proves that with a pretend
 * funder's profile that has never been registered.
 *
 * NOTHING UNRECORDED IS ZERO. A read that failed renders as a failure, an
 * absent period cost ledger renders as "no cost entries recorded", and an award
 * with no authorized amount renders as "Not recorded". None of them render as
 * $0.00 — a zero on a money document reads as an actionable fact.
 */

import { esc } from "@/lib/invoicing/html-escape";
import { parseCurrencyAmount, roundCurrencyAmount } from "@/lib/invoicing/invoice-records";
import type { AwardDrawdownLedger, LedgerInvoiceLine } from "@/lib/invoicing/drawdown-ledger";
import type { ReimbursementProfileBinding } from "@/lib/invoicing/reimbursement-profile-binding";

/**
 * The sentence that keeps this document from being mistaken for the funder's
 * own paperwork. It appears in the body of page one AND in a footer that
 * repeats on every printed page, because page one is the page that gets
 * separated from the packet.
 *
 * Changing this wording changes what OpenPlan claims about a document an agency
 * hands a funder. The guard asserts the string, so a reword is a deliberate act
 * with a failing test attached.
 */
export const WORKSHEET_PREPARED_NOTE =
  "Prepared by OpenPlan from records this workspace entered. It is not a funder's form and carries no " +
  "form or revision number. Check it against the exhibit your funding agreement currently requires " +
  "before you submit.";

/**
 * What OpenPlan says when a profile declares a form-pack status.
 *
 * The raw `formPackStatus` value is an enum-ish token authored for the registry
 * ("deferred_exact_forms"), not a sentence for a planner. Printing the token
 * would be the same defect as printing a status code at a person; printing this
 * sentence says the one thing the token means that matters here.
 */
export const WORKSHEET_NO_FORM_PACK_NOTE =
  "OpenPlan does not generate this jurisdiction's exhibit packet.";

/** The document's title, everywhere. Never "Invoice" — this is not a claim. */
export const WORKSHEET_DOCUMENT_TITLE = "Reimbursement worksheet";

/**
 * The prepared note, short enough to be a PER-PAGE PDF FOOTER.
 *
 * WHY A SECOND, SHORTER STRING EXISTS. `WORKSHEET_PREPARED_NOTE` reaches every
 * printed page only under Chrome, where `.page-footer { position: fixed }` is a
 * repeating footer. Through the BUILT-IN typesetter — the tier a self-hosted
 * deployment with no Chrome always gets, and CLAUDE.md makes self-hosting
 * first-class — `htmlToPdfBlocks` has no concept of a fixed element: that div
 * became two ordinary paragraphs somewhere in the flow, and every page after
 * the first carried no disclaimer at all while the real per-page footer said
 * "Page 2 of 4 · Reimbursement worksheet". A middle page pulled out of a packet
 * was then an official-looking table of an agency's claim position with nothing
 * on it saying who made it.
 *
 * So this goes through `footerLabel`, which the built-in writer stamps on every
 * page. It is short because that footer is one 8pt line: it must name the maker
 * and deny the claim, and the full three sentences do not fit. The long form
 * still carries the "check it against your agreement" instruction on page one.
 *
 * ASCII only, deliberately — no em dash, no curly apostrophe. The PDF writer
 * transliterates what WinAnsi cannot encode and records the rest as
 * unsupported; a footer is the last place to spend that budget.
 */
export const WORKSHEET_FOOTER_NOTE =
  "Reimbursement worksheet prepared by OpenPlan - not a funder's form";

export type WorksheetPeriod = {
  start: string | null;
  end: string | null;
};

export type WorksheetWorkspace = {
  name?: string | null;
} | null;

export type WorksheetAward = {
  title?: string | null;
  /** The project the award funds, for the header line. Never a money figure. */
  projectName?: string | null;
};

/** One `project_spend_entries` row, in the shape the worksheet needs it. */
export type WorksheetCostEntryLike = {
  entry_date?: string | null;
  description?: string | null;
  vendor_label?: string | null;
  amount?: number | string | null;
};

/**
 * The cost rows, or the reason there are none to show.
 *
 * Same discriminated shape as the ledger's `DrawdownInvoiceRead`, and for the
 * same reason: a failed read arriving as `[]` would print "no cost entries
 * recorded for this period" — a sentence that is a database error wearing the
 * clothes of a finding.
 */
export type WorksheetCostEntryRead =
  | { ok: true; entries: readonly WorksheetCostEntryLike[] }
  | { ok: false; pending: boolean; message: string };

export type WorksheetCostLine = {
  entryDate: string | null;
  description: string | null;
  vendorLabel: string | null;
  amount: number;
};

export type WorksheetCostSection =
  | {
      ok: true;
      lines: readonly WorksheetCostLine[];
      /**
       * Σ of the lines above, or NULL when there are no lines.
       *
       * Null rather than 0: "costs recorded this period: $0.00" states that
       * someone looked and found nothing spent, which is a different claim from
       * "nobody has entered any cost rows for this period".
       */
      recordedTotal: number | null;
    }
  | { ok: false; pending: boolean; message: string };

/**
 * Sum the period's recorded project costs.
 *
 * The ONLY arithmetic in this module, deliberately exported and deliberately
 * separate from the markup so a hand-derived fixture can pin it to the cent and
 * a mutation to the addition changes a number a test names.
 *
 * Rounded after each addition, matching `summarizeBillingInvoiceRecords` and
 * the drawdown ledger, so every money figure in the product accumulates float
 * residue the same way instead of three ways.
 */
export function summarizeWorksheetCostEntries(read: WorksheetCostEntryRead): WorksheetCostSection {
  if (!read.ok) {
    return { ok: false, pending: read.pending, message: read.message };
  }

  const lines: WorksheetCostLine[] = read.entries.map((entry) => ({
    entryDate: typeof entry.entry_date === "string" && entry.entry_date ? entry.entry_date : null,
    description: typeof entry.description === "string" && entry.description ? entry.description : null,
    vendorLabel: typeof entry.vendor_label === "string" && entry.vendor_label ? entry.vendor_label : null,
    amount: parseCurrencyAmount(entry.amount),
  }));

  if (lines.length === 0) {
    return { ok: true, lines, recordedTotal: null };
  }

  let recordedTotal = 0;
  for (const line of lines) {
    recordedTotal = roundCurrencyAmount(recordedTotal + line.amount);
  }

  return { ok: true, lines, recordedTotal };
}

export type WorksheetInvoiceSelection = {
  lines: readonly LedgerInvoiceLine[];
  /** True when a period actually narrowed the set; false when every line is shown. */
  scopedToPeriod: boolean;
  /**
   * Invoices excluded from the period table because they carry no invoice date.
   *
   * REPORTED, never silently dropped. A date-scoped view that quietly omits
   * undated rows shows a planner a shorter list than their register holds and
   * gives them no way to notice.
   */
  excludedForMissingDate: number;
};

/**
 * Choose which ledger lines belong in the period table.
 *
 * Selection, not arithmetic: no line's figures are touched, and the whole-award
 * position on the packet always comes from the full ledger regardless of what
 * this returns. Dates are compared as ISO `YYYY-MM-DD` strings, which orders
 * correctly by construction and avoids dragging a timezone into a date column.
 */
export function selectWorksheetInvoiceLines(
  lines: readonly LedgerInvoiceLine[],
  period: WorksheetPeriod | null | undefined
): WorksheetInvoiceSelection {
  const start = period?.start?.trim() || null;
  const end = period?.end?.trim() || null;

  if (!start && !end) {
    return { lines, scopedToPeriod: false, excludedForMissingDate: 0 };
  }

  const selected: LedgerInvoiceLine[] = [];
  let excludedForMissingDate = 0;

  for (const line of lines) {
    if (!line.invoiceDate) {
      excludedForMissingDate += 1;
      continue;
    }
    if (start && line.invoiceDate < start) continue;
    if (end && line.invoiceDate > end) continue;
    selected.push(line);
  }

  return { lines: selected, scopedToPeriod: true, excludedForMissingDate };
}

export type ReimbursementWorksheetData = {
  workspace: WorksheetWorkspace;
  award: WorksheetAward;
  /** Null when the packet covers the award to date rather than one period. */
  period: WorksheetPeriod | null;
  /** The whole-award position. Every money figure on the packet is read from here. */
  ledger: AwardDrawdownLedger;
  /** The bound profile — the ONLY source of jurisdiction-specific wording. */
  profile: ReimbursementProfileBinding;
  /** Why an interim default applied, quoted verbatim when one did. */
  interimDefaultRationale?: string | null;
  costs: WorksheetCostSection;
  /**
   * ISO-4217 code for the amounts. The invoice register records no currency
   * column, so this defaults to USD exactly as `invoice-pdf.ts` does — carried
   * as an input so a future currency column is a data change, not a code change.
   */
  currencyCode?: string | null;
  /** When the packet was produced. Not a claim about when anything happened. */
  generatedAt?: string | null;
  /**
   * Anything the assembling route degraded on — e.g. payment dates unavailable
   * because a migration has not been applied yet. Rendered verbatim; an
   * undisclosed degradation is the defect.
   */
  assemblyNotices?: readonly string[];
};

/**
 * Which currency this packet's figures are in, and whether anyone said so.
 *
 * Precedence: the caller's explicit code, then the bound profile's — the
 * currency is a property of the funding process, so the profile is the right
 * place for it — and US dollars only as a last resort. `declared` carries
 * whether that last resort was taken, because the defect being fixed is not
 * that USD was the fallback; it is that a packet formatted every figure as US
 * dollars with NOTHING on it naming a currency, so a non-US agency's packet
 * looked exactly like a correct one.
 *
 * When nothing declares a currency the packet says so, in the same breath as
 * saying it is showing dollars. A silent assumption is the only version of this
 * that can mislead.
 */
export function resolveWorksheetCurrency(data: {
  currencyCode?: string | null;
  profile?: { currencyCode?: string | null } | null;
}): { code: string; declared: boolean } {
  const explicit = data.currencyCode?.trim().toUpperCase();
  if (explicit) return { code: explicit, declared: true };

  const fromProfile = data.profile?.currencyCode?.trim().toUpperCase();
  if (fromProfile) return { code: fromProfile, declared: true };

  return { code: "USD", declared: false };
}

/** The sentence naming the currency, which every packet now carries. */
export function worksheetCurrencyNote(currency: { code: string; declared: boolean }): string {
  return currency.declared
    ? `All amounts on this worksheet are in ${currency.code}.`
    : `All amounts on this worksheet are shown in USD. This reimbursement process does not ` +
      `declare a currency, so USD is an assumption OpenPlan made, not a fact from your record.`;
}

function formatAmount(value: number, currencyCode: string | null | undefined): string {
  const code = currencyCode?.trim().toUpperCase() || "USD";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(value);
  } catch {
    // An unrecognized code must not sink the document. `code` is escaped
    // because it is an input like any other.
    return `${value.toFixed(2)} ${esc(code)}`;
  }
}

/** A nullable money figure. Null is "Not recorded" — never a zero. */
function formatNullableAmount(value: number | null, currencyCode: string | null | undefined): string {
  return value === null ? "Not recorded" : formatAmount(value, currencyCode);
}

function statusLabel(status: string): string {
  const words = status.trim().toLowerCase().split(/[_\s-]+/).filter(Boolean);
  if (words.length === 0) return "Not recorded";
  return [words[0].charAt(0).toUpperCase() + words[0].slice(1), ...words.slice(1)].join(" ");
}

function textOr(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? esc(trimmed) : fallback;
}

function periodLabel(period: WorksheetPeriod | null): string {
  const start = period?.start?.trim();
  const end = period?.end?.trim();
  if (!start && !end) return "Award to date — no period selected";
  return `${start ? esc(start) : "…"} to ${end ? esc(end) : "…"}`;
}

function figureRow(label: string, value: string, note?: string): string {
  return `<tr>
        <th scope="row">${esc(label)}${note ? `<span class="row-note">${esc(note)}</span>` : ""}</th>
        <td class="num">${value}</td>
      </tr>`;
}

function ledgerSection(data: ReimbursementWorksheetData): string {
  const { ledger } = data;
  const resolvedCurrency = resolveWorksheetCurrency(data);
  const currency = resolvedCurrency.code;
  const overClaimed = ledger.remainingAuthorized !== null && ledger.remainingAuthorized < 0;

  const rows = [
    figureRow("Authorized amount", formatNullableAmount(ledger.authorizedAmount, currency)),
    figureRow(
      "Claimed to date (gross)",
      formatAmount(ledger.claimedGrossToDate, currency),
      `${ledger.claimedCount} invoice record${ledger.claimedCount === 1 ? "" : "s"}`
    ),
    figureRow(
      "Paid to date (net of retention)",
      formatAmount(ledger.paidToDate, currency),
      `${ledger.paidCount} invoice record${ledger.paidCount === 1 ? "" : "s"}`
    ),
    figureRow(
      "Claimed and not yet paid (net)",
      formatAmount(ledger.outstandingClaimed, currency),
      `${ledger.outstandingCount} invoice record${ledger.outstandingCount === 1 ? "" : "s"}`
    ),
    figureRow("Retention withheld on paid invoices", formatAmount(ledger.retentionHeld, currency)),
    figureRow(
      "Retention proposed on unpaid claims",
      formatAmount(ledger.retentionPendingOnUnpaid, currency),
      "proposed, not yet withheld"
    ),
    figureRow("Remaining against the authorization", formatNullableAmount(ledger.remainingAuthorized, currency)),
    figureRow(
      "Drafted, not yet claimed (net)",
      formatAmount(ledger.draftedNotClaimed, currency),
      `${ledger.draftedCount} draft${ledger.draftedCount === 1 ? "" : "s"} — not included in any total above`
    ),
    figureRow(
      "Rejected by the funder (gross)",
      formatAmount(ledger.rejectedGross, currency),
      `${ledger.rejectedCount} record${ledger.rejectedCount === 1 ? "" : "s"} — not included in any total above`
    ),
    figureRow(
      "Local match recorded on the award",
      formatNullableAmount(ledger.matchAmount, currency),
      ledger.matchPosture ? `posture recorded as "${ledger.matchPosture}"` : "no match posture recorded"
    ),
  ].join("\n");

  const overClaimNotice = overClaimed
    ? `<p class="alert">Claims against this award exceed its authorized amount. The remaining figure above is negative and is shown as recorded, not clamped to zero.</p>`
    : "";

  // The currency, named on the document. Every figure below used to be
  // formatted as US dollars with nothing anywhere saying so, which is only
  // invisible until the funder is not American.
  const currencyNotice = `<p class="${resolvedCurrency.declared ? "note" : "alert"}">${esc(
    worksheetCurrencyNote(resolvedCurrency)
  )}</p>`;

  return `<section class="ledger">
      <h2>Award position</h2>
      ${currencyNotice}
      <table class="figures">
        <tbody>
          ${rows}
        </tbody>
      </table>
      ${overClaimNotice}
    </section>`;
}

function invoiceSection(data: ReimbursementWorksheetData, selection: WorksheetInvoiceSelection): string {
  const currency = resolveWorksheetCurrency(data).code;

  const heading = selection.scopedToPeriod ? "Invoice records in this period" : "Invoice records on this award";

  if (selection.lines.length === 0) {
    const empty = selection.scopedToPeriod
      ? "No invoice records carry an invoice date inside this period."
      : "No invoice records are linked to this award.";
    return `<section class="invoices">
      <h2>${esc(heading)}</h2>
      <p class="empty">${esc(empty)}</p>
      ${missingDateNotice(selection)}
    </section>`;
  }

  const rows = selection.lines
    .map(
      (line) => `<tr>
        <td>${textOr(line.invoiceNumber, "<span class=\"empty\">Not numbered</span>")}</td>
        <td>${esc(statusLabel(line.status))}</td>
        <td>${textOr(line.invoiceDate, "<span class=\"empty\">Not recorded</span>")}</td>
        <td>${textOr(line.dueDate, "<span class=\"empty\">Not recorded</span>")}</td>
        <td>${textOr(line.paidDate, "<span class=\"empty\">Not recorded</span>")}</td>
        <td class="num">${formatAmount(line.grossAmount, currency)}</td>
        <td class="num">${formatAmount(line.retentionWithheld, currency)}</td>
        <td class="num">${formatAmount(line.netAmount, currency)}</td>
      </tr>`
    )
    .join("\n");

  // No total row. The award position above is the one place these figures are
  // totalled, and it is totalled by the ledger — a total typeset here would be
  // this document doing its own arithmetic.
  return `<section class="invoices">
      <h2>${esc(heading)}</h2>
      <table class="lines">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Status</th>
            <th>Invoice date</th>
            <th>Due</th>
            <th>Paid</th>
            <th class="num">Gross</th>
            <th class="num">Retention</th>
            <th class="num">Net</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      <p class="note">Totals for this award appear once, under Award position. This table is the record behind them.</p>
      ${missingDateNotice(selection)}
    </section>`;
}

function missingDateNotice(selection: WorksheetInvoiceSelection): string {
  if (selection.excludedForMissingDate === 0) return "";
  const count = selection.excludedForMissingDate;
  return `<p class="note">${count} invoice record${
    count === 1 ? " carries" : "s carry"
  } no invoice date and ${count === 1 ? "is" : "are"} therefore not shown in this period table. ${
    count === 1 ? "It is" : "They are"
  } still counted in the award position above.</p>`;
}

function costSection(data: ReimbursementWorksheetData): string {
  const currency = resolveWorksheetCurrency(data).code;
  const { costs } = data;

  if (!costs.ok) {
    const reason = costs.pending
      ? "The project cost ledger is not available on this deployment yet, so no cost detail is shown. This is not a statement that no costs were recorded."
      : "The project cost ledger could not be read, so no cost detail is shown. This is not a statement that no costs were recorded.";
    return `<section class="costs">
      <h2>Recorded project costs in this period</h2>
      <p class="alert">${esc(reason)}</p>
    </section>`;
  }

  // Branch on the TOTAL rather than on the line count, so the "no total to
  // show" case and the "nothing to list" case are one branch and cannot drift
  // apart. It also leaves `recordedTotal` narrowed to a number below, which is
  // why nothing here needs a `?? 0` — an unreachable zero-coalesce is code no
  // test can ever prove right or wrong, and it is exactly how a zero gets into
  // a money document.
  if (costs.recordedTotal === null) {
    return `<section class="costs">
      <h2>Recorded project costs in this period</h2>
      <p class="empty">No cost entries recorded for this period.</p>
    </section>`;
  }

  const rows = costs.lines
    .map(
      (line) => `<tr>
        <td>${textOr(line.entryDate, "<span class=\"empty\">Not recorded</span>")}</td>
        <td>${textOr(line.description, "<span class=\"empty\">No description</span>")}</td>
        <td>${textOr(line.vendorLabel, "<span class=\"empty\">Not recorded</span>")}</td>
        <td class="num">${formatAmount(line.amount, currency)}</td>
      </tr>`
    )
    .join("\n");

  return `<section class="costs">
      <h2>Recorded project costs in this period</h2>
      <table class="lines">
        <thead>
          <tr><th>Date</th><th>Description</th><th>Vendor</th><th class="num">Amount</th></tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
        <tfoot>
          <tr><th colspan="3">Cost entries recorded in this period</th><td class="num">${formatAmount(
            costs.recordedTotal,
            currency
          )}</td></tr>
        </tfoot>
      </table>
      <p class="note">These are the cost rows this workspace entered against the award's project. They are the project's own ledger, not a reconciliation of it against the invoice records above.</p>
    </section>`;
}

function profileSection(data: ReimbursementWorksheetData): string {
  const { profile } = data;

  const parts: string[] = [
    `<p><strong>Process:</strong> ${esc(profile.profileName)}</p>`,
  ];

  if (profile.framingNote) {
    parts.push(`<p class="framing">${esc(profile.framingNote)}</p>`);
  }

  if (profile.selection === "interim_unconfigured_default") {
    const rationale = data.interimDefaultRationale?.trim();
    parts.push(
      `<p class="alert">This process was not chosen for this workspace.${
        rationale ? ` ${esc(rationale)}` : ""
      }</p>`
    );
  }

  if (profile.formPackStatus) {
    // Our own sentence, not user text — inserted raw so the string on the page
    // is byte-identical to the exported constant a guard asserts.
    parts.push(`<p>${WORKSHEET_NO_FORM_PACK_NOTE}</p>`);
  }

  if (profile.submittedToHint) {
    parts.push(
      `<p><strong>Typically submitted to:</strong> ${esc(profile.submittedToHint)} — a hint from the process profile, not an address recorded for this award.</p>`
    );
  }

  return `<section class="profile">
      <h2>Reimbursement process</h2>
      ${parts.join("\n      ")}
    </section>`;
}

function checklistSection(data: ReimbursementWorksheetData): string {
  const checklist = data.profile.documentationChecklist;
  if (!checklist || checklist.length === 0) return "";

  const items = checklist
    .map(
      (item) => `<li>
        <span class="box" aria-hidden="true">&#9744;</span>
        <span class="item-label">${esc(item.label)}</span>
        <span class="item-guidance">${esc(item.guidance)}</span>
      </li>`
    )
    .join("\n");

  return `<section class="checklist">
      <h2>What your funder likely expects you to have in hand</h2>
      <p class="note">Unchecked on purpose. OpenPlan does not verify any of these and does not know whether you hold them.</p>
      <ul>
        ${items}
      </ul>
    </section>`;
}

function disclosureSection(data: ReimbursementWorksheetData): string {
  const disclosures: string[] = [
    "Claimed figures cover invoice records at internal review, submitted, approved for payment, and paid. Drafts and rejected records are reported above and are in no total.",
    "Approved for payment is a funder's promise, not a deposit. Only records marked paid are counted as paid.",
    "Retention is treated as withheld per invoice: it counts as held only on invoices marked paid, and is reported as proposed on claims not yet paid.",
    "Retention released at closeout is not tracked here. OpenPlan records no retention release date, and inventing one would be a figure nobody entered.",
  ];

  if (data.ledger.paidWithNoDateCount > 0) {
    const count = data.ledger.paidWithNoDateCount;
    disclosures.push(
      `${count} invoice record${count === 1 ? " is" : "s are"} marked paid with no payment date recorded. ${
        count === 1 ? "It is" : "They are"
      } counted as paid; the date is simply unknown and has not been substituted.`
    );
  }

  if (data.ledger.authorizedAmount === null) {
    disclosures.push(
      "No authorized amount is recorded on this award, so no remaining balance and no percentage of the award is shown."
    );
  }

  for (const notice of data.assemblyNotices ?? []) {
    if (notice.trim()) disclosures.push(notice.trim());
  }

  return `<section class="disclosures">
      <h2>How to read these figures</h2>
      <ul>
        ${disclosures.map((line) => `<li>${esc(line)}</li>`).join("\n        ")}
      </ul>
    </section>`;
}

const DOCUMENT_STYLES = `
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a2330; margin: 0; padding: 40px 48px 96px; font-size: 12px; line-height: 1.5; }
  header { border-bottom: 2px solid #1a2330; padding-bottom: 14px; margin-bottom: 18px; }
  .doc-title { font-size: 24px; font-weight: 700; margin: 0; letter-spacing: 0.03em; }
  .issuer-name { font-size: 15px; margin: 4px 0 0; }
  .header-meta { margin: 8px 0 0; color: #44506a; }
  .header-meta span { display: inline-block; margin-right: 18px; }
  .prepared-note { border: 1px solid #1a2330; background: #f2f4f8; padding: 10px 14px; margin: 0 0 20px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #6a7690; margin: 0 0 8px; }
  section { margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; }
  table.figures th { text-align: left; font-weight: 400; padding: 5px 8px; border-bottom: 1px solid #e4e8ef; }
  table.figures td { padding: 5px 8px; border-bottom: 1px solid #e4e8ef; }
  .row-note { display: block; color: #6a7690; font-size: 10px; }
  table.lines th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #6a7690; border-bottom: 1px solid #c6cdda; padding: 5px 8px; }
  table.lines td { border-bottom: 1px solid #e4e8ef; padding: 6px 8px; vertical-align: top; }
  table.lines tfoot th { border-top: 2px solid #1a2330; border-bottom: none; text-align: right; }
  table.lines tfoot td { border-top: 2px solid #1a2330; border-bottom: none; font-weight: 700; }
  th.num, td.num { text-align: right; white-space: nowrap; }
  .note { color: #6a7690; margin: 6px 0 0; }
  .empty { color: #6a7690; font-style: italic; }
  .alert { border-left: 3px solid #8a3324; background: #f8f2f1; padding: 8px 12px; margin: 8px 0 0; }
  .framing { border-left: 3px solid #44506a; background: #f2f4f8; padding: 8px 12px; margin: 8px 0; }
  .checklist ul { list-style: none; margin: 0; padding: 0; }
  .checklist li { border-bottom: 1px solid #e4e8ef; padding: 7px 0 7px 22px; position: relative; }
  .checklist .box { position: absolute; left: 0; top: 5px; font-size: 14px; }
  .checklist .item-label { font-weight: 700; display: block; }
  .checklist .item-guidance { color: #44506a; display: block; }
  .disclosures ul { margin: 0; padding-left: 18px; }
  .disclosures li { margin-bottom: 4px; }
  .page-footer { position: fixed; bottom: 0; left: 0; right: 0; padding: 8px 48px; border-top: 1px solid #c6cdda; background: #ffffff; color: #44506a; font-size: 9px; }
`;

/**
 * Build the complete reimbursement worksheet as one self-contained HTML string.
 *
 * Pure: data in, markup out, no I/O and no clock. The route renders it through
 * `renderReportPdf` — THE one PDF pipeline in this codebase — exactly as the
 * client-invoice document does. This module deliberately owns no rendering.
 */
export function buildReimbursementWorksheetHtml(data: ReimbursementWorksheetData): string {
  const selection = selectWorksheetInvoiceLines(data.ledger.lines, data.period);
  const workspaceName = data.workspace?.name?.trim() || "This workspace";
  const awardTitle = data.award.title?.trim() || "Untitled award";
  const projectName = data.award.projectName?.trim();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${esc(WORKSHEET_DOCUMENT_TITLE)} — ${esc(awardTitle)}</title>
    <style>${DOCUMENT_STYLES}</style>
  </head>
  <body>
    <header>
      <p class="doc-title">${esc(WORKSHEET_DOCUMENT_TITLE)}</p>
      <p class="issuer-name">${esc(workspaceName)}</p>
      <p class="header-meta">
        <span><strong>Award:</strong> ${esc(awardTitle)}</span>
        ${projectName ? `<span><strong>Project:</strong> ${esc(projectName)}</span>` : ""}
        <span><strong>Period:</strong> ${periodLabel(data.period)}</span>
        ${data.generatedAt ? `<span><strong>Prepared:</strong> ${esc(data.generatedAt)}</span>` : ""}
      </p>
    </header>
    <p class="prepared-note">${WORKSHEET_PREPARED_NOTE}</p>
    ${ledgerSection(data)}
    ${invoiceSection(data, selection)}
    ${costSection(data)}
    ${profileSection(data)}
    ${checklistSection(data)}
    ${disclosureSection(data)}
    <div class="page-footer">${WORKSHEET_PREPARED_NOTE}</div>
  </body>
</html>`;
}

/**
 * Synthetic worksheet files for the fourth proven job's example record
 * (schemas/examples/proven_job_record.v1.award.synthetic.json).
 *
 * Each worksheet is built by the product's own code: the drawdown ledger
 * (buildAwardDrawdownLedger) over the record's requests as they stood at the
 * download, the reimbursement profile the record's place resolves
 * (resolveReimbursementProfile), and the worksheet document
 * (buildReimbursementWorksheetHtml). Only the last step is this file's: the
 * document's HTML is laid out as text the way Poppler's `pdftotext -layout`
 * prints a Chrome worksheet (a figure row's label, then its amount, then its
 * note; a request row's cells on one line and its notes below; every page
 * ending with the fixed note and the browser's footer line). It is the
 * smallest text that carries what the checker reads, written as a "PDF" the
 * stand-in reader splits into pages, as the other jobs' synthetic files are.
 * A real PDF printed by Chrome is read in proven-job-award-real-pdf.test.ts.
 *
 * Nothing here is evidence, and no place, run or file is real.
 */
import { buildAwardDrawdownLedger, type DrawdownInvoiceLike } from "@/lib/invoicing/drawdown-ledger";
import {
  INTERIM_DEFAULT_RATIONALE,
  resolveReimbursementProfile,
  type ReimbursementProfileBinding,
} from "@/lib/invoicing/reimbursement-profile-binding";
import {
  buildReimbursementWorksheetHtml,
  summarizeWorksheetCostEntries,
  WORKSHEET_FOOTER_NOTE,
  WORKSHEET_PREPARED_NOTE,
} from "@/lib/invoicing/reimbursement-worksheet";
import { awardDrawdownTotals } from "@/lib/dashboard/chart-series";
import { formatMoney } from "@/lib/money/format";
import { subdivisionCodeFromTigerwebGeoid } from "@/lib/workspaces/home-geography";
import type { PlaceKind } from "@/lib/api/place-geographies";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a record under test is deliberately untyped JSON
type Json = any;

export const SYNTHETIC_PDF_HEADER = "%PDF-1.4 synthetic test file for the proven job checker, not a real PDF";

/** The profile the product binds for a journey's place, as a workspace whose "where you work" is that place. */
export function profileForPlace(place: { kind: string; geoid: string }): ReimbursementProfileBinding {
  const resolution = resolveReimbursementProfile({
    workspaceJurisdiction: { country: "US", subdivision: subdivisionCodeFromTigerwebGeoid(place.kind as PlaceKind, place.geoid) },
  });
  if (resolution.kind !== "resolved") throw new Error("the product resolved no reimbursement profile");
  return resolution.binding;
}

/** Each request as an invoice row in the status its history holds at `time`; requests created later are left out. */
function invoiceRowsAt(journey: Json, time: number): DrawdownInvoiceLike[] {
  const rows: DrawdownInvoiceLike[] = [];
  for (const request of journey.requests) {
    const state = request.history.filter((entry: Json) => Date.parse(entry.at) <= time).at(-1);
    if (!state) continue;
    rows.push({
      id: request.invoiceId,
      invoice_number: request.number,
      status: state.status,
      amount: request.gross,
      retention_amount: request.retention,
      retention_percent: 0,
      invoice_date: request.invoiceDate,
      due_date: request.dueDate,
      paid_date: state.status === "paid" ? request.paidDate : null,
      rejection_reason: state.status === "rejected" ? request.rejectionReason : null,
      resubmits_invoice_id: request.resubmitsInvoiceId,
    });
  }
  return rows;
}

/** The worksheet the product builds for a journey's award as it stood at `at` (an ISO time). */
export function worksheetHtmlAt(journey: Json, at: string): string {
  const time = Date.parse(at);
  const ledger = buildAwardDrawdownLedger({
    award: {
      awarded_amount: journey.award.ceiling,
      match_amount: journey.award.match,
      match_posture: journey.award.matchPosture,
    },
    invoiceRead: { ok: true, invoices: invoiceRowsAt(journey, time) },
  });
  if (!ledger.ok) throw new Error(ledger.message);
  const closed = Date.parse(journey.closeOut.closedAt) <= time;
  return buildReimbursementWorksheetHtml({
    workspace: { name: journey.workspaceName },
    award: {
      title: journey.award.title,
      projectName: journey.projectName,
      obligatedOn: journey.award.obligatedOn,
      closure: closed
        ? {
            basis: journey.closeOut.basis,
            closedOn: journey.closeOut.closedOn,
            note: journey.closeOut.note,
            releasedAmount: journey.closeOut.releasedAmount === null ? null : Number(journey.closeOut.releasedAmount),
          }
        : null,
    },
    period: null,
    ledger: ledger.ledger,
    profile: profileForPlace(journey.place),
    currencyCode: null,
    interimDefaultRationale: INTERIM_DEFAULT_RATIONALE,
    costs: summarizeWorksheetCostEntries({ ok: true, entries: [] }),
  });
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#9744;": "☐" };
const decode = (html: string) => html.replace(/&(?:amp|lt|gt|quot|#39|#9744);/g, (entity) => ENTITIES[entity]);
/** A cell's text: its tags gone, its row notes on lines of their own. */
function cellLines(html: string): string[] {
  return decode(html.replace(/<span class="row-note">/g, "\n").replace(/<[^>]+>/g, ""))
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const RIGHT = 120;
const FOOTER_INDENT = " ".repeat(90);
/** Marks a line this file laid out itself, whose spacing is kept; every other line is trimmed. */
const KEEP = "\u0001";

/**
 * The worksheet HTML laid out as `pdftotext -layout` text, one string per page.
 * Page 1 ends after the award position; the rest is page 2.
 */
export function worksheetPagesFromHtml(html: string): string[] {
  let body = html.slice(html.indexOf("<body>") + "<body>".length, html.indexOf("</body>"));
  body = body.replace(/<div class="page-footer">[\s\S]*?<\/div>/, "");
  // Figure rows: the label, the amount on its own line at the right, then the note.
  body = body.replace(/<tr>\s*<th scope="row">([\s\S]*?)<\/th>\s*<td class="num">([\s\S]*?)<\/td>\s*<\/tr>/g, (_whole, head: string, value: string) => {
    const [label, ...notes] = cellLines(head);
    const amount = cellLines(value).join(" ");
    const lines = notes.length === 0 ? [`  ${label.padEnd(RIGHT - amount.length - 2)}${amount}`] : [`  ${label}`, `${" ".repeat(RIGHT - amount.length)}${amount}`, ...notes.map((note) => `  ${note}`)];
    return `\n${lines.map((line) => KEEP + line).join("\n")}\n\n`;
  });
  // Request rows: each cell's first line on the row's first line, the cells' notes below.
  body = body.replace(/<tr>\s*((?:<td[\s\S]*?<\/td>\s*){8})<\/tr>/g, (_whole, cells: string) => {
    const widths = [17, 24, 14, 16, 16, 18, 14, 14];
    // Each cell wraps inside its own column, as the browser sets it.
    const wrap = (text: string, width: number) => {
      const wrapped: string[] = [];
      let line = "";
      for (const word of text.split(" ")) {
        if (line && `${line} ${word}`.length > width) {
          wrapped.push(line);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      if (line) wrapped.push(line);
      return wrapped;
    };
    // The status cell wraps well short of the next column, as the browser's cell padding keeps
    // a reason's last word clear of the invoice date (review 100: the fixture had sat at the edge).
    const wrapWidths = widths.map((width, index) => (index === 1 ? width - 6 : width - 1));
    const columns = [...cells.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match, index) => cellLines(match[1]).flatMap((line) => wrap(line, wrapWidths[index])));
    const height = Math.max(...columns.map((column) => column.length));
    const lines = Array.from({ length: height }, (_, row) => `  ${columns.map((column, index) => (column[row] ?? "").padEnd(widths[index])).join(" ")}`.trimEnd());
    return `\n${lines.map((line) => KEEP + line).join("\n")}\n`;
  });
  // The prepared note wraps where the box is narrower than the sentence.
  const wrapAt = WORKSHEET_PREPARED_NOTE.lastIndexOf(" ", 104);
  body = body
    .replace(/<thead>[\s\S]*?<\/thead>/g, `\n${KEEP}  INVOICE          STATUS                   INVOICE DATE   DUE              PAID             GROSS              RETENTION      NET\n`)
    .replace(/<h2>([\s\S]*?)<\/h2>/g, (_whole, heading: string) => `\n\n${heading.toUpperCase()}\n\n`)
    .replace(/<p class="prepared-note">[\s\S]*?<\/p>/, `\n${KEEP}   ${WORKSHEET_PREPARED_NOTE.slice(0, wrapAt)}\n${KEEP}   ${WORKSHEET_PREPARED_NOTE.slice(wrapAt + 1)}\n`)
    .replace(/<\/(?:p|li|span|header|section)>/g, "\n")
    .replace(/<[^>]+>/g, "");
  const text = decode(body)
    .split("\n")
    .map((line) => (line.startsWith(KEEP) ? line.slice(1).trimEnd() : line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const split = text.indexOf("\n\nINVOICE RECORDS ON THIS AWARD");
  const parts = [text.slice(0, split), text.slice(split + 2)];
  return parts.map(
    (part, index) =>
      `${part}\n\n\n${WORKSHEET_PREPARED_NOTE}\n\n${FOOTER_INDENT}${WORKSHEET_FOOTER_NOTE} · Page ${index + 1} of ${parts.length}\n`,
  );
}

/**
 * What each screen figure reads at `at`, printed by the product's own code:
 * the drawdown ledger's figures with the money formatter to the cent, and the
 * dashboard's award figure and share drawn from awardDrawdownTotals. A figure
 * the ledger holds as null reads "Not recorded".
 */
export function screenFiguresAt(journey: Json, at: string, names: readonly string[]): Record<string, string> {
  const time = Date.parse(at);
  const invoices = invoiceRowsAt(journey, time);
  const result = buildAwardDrawdownLedger({
    award: { awarded_amount: journey.award.ceiling, match_amount: journey.award.match, match_posture: journey.award.matchPosture },
    invoiceRead: { ok: true, invoices },
  });
  if (!result.ok) throw new Error(result.message);
  const { ledger } = result;
  const cents = (value: number | null) => (value === null ? "Not recorded" : formatMoney(value, { precision: "cents" }));
  const read = (outcome: { rows: readonly object[] }) => ({ ...outcome, failed: false, pending: false, truncated: false });
  const drawdown = awardDrawdownTotals(
    read({ rows: [{ id: journey.award.awardId, title: journey.award.title, awarded_amount: journey.award.ceiling }] }) as never,
    read({ rows: invoices.map((invoice) => ({ funding_award_id: journey.award.awardId, amount: invoice.amount, status: invoice.status })) }) as never,
  );
  const figures: Record<string, string> = {
    ceiling: cents(ledger.recordedAwardCeiling),
    match: cents(ledger.matchAmount),
    claimedGross: cents(ledger.claimedGrossToDate),
    paidNet: cents(ledger.paidToDate),
    outstandingNet: cents(ledger.outstandingClaimed),
    rejectedGross: cents(ledger.rejectedGross),
    remaining: cents(ledger.remainingAgainstCeiling),
    awardedWhole: drawdown ? formatMoney(drawdown.authorised, { precision: "whole" }) : "Not recorded",
    drawnPercent: drawdown ? `${drawdown.percent}%` : "Not recorded",
  };
  return Object.fromEntries(names.map((name) => [name, figures[name]]));
}

/** The synthetic "PDF" file for one of a journey's worksheet downloads. */
export function syntheticWorksheetPdfText(journey: Json, kind: string): string {
  const download = journey.downloads.find((entry: Json) => entry.pdf === kind);
  if (!download) throw new Error(`the journey has no ${kind} download`);
  return [SYNTHETIC_PDF_HEADER, worksheetPagesFromHtml(worksheetHtmlAt(journey, download.at)).join("\f")].join("\n");
}

/** The pages of a synthetic "PDF" file: everything after its first line, split at form feeds. */
export function syntheticPdfPages(text: string): string[] {
  return text.replace(/^[^\n]*\n/, "").split("\f");
}

/** The page each item's heading is on, as a record's PDF entry lists its items. */
export function syntheticWorksheetItems(text: string, job: Json, kind: string) {
  const pages = syntheticPdfPages(text);
  return Object.keys(job.items).map((item) => {
    const heading = job.itemHeadings[kind][item];
    const page = pages.findIndex((pageText) => pageText.split("\n").some((line) => line.trim().toLowerCase() === heading.toLowerCase())) + 1;
    return { item, page, method: "pdftotext", text: heading };
  });
}

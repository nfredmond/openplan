/**
 * Client-invoice PDF document builder — the printable form of one receivable
 * invoice (the workspace billing ITS OWN client; the mirror of the
 * reimbursement register's direction).
 *
 * Pure: data in, one self-contained HTML string out, no I/O. The route renders
 * the string through the reports stack's `renderReportPdf`, which is THE one
 * PDF pipeline — this module deliberately owns no rendering.
 *
 * Every user-entered string passes through `esc` (the same escaping pattern as
 * src/lib/reports/html.ts): an invoice description is client-facing paper, and
 * markup smuggled into it must arrive as text, not as markup.
 *
 * Conventions shared with receivables.ts: record-like tolerant types
 * (snake_case, number|string|null), no jurisdiction assumptions. Currency
 * formatting follows the row's own currency_code; absent one, it falls back to
 * the same USD presentation the rest of the invoicing surface uses.
 */

import { parseCurrencyAmount } from "./invoice-records";
import type { EngagementBilledSummary } from "./receivables";

export type ClientInvoicePdfWorkspace = {
  name?: string | null;
} | null;

export type ClientInvoicePdfClient = {
  name?: string | null;
  billing_address?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
} | null;

export type ClientInvoicePdfInvoice = {
  invoice_number: string;
  status?: string | null;
  invoice_date?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  due_date?: string | null;
  subtotal_amount?: number | string | null;
  retention_percent?: number | string | null;
  retention_amount?: number | string | null;
  total_amount?: number | string | null;
  payment_terms?: string | null;
  currency_code?: string | null;
  notes?: string | null;
};

export type ClientInvoicePdfLineItem = {
  description?: string | null;
  quantity?: number | string | null;
  unit_label?: string | null;
  unit_amount?: number | string | null;
  amount?: number | string | null;
};

export type ClientInvoicePdfEngagement = {
  title?: string | null;
  reference_code?: string | null;
  not_to_exceed_amount?: number | string | null;
} | null;

export type ClientInvoicePdfData = {
  workspace: ClientInvoicePdfWorkspace;
  client: ClientInvoicePdfClient;
  invoice: ClientInvoicePdfInvoice;
  lineItems: ClientInvoicePdfLineItem[];
  engagement: ClientInvoicePdfEngagement;
  /** Billed position of the engagement, for the not-to-exceed context line. */
  engagementBilled?: EngagementBilledSummary | null;
};

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatAmount(value: number | string | null | undefined, currencyCode: string | null | undefined): string {
  const numeric = parseCurrencyAmount(value);
  const code = currencyCode?.trim().toUpperCase() || "USD";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(numeric);
  } catch {
    // An unrecognized currency code must not sink the document: show the
    // number with the code the row actually carries.
    return `${numeric.toFixed(2)} ${code}`;
  }
}

function formatQuantity(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const numeric = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return "";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(numeric);
}

function statusLabel(status: string | null | undefined): string {
  const value = (status ?? "draft").trim().toLowerCase();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Draft";
}

function metaRow(label: string, value: string | null | undefined): string {
  if (!value) return "";
  return `<div class="meta-row"><span class="meta-label">${esc(label)}</span><span class="meta-value">${esc(value)}</span></div>`;
}

const DOCUMENT_STYLES = `
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a2330; margin: 0; padding: 40px 48px; font-size: 13px; line-height: 1.5; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a2330; padding-bottom: 16px; margin-bottom: 24px; }
  .issuer-name { font-size: 20px; font-weight: 700; margin: 0; }
  .doc-title { font-size: 26px; font-weight: 700; margin: 0; text-align: right; letter-spacing: 0.04em; }
  .doc-number { text-align: right; margin: 4px 0 0; color: #44506a; }
  .columns { display: flex; justify-content: space-between; gap: 32px; margin-bottom: 24px; }
  .bill-to h2, .invoice-meta h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #6a7690; margin: 0 0 6px; }
  .bill-to p { margin: 0 0 2px; white-space: pre-line; }
  .meta-row { display: flex; gap: 12px; margin-bottom: 2px; }
  .meta-label { min-width: 110px; color: #6a7690; }
  table.lines { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  table.lines th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #6a7690; border-bottom: 1px solid #c6cdda; padding: 6px 8px; }
  table.lines td { border-bottom: 1px solid #e4e8ef; padding: 8px; vertical-align: top; }
  table.lines th.num, table.lines td.num { text-align: right; white-space: nowrap; }
  table.totals { margin-left: auto; border-collapse: collapse; margin-bottom: 24px; }
  table.totals td { padding: 4px 8px; }
  table.totals td.num { text-align: right; min-width: 120px; }
  table.totals tr.grand td { border-top: 2px solid #1a2330; font-weight: 700; font-size: 15px; }
  .engagement-context { background: #f2f4f8; border-left: 3px solid #44506a; padding: 10px 14px; margin-bottom: 16px; }
  .engagement-context p { margin: 0; }
  section.terms h2, section.notes h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #6a7690; margin: 0 0 6px; }
  section.terms, section.notes { margin-bottom: 16px; }
  section.terms p, section.notes p { margin: 0; white-space: pre-line; }
`;

/**
 * Build the complete invoice document as one self-contained HTML string:
 * issuer (the workspace), bill-to (the client), invoice metadata, the line
 * table, subtotal → retention → total (the retention row appears only when a
 * retention percentage is actually withheld), payment terms, notes, and the
 * engagement reference with its not-to-exceed context when the invoice is
 * linked to an engagement.
 */
export function buildClientInvoiceHtml(data: ClientInvoicePdfData): string {
  const currency = data.invoice.currency_code ?? null;
  const issuerName = data.workspace?.name?.trim() || "OpenPlan workspace";
  const clientName = data.client?.name?.trim() || "Client";

  const retentionPercent = parseCurrencyAmount(data.invoice.retention_percent);

  const periodLine =
    data.invoice.period_start || data.invoice.period_end
      ? `${data.invoice.period_start ?? "…"} – ${data.invoice.period_end ?? "…"}`
      : null;

  const lineRowsMarkup = data.lineItems
    .map((line) => {
      const quantity = formatQuantity(line.quantity);
      const unitAmount =
        line.unit_amount === null || line.unit_amount === undefined || line.unit_amount === ""
          ? ""
          : formatAmount(line.unit_amount, currency);
      const unitLabel = line.unit_label?.trim() ? ` / ${esc(line.unit_label.trim())}` : "";
      return `<tr>
        <td>${esc(line.description ?? "")}</td>
        <td class="num">${quantity}</td>
        <td class="num">${unitAmount}${unitAmount ? unitLabel : ""}</td>
        <td class="num">${formatAmount(line.amount, currency)}</td>
      </tr>`;
    })
    .join("\n");

  const retentionRow =
    retentionPercent > 0
      ? `<tr><td>Retention withheld (${esc(String(retentionPercent))}%)</td><td class="num">−${formatAmount(
          data.invoice.retention_amount,
          currency
        )}</td></tr>`
      : "";

  let engagementContext = "";
  if (data.engagement) {
    const title = data.engagement.title?.trim() || "Engagement";
    const reference = data.engagement.reference_code?.trim();
    const referencePart = reference ? ` (Ref ${esc(reference)})` : "";

    const nte = data.engagement.not_to_exceed_amount;
    const nteParsed = nte === null || nte === undefined ? null : parseCurrencyAmount(nte);
    let ntePart = "";
    if (nteParsed !== null) {
      const billed = data.engagementBilled;
      const billedPart = billed
        ? `; billed to date ${formatAmount(billed.billedToDate, currency)}${
            billed.remaining !== null ? `, remaining ${formatAmount(billed.remaining, currency)}` : ""
          }`
        : "";
      ntePart = `<p>Not-to-exceed ${formatAmount(nteParsed, currency)}${billedPart}.</p>`;
    }

    engagementContext = `<div class="engagement-context">
      <p>Engagement: ${esc(title)}${referencePart}</p>
      ${ntePart}
    </div>`;
  }

  const billToLines = [
    `<p><strong>${esc(clientName)}</strong></p>`,
    data.client?.contact_name?.trim() ? `<p>${esc(data.client.contact_name.trim())}</p>` : "",
    data.client?.billing_address?.trim() ? `<p>${esc(data.client.billing_address.trim())}</p>` : "",
    data.client?.contact_email?.trim() ? `<p>${esc(data.client.contact_email.trim())}</p>` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Invoice ${esc(data.invoice.invoice_number)}</title>
    <style>${DOCUMENT_STYLES}</style>
  </head>
  <body>
    <header>
      <div>
        <p class="issuer-name">${esc(issuerName)}</p>
      </div>
      <div>
        <p class="doc-title">INVOICE</p>
        <p class="doc-number">${esc(data.invoice.invoice_number)}</p>
      </div>
    </header>
    <div class="columns">
      <div class="bill-to">
        <h2>Bill to</h2>
        ${billToLines}
      </div>
      <div class="invoice-meta">
        <h2>Invoice details</h2>
        ${metaRow("Status", statusLabel(data.invoice.status))}
        ${metaRow("Invoice date", data.invoice.invoice_date)}
        ${metaRow("Billing period", periodLine)}
        ${metaRow("Due date", data.invoice.due_date)}
      </div>
    </div>
    ${engagementContext}
    <table class="lines">
      <thead>
        <tr>
          <th>Description</th>
          <th class="num">Qty</th>
          <th class="num">Unit</th>
          <th class="num">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${lineRowsMarkup}
      </tbody>
    </table>
    <table class="totals">
      <tbody>
        <tr><td>Subtotal</td><td class="num">${formatAmount(data.invoice.subtotal_amount, currency)}</td></tr>
        ${retentionRow}
        <tr class="grand"><td>Total due</td><td class="num">${formatAmount(data.invoice.total_amount, currency)}</td></tr>
      </tbody>
    </table>
    ${
      data.invoice.payment_terms?.trim()
        ? `<section class="terms"><h2>Payment terms</h2><p>${esc(data.invoice.payment_terms.trim())}</p></section>`
        : ""
    }
    ${
      data.invoice.notes?.trim()
        ? `<section class="notes"><h2>Notes</h2><p>${esc(data.invoice.notes.trim())}</p></section>`
        : ""
    }
  </body>
</html>`;
}

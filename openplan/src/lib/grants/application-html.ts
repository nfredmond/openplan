/**
 * The packaged grant-application document: one self-contained HTML string,
 * following the reports/html.ts conventions (all values escaped, inline
 * styles, no external assets), consumed by renderReportPdf so the PDF can
 * never diverge from the HTML.
 *
 * Honesty rules this module enforces structurally:
 *  - Only operator-FINAL text renders as application prose. A section that is
 *    not final renders a disclosed outstanding-item block, never silently
 *    disappears and never renders draft text as if approved.
 *  - Missing required attachments stamp the document DRAFT prominently; they
 *    do not block assembly, because an operator legitimately packages a work
 *    in progress — but the reader must never mistake it for submittable.
 *  - The standing evidence caveats travel on the cover verbatim, and every
 *    section's provenance (origin, model, grounding verdict, who finalized it
 *    and when) is disclosed in an appendix.
 */

import { BCA_NARRATIVE_CAVEAT } from "@/lib/bca/parameters";
import { ENGAGEMENT_NARRATIVE_CAVEAT } from "@/lib/grants/engagement-evidence";
import { KB_NARRATIVE_CAVEAT } from "@/lib/grants/kb-evidence";
import { GRANT_MODELING_PLANNING_CAVEAT } from "@/lib/grants/modeling-evidence";
import { stripFactCitationTokens } from "@/lib/grants/narrative-grounding";
import { renderChapterMarkdownToHtml } from "@/lib/markdown/render";
import type { ApplicationAttachmentRow, ApplicationSectionRow } from "@/lib/grants/application";

/** The standing caveat lines every packaged application carries on its cover. */
export const APPLICATION_EXPORT_STANDING_CAVEATS: readonly string[] = [
  GRANT_MODELING_PLANNING_CAVEAT,
  BCA_NARRATIVE_CAVEAT,
  ENGAGEMENT_NARRATIVE_CAVEAT,
  KB_NARRATIVE_CAVEAT,
];

export type GrantApplicationSectionOrigin =
  | "operator_authored"
  | "ai_draft_unedited"
  | "ai_draft_edited"
  | "none";

export type GrantApplicationSectionProvenance = {
  origin: GrantApplicationSectionOrigin;
  model: string | null;
  groundedSentenceCount: number | null;
  totalSentenceCount: number | null;
  /** The finalizing workspace member's id — an honest identifier, not a name lookup. */
  finalizedBy: string | null;
  finalizedAt: string | null;
};

export type GrantApplicationExportSection = {
  section: ApplicationSectionRow;
  provenance: GrantApplicationSectionProvenance;
};

export type GrantApplicationExportData = {
  opportunity: {
    id: string;
    title: string;
    agency_name: string | null;
    summary: string | null;
    expected_award_amount: number | string | null;
    closes_at: string | null;
    opportunity_status: string | null;
    decision_state: string | null;
  };
  programTitle: string | null;
  sections: GrantApplicationExportSection[];
  attachments: ApplicationAttachmentRow[];
  generatedAt: string;
};

const SECTION_STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  drafting: "Drafting",
  operator_review: "Operator review",
  final: "Final",
};

const ATTACHMENT_STATUS_LABELS: Record<string, string> = {
  missing: "Missing",
  in_progress: "In progress",
  attached: "Attached",
  not_applicable: "Not applicable",
};

const ORIGIN_LABELS: Record<GrantApplicationSectionOrigin, string> = {
  operator_authored: "Operator-authored",
  ai_draft_unedited: "AI draft finalized unedited (passed the grounding gate)",
  ai_draft_edited: "AI draft, operator-edited",
  none: "No final text",
};

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Not set";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatAmount(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "Not set";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "Not set";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(numeric);
}

/** Required checklist items with nothing behind them: neither attached nor N/A. */
export function countOutstandingRequiredAttachments(
  attachments: readonly ApplicationAttachmentRow[]
): number {
  return attachments.filter(
    (attachment) =>
      attachment.required &&
      attachment.status !== "attached" &&
      attachment.status !== "not_applicable"
  ).length;
}

const DOCUMENT_STYLES = `
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #f3f0e8; color: #13222b; font-family: Georgia, "Times New Roman", serif; }
      main { max-width: 1040px; margin: 0 auto; padding: 40px 24px 80px; }
      .hero { border: 1px solid rgba(19, 34, 43, 0.12); border-radius: 28px; padding: 32px; background: linear-gradient(180deg, #fefcf7, #f5efe3); }
      .eyebrow { font: 600 11px/1.2 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.22em; text-transform: uppercase; color: #965c2a; }
      h1, h2, h3 { margin: 0; }
      h1 { margin-top: 12px; font-size: 38px; line-height: 1.08; }
      .hero p { max-width: 760px; font-size: 16px; line-height: 1.6; }
      section { margin-top: 24px; border: 1px solid rgba(19, 34, 43, 0.12); border-radius: 24px; padding: 24px; background: rgba(255, 255, 255, 0.8); }
      .section-title { margin-bottom: 14px; font-size: 22px; }
      .facts { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
      .facts div { border: 1px solid rgba(19, 34, 43, 0.1); border-radius: 18px; padding: 14px; background: #fffdf8; }
      dt { display: block; font: 600 11px/1.4 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: #6d7479; }
      dd { margin: 6px 0 0; font-size: 17px; }
      .draft-stamp { margin-top: 20px; border: 2px solid #9a3412; border-radius: 18px; padding: 16px 18px; background: #fde2d2; color: #9a3412; font: 700 18px/1.4 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.06em; }
      .warning-box { margin-top: 18px; border-radius: 18px; padding: 14px 16px; background: #fff3df; border: 1px solid rgba(150, 92, 42, 0.2); }
      .warning-box ul { margin: 8px 0 0; padding-left: 20px; }
      .outstanding { border: 1px dashed rgba(150, 92, 42, 0.5); border-radius: 18px; padding: 14px 16px; background: #fff8ec; color: #6d7479; font-style: italic; }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid rgba(19, 34, 43, 0.12); vertical-align: top; }
      th { font: 600 11px/1.4 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.1em; text-transform: uppercase; color: #6d7479; }
      .empty { color: #6d7479; font-style: italic; }
      .section-body p { line-height: 1.65; }
      @media (max-width: 700px) { main { padding: 20px 14px 56px; } h1 { font-size: 30px; } }`;

function coverMarkup(data: GrantApplicationExportData, outstandingRequiredCount: number): string {
  const { opportunity } = data;
  const finalCount = data.sections.filter((entry) => entry.section.status === "final").length;

  return `<header class="hero">
    <span class="eyebrow">OpenPlan Grants — Application packet</span>
    <h1>${esc(opportunity.title)}</h1>
    <p>${esc(
      opportunity.summary ||
        "Assembled from operator-approved section texts and the application attachment checklist."
    )}</p>
    <div class="facts" style="margin-top: 18px;">
      <div><dt>Funder / agency</dt><dd>${esc(opportunity.agency_name ?? "Not set")}</dd></div>
      <div><dt>Program</dt><dd>${esc(data.programTitle ?? "Not linked")}</dd></div>
      <div><dt>Expected award</dt><dd>${esc(formatAmount(opportunity.expected_award_amount))}</dd></div>
      <div><dt>Closes</dt><dd>${esc(formatDateTime(opportunity.closes_at))}</dd></div>
      <div><dt>Sections final</dt><dd>${finalCount} of ${data.sections.length}</dd></div>
      <div><dt>Assembled</dt><dd>${esc(formatDateTime(data.generatedAt))}</dd></div>
    </div>
    ${
      outstandingRequiredCount > 0
        ? `<div class="draft-stamp">DRAFT — ${outstandingRequiredCount} required attachment(s) outstanding</div>`
        : ""
    }
    <div class="warning-box">
      <strong>Standing caveats.</strong> Where this application cites OpenPlan-assembled evidence,
      the following boundaries apply verbatim:
      <ul>
        ${APPLICATION_EXPORT_STANDING_CAVEATS.map((caveat) => `<li>${esc(caveat)}</li>`).join("\n        ")}
      </ul>
    </div>
  </header>`;
}

function sectionMarkup(entry: GrantApplicationExportSection): string {
  const { section } = entry;
  const statusLabel = SECTION_STATUS_LABELS[section.status] ?? section.status;

  if (section.status === "final" && section.final_markdown) {
    return `<section id="${esc(section.section_key)}">
      <h2 class="section-title">${esc(section.title)}</h2>
      <div class="section-body">${renderChapterMarkdownToHtml(
        stripFactCitationTokens(section.final_markdown)
      )}</div>
    </section>`;
  }

  // Not finalized: an outstanding item, disclosed as such — never draft text
  // presented as approved application prose, and never a silent omission.
  return `<section id="${esc(section.section_key)}">
    <h2 class="section-title">${esc(section.title)}</h2>
    <div class="outstanding">Not finalized — this section is still in &ldquo;${esc(
      statusLabel
    )}&rdquo;. It is listed here as an outstanding item; no approved text exists for it yet.</div>
  </section>`;
}

function attachmentsMarkup(attachments: readonly ApplicationAttachmentRow[]): string {
  if (attachments.length === 0) {
    return `<section>
      <h2 class="section-title">Attachment checklist</h2>
      <p class="empty">No checklist items are recorded for this application.</p>
    </section>`;
  }

  return `<section>
    <h2 class="section-title">Attachment checklist</h2>
    <table>
      <thead>
        <tr><th>Attachment</th><th>Required</th><th>Status</th><th>Fulfillment</th><th>Note</th></tr>
      </thead>
      <tbody>
        ${attachments
          .map((attachment) => {
            const fulfillment = attachment.kb_document_id
              ? "Knowledge Base document"
              : attachment.report_artifact_id
                ? "Generated report artifact"
                : "—";
            return `<tr>
          <td>${esc(attachment.title)}</td>
          <td>${attachment.required ? "Required" : "Optional"}</td>
          <td>${esc(ATTACHMENT_STATUS_LABELS[attachment.status] ?? attachment.status)}</td>
          <td>${esc(fulfillment)}</td>
          <td>${esc(attachment.note ?? "—")}</td>
        </tr>`;
          })
          .join("\n        ")}
      </tbody>
    </table>
  </section>`;
}

function provenanceMarkup(sections: readonly GrantApplicationExportSection[]): string {
  return `<section id="provenance-appendix">
    <h2 class="section-title">Provenance appendix</h2>
    <p>How each section's text came to be, disclosed per section. AI drafts are writing support
    grounded in workspace evidence; the operator who finalized a section is the authority for it.</p>
    <table>
      <thead>
        <tr><th>Section</th><th>Status</th><th>Origin</th><th>Model</th><th>Grounding</th><th>Finalized by</th><th>Finalized</th></tr>
      </thead>
      <tbody>
        ${sections
          .map((entry) => {
            const { section, provenance } = entry;
            const grounding =
              provenance.groundedSentenceCount !== null && provenance.totalSentenceCount !== null
                ? `${provenance.groundedSentenceCount} of ${provenance.totalSentenceCount} sentences grounded`
                : "—";
            return `<tr>
          <td>${esc(section.title)}</td>
          <td>${esc(SECTION_STATUS_LABELS[section.status] ?? section.status)}</td>
          <td>${esc(ORIGIN_LABELS[provenance.origin])}</td>
          <td>${esc(provenance.model ?? "—")}</td>
          <td>${esc(grounding)}</td>
          <td>${esc(provenance.finalizedBy ?? "—")}</td>
          <td>${esc(provenance.finalizedAt ? formatDateTime(provenance.finalizedAt) : "—")}</td>
        </tr>`;
          })
          .join("\n        ")}
      </tbody>
    </table>
  </section>`;
}

export function buildGrantApplicationHtml(data: GrantApplicationExportData): string {
  const orderedSections = [...data.sections].sort(
    (left, right) => left.section.sort_order - right.section.sort_order
  );
  const outstandingRequiredCount = countOutstandingRequiredAttachments(data.attachments);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(data.opportunity.title)} — Application packet</title>
    <style>${DOCUMENT_STYLES}
    </style>
  </head>
  <body>
    <main>
      ${coverMarkup({ ...data, sections: orderedSections }, outstandingRequiredCount)}
      ${orderedSections.map((entry) => sectionMarkup(entry)).join("\n      ")}
      ${attachmentsMarkup(data.attachments)}
      ${provenanceMarkup(orderedSections)}
    </main>
  </body>
</html>`;
}

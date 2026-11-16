import { SAFETY_SEED_CAVEAT, type SafetySeedProvenance } from "./safety-seed-origin";
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
 *    Final section text that still holds `[VERIFY]` markers or the Safety
 *    seed's unfilled placeholders stamps it DRAFT too, with the count
 *    (`application-draft-stamps.ts`). Both reasons print when both apply.
 *  - No email address prints: finalizers are named by workspace role.
 *  - The standing evidence caveats travel on the cover verbatim, for the
 *    evidence the document actually carries (`applicableStandingCaveats`), and
 *    every section's provenance (origin, model, grounding verdict, who
 *    finalized it and when) is disclosed in an appendix.
 *  - Every time prints on the workspace calendar with its zone named.
 */

import { applicantNameLabel, type ApplicationApplicant } from "@/lib/grants/application-applicant";
import { BCA_NARRATIVE_CAVEAT } from "@/lib/bca/parameters";
import { ENGAGEMENT_NARRATIVE_CAVEAT } from "@/lib/grants/engagement-evidence";
import { KB_NARRATIVE_CAVEAT } from "@/lib/grants/kb-evidence";
import { GRANT_MODELING_PLANNING_CAVEAT } from "@/lib/grants/modeling-evidence";
import { stripFactCitationTokens } from "@/lib/grants/narrative-grounding";
import { renderChapterMarkdownToHtml } from "@/lib/markdown/render";
import { attachmentRequirementLabel, type ApplicationAttachmentRow, type ApplicationSectionRow } from "@/lib/grants/application";
import { formatMoney } from "@/lib/money/format";
import {
  evidenceAppendicesMarkup,
  type EvidenceAppendix,
  type EvidenceAppendixFrame,
} from "@/lib/grants/evidence-appendices";
import { SS4A_APPENDIX_FRAME } from "@/lib/grants/ss4a-evidence-appendices";
import { applicationDraftStamps } from "@/lib/grants/application-draft-stamps";
import {
  formatRecordedMoment,
  timeZoneInputLabel,
  UTC_TIME_ZONE,
  type WorkspaceCalendar,
} from "@/lib/time/workspace-calendar";

/**
 * The standing caveat lines a packaged application can carry on its cover, in
 * cover order. `applicableStandingCaveats` picks the ones whose evidence the
 * document includes.
 */
export const APPLICATION_EXPORT_STANDING_CAVEATS: readonly string[] = [
  GRANT_MODELING_PLANNING_CAVEAT,
  BCA_NARRATIVE_CAVEAT,
  ENGAGEMENT_NARRATIVE_CAVEAT,
  KB_NARRATIVE_CAVEAT,
  SAFETY_SEED_CAVEAT,
];

export type GrantApplicationSectionOrigin =
  | "operator_authored"
  | "ai_draft_unedited"
  | "ai_draft_edited"
  | "safety_seed_unedited"
  | "safety_seed_operator_edited"
  | "none";

export type GrantApplicationSectionProvenance = {
  origin: GrantApplicationSectionOrigin;
  safetySeed?: SafetySeedProvenance;
  model: string | null;
  groundedSentenceCount: number | null;
  totalSentenceCount: number | null;
  /**
   * Who finalized the section, as the document prints it: the workspace
   * member's role from `loadFinalizerNames`, or that module's sentence when
   * the person is not on record. Never a user id or an email address.
   * Sourced from the section's
   * finalized_by EVENT column (never updated_by, which any later touch
   * overwrites). For sections finalized before finalizer tracking existed,
   * this carries the disclosure "finalized before finalizer tracking; not
   * recorded" instead of a guess.
   */
  finalizedBy: string | null;
  finalizedAt: string | null;
  /**
   * The draft text the section was finalized from, when it came from an AI
   * draft. Read only to find which evidence caveats the draft carried.
   */
  sourceDraftText?: string | null;
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
    /** 'proposal' switches the cover to solicitation framing; absent = grant. */
    pursuit_kind?: string | null;
    solicitation_number?: string | null;
  };
  programTitle: string | null;
  sections: GrantApplicationExportSection[];
  attachments: ApplicationAttachmentRow[];
  generatedAt: string;
  safetySeedHistory?: SafetySeedProvenance[];
  /** Programs that declare appendices only: every evidence appendix, including missing and omitted ones. */
  evidenceAppendices?: EvidenceAppendix[];
  /** How the program's appendices open. Defaults to the SS4A wording. */
  evidenceAppendixFrame?: EvidenceAppendixFrame;
  /** The workspace calendar every time prints on. Absent means UTC, said out loud. */
  calendar?: WorkspaceCalendar;
  /** The linked project and the workspace, printed on the cover. Absent prints neither. */
  applicant?: ApplicationApplicant;
  /** Checklist keys the seeded template asks for only in some cases; they print "Required if applicable". */
  ifApplicableAttachmentKeys?: ReadonlySet<string>;
  /**
   * Facts a program states on the cover, each a whole sentence or "Label:
   * value" on a line of its own under the cover's boxes, so a text search of
   * the PDF finds each as one string. The California ATP names the linked
   * project's study place and the applicant here.
   */
  coverLines?: readonly string[];
  /**
   * The title of each Knowledge Base document a checklist item is attached
   * to, by document id. A document whose title was not read is named as
   * that, never by a guessed title.
   */
  attachmentDocumentTitles?: ReadonlyMap<string, string>;
};

/** The document label per pursuit kind, used in the title and cover eyebrow. */
export function applicationExportPacketLabel(pursuitKind: string | null | undefined): string {
  return pursuitKind === "proposal" ? "Proposal packet" : "Application packet";
}

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
  safety_seed_unedited: "Code-built Safety seed, finalized unedited",
  safety_seed_operator_edited: "Code-built Safety seed, operator-edited",
};

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const UTC_CALENDAR: WorkspaceCalendar = { timeZone: UTC_TIME_ZONE, source: "utc_fallback" };

/**
 * A stored time on the workspace calendar, its zone named: "September 29,
 * 2026 at 17:00 (America/Los_Angeles)", or "(UTC, no workspace time zone set)"
 * when the workspace has none. A date-only value prints as the day. A value
 * that does not read as a time prints as stored.
 */
function formatDateTime(value: string | null | undefined, calendar: WorkspaceCalendar): string {
  if (!value) return "Not set";
  return formatRecordedMoment(value, calendar.timeZone, timeZoneInputLabel(calendar)) ?? value;
}

function formatAmount(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "Not set";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "Not set";
  return formatMoney(numeric, { precision: "whole" });
}

/**
 * The application stylesheet.
 *
 * Letter spacing stays under 0.1em: Poppler and most PDF readers start a new
 * word at a gap wider than a tenth of the font size, so wider tracking makes a
 * label read back as single letters and a search for it fails
 * (KI-2026-11-14-117). Table rows do not split across pages, so a long URL in
 * a cell prints, and copies, whole on one page.
 *
 * An appendix fact is one line of running text, "Label: value", in one
 * column. The facts were a two-column grid of boxes: extracted text read two
 * facts side by side, a label could end one page and its value start the
 * next, and a text search found neither as one string (KI-2026-11-16-040). A
 * fact, an appendix note and the appendices' opening paragraphs do not split
 * across pages, so a `[VERIFY]` marker inside one stays whole.
 *
 * The cover's Project and Workspace boxes take a full row each. In a narrow
 * box beside two others a long name wrapped, and extracted text read the
 * three boxes line by line across, so the name was not found whole.
 *
 * The cover title's line spacing is wider than its letters are tall. At 1.08 a
 * title that wrapped to two lines had word boxes that overlapped in the PDF's
 * text layer (KI-2026-11-16-074).
 *
 * Print drops the spacing under the last text. When the text ended near a
 * page end, that empty spacing spilled onto a blank last page
 * (KI-2026-11-14-116).
 */
const DOCUMENT_STYLES = `
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #f3f0e8; color: #13222b; font-family: Georgia, "Times New Roman", serif; }
      main { max-width: 1040px; margin: 0 auto; padding: 40px 24px 80px; }
      .hero { border: 1px solid rgba(19, 34, 43, 0.12); border-radius: 28px; padding: 32px; background: linear-gradient(180deg, #fefcf7, #f5efe3); }
      .eyebrow { font: 600 11px/1.2 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.06em; text-transform: uppercase; color: #965c2a; }
      h1, h2, h3 { margin: 0; }
      h1 { margin-top: 12px; font-size: 38px; line-height: 1.25; }
      .hero p { max-width: 760px; font-size: 16px; line-height: 1.6; }
      section { margin-top: 24px; border: 1px solid rgba(19, 34, 43, 0.12); border-radius: 24px; padding: 24px; background: rgba(255, 255, 255, 0.8); }
      .section-title { margin-bottom: 14px; font-size: 22px; break-after: avoid; }
      .facts { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
      .facts div { border: 1px solid rgba(19, 34, 43, 0.1); border-radius: 18px; padding: 14px; background: #fffdf8; }
      .facts div.wide { grid-column: 1 / -1; }
      dt { display: block; font: 600 11px/1.4 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.05em; text-transform: uppercase; color: #6d7479; }
      dd { margin: 6px 0 0; font-size: 17px; }
      .draft-stamp { margin-top: 20px; border: 2px solid #9a3412; border-radius: 18px; padding: 16px 18px; background: #fde2d2; color: #9a3412; font: 700 18px/1.4 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.06em; }
      .warning-box { margin-top: 18px; border-radius: 18px; padding: 14px 16px; background: #fff3df; border: 1px solid rgba(150, 92, 42, 0.2); }
      .warning-box ul { margin: 8px 0 0; padding-left: 20px; }
      .outstanding { border: 1px dashed rgba(150, 92, 42, 0.5); border-radius: 18px; padding: 14px 16px; background: #fff8ec; color: #6d7479; font-style: italic; }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      tr { break-inside: avoid; }
      th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid rgba(19, 34, 43, 0.12); vertical-align: top; }
      th { font: 600 11px/1.4 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.05em; text-transform: uppercase; color: #6d7479; }
      .empty { color: #6d7479; font-style: italic; }
      .section-body p { line-height: 1.65; }
      .appendix { margin-top: 20px; border-top: 1px solid rgba(19, 34, 43, 0.12); padding-top: 16px; }
      .appendix h3 { font-size: 18px; margin-bottom: 8px; break-after: avoid; }
      .appendix figure { margin: 12px 0; }
      .appendix table { table-layout: auto; font-size: 12px; }
      .appendix th, .appendix td { padding: 6px 8px; overflow-wrap: normal; word-break: normal; }
      .appendix th { font-size: 12px; letter-spacing: 0; text-transform: none; }
      .appendix-source { font-size: 13px; color: #3c4a52; overflow-wrap: anywhere; }
      .appendix li, #safety-seed-provenance li { overflow-wrap: anywhere; }
      .appendix-facts { margin: 12px 0; }
      .appendix-facts > div { break-inside: avoid; padding: 4px 0; border-bottom: 1px solid rgba(19, 34, 43, 0.08); font-size: 15px; line-height: 1.5; overflow-wrap: anywhere; }
      .appendix-facts dt, .appendix-facts dd { display: inline; margin: 0; font: inherit; }
      .appendix-facts dt { font-weight: 700; letter-spacing: 0; text-transform: none; color: #13222b; }
      #evidence-appendices > p, .appendix-source, .appendix li, .cover-lines p { break-inside: avoid; }
      .cover-lines { margin-top: 16px; }
      .cover-lines p { max-width: none; margin: 4px 0; font-size: 15px; line-height: 1.5; overflow-wrap: anywhere; }
      .wrap-anywhere { overflow-wrap: anywhere; word-break: break-all; }
      .table-scroll { overflow-x: auto; }
      @media (max-width: 700px) { main { padding: 20px 14px 56px; } h1 { font-size: 30px; } }
      @media print { main, main > :last-child { padding-bottom: 0; } main > :last-child :last-child { margin-bottom: 0; } }`;

/**
 * The standing caveats whose evidence this document carries, in cover order.
 *
 * A caveat applies when an included appendix holds that evidence (benefit-cost,
 * engagement), when a section's final text or the AI draft it came from quotes
 * the caveat (drafts must quote it whenever they use that evidence), or, for
 * the Safety seed caveat, when a section came from a Safety seed. A caveat for
 * evidence the document does not use is left off.
 */
export function applicableStandingCaveats(data: GrantApplicationExportData): string[] {
  const texts = data.sections.flatMap(({ section, provenance }) =>
    section.status === "final" && section.final_markdown
      ? [section.final_markdown, provenance.sourceDraftText ?? ""]
      : []
  );
  const quoted = (caveat: string) => texts.some((text) => text.includes(caveat));
  const included = new Set(
    (data.evidenceAppendices ?? []).filter((appendix) => appendix.status === "included").map((appendix) => appendix.key)
  );
  const seeded =
    (data.safetySeedHistory?.length ?? 0) > 0 || data.sections.some((entry) => entry.provenance.safetySeed);
  const applies: Record<string, boolean> = {
    [GRANT_MODELING_PLANNING_CAVEAT]: quoted(GRANT_MODELING_PLANNING_CAVEAT),
    [BCA_NARRATIVE_CAVEAT]: included.has("bca") || quoted(BCA_NARRATIVE_CAVEAT),
    [ENGAGEMENT_NARRATIVE_CAVEAT]: included.has("engagement") || quoted(ENGAGEMENT_NARRATIVE_CAVEAT),
    [KB_NARRATIVE_CAVEAT]: quoted(KB_NARRATIVE_CAVEAT),
    [SAFETY_SEED_CAVEAT]: seeded,
  };
  return APPLICATION_EXPORT_STANDING_CAVEATS.filter((caveat) => applies[caveat]);
}

function coverMarkup(data: GrantApplicationExportData, draftStamps: readonly string[]): string {
  const { opportunity } = data;
  const calendar = data.calendar ?? UTC_CALENDAR;
  const caveats = applicableStandingCaveats(data);
  const isProposal = opportunity.pursuit_kind === "proposal";
  const finalCount = data.sections.filter((entry) => entry.section.status === "final").length;

  const applicantFacts = data.applicant
    ? `
      <div class="wide"><dt>Project</dt><dd>${esc(applicantNameLabel(data.applicant.project))}</dd></div>
      <div class="wide"><dt>Workspace</dt><dd>${esc(applicantNameLabel(data.applicant.workspace))}</dd></div>`
    : "";
  // The Program box names an OpenPlan program record. With none linked it is
  // left out: "Program: Not linked" under a title that names the funding
  // program read as a contradiction (KI-2026-11-16-035).
  const programFact = data.programTitle
    ? `
      <div><dt>Program</dt><dd>${esc(data.programTitle)}</dd></div>`
    : "";
  const coverLines = data.coverLines?.length
    ? `
    <div class="cover-lines">${data.coverLines.map((line) => `<p>${esc(line)}</p>`).join("")}</div>`
    : "";
  const coverFacts = isProposal
    ? `${applicantFacts}
      <div><dt>Issuing agency</dt><dd>${esc(opportunity.agency_name ?? "Not set")}</dd></div>
      <div><dt>Solicitation number</dt><dd>${esc(opportunity.solicitation_number ?? "Not set")}</dd></div>
      <div><dt>Proposals due</dt><dd>${esc(formatDateTime(opportunity.closes_at, calendar))}</dd></div>
      <div><dt>Sections final</dt><dd>${finalCount} of ${data.sections.length}</dd></div>
      <div><dt>Assembled</dt><dd>${esc(formatDateTime(data.generatedAt, calendar))}</dd></div>`
    : `${applicantFacts}
      <div><dt>Funder / agency</dt><dd>${esc(opportunity.agency_name ?? "Not set")}</dd></div>${programFact}
      <div><dt>Expected award</dt><dd>${esc(formatAmount(opportunity.expected_award_amount))}</dd></div>
      <div><dt>Closes</dt><dd>${esc(formatDateTime(opportunity.closes_at, calendar))}</dd></div>
      <div><dt>Sections final</dt><dd>${finalCount} of ${data.sections.length}</dd></div>
      <div><dt>Assembled</dt><dd>${esc(formatDateTime(data.generatedAt, calendar))}</dd></div>`;

  return `<header class="hero">
    <span class="eyebrow">OpenPlan Grants: ${esc(applicationExportPacketLabel(opportunity.pursuit_kind))}</span>
    <h1>${esc(opportunity.title)}</h1>
    <p>${esc(
      opportunity.summary ||
        (isProposal
          ? "Assembled from operator-approved section texts for this solicitation response."
          : "Assembled from operator-approved section texts and the application attachment checklist.")
    )}</p>
    <div class="facts" style="margin-top: 18px;">${coverFacts}
    </div>${coverLines}
    ${draftStamps.map((stamp) => `<div class="draft-stamp">${esc(stamp)}</div>`).join("\n    ")}
    ${
      caveats.length > 0
        ? `<div class="warning-box">
      <strong>Standing caveats.</strong> This application cites OpenPlan-assembled evidence,
      and the following boundaries apply verbatim:
      <ul>
        ${caveats.map((caveat) => `<li>${esc(caveat)}</li>`).join("\n        ")}
      </ul>
    </div>`
        : ""
    }
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
    <div class="outstanding">Not finalized: this section is still in &ldquo;${esc(
      statusLabel
    )}&rdquo;. It is listed here as an outstanding item; no approved text exists for it yet.</div>
  </section>`;
}

/**
 * What answers a checklist item: the attached Knowledge Base document by its
 * title, so a reviewer can tell which file answers which requirement
 * (KI-2026-11-16-034), or the generated report artifact.
 */
function attachmentFulfillment(attachment: ApplicationAttachmentRow, documentTitles?: ReadonlyMap<string, string>): string {
  if (attachment.kb_document_id) {
    const title = documentTitles?.get(attachment.kb_document_id)?.trim();
    return title ? `Knowledge Base document: ${title}` : "Knowledge Base document (its title could not be read)";
  }
  return attachment.report_artifact_id ? "Generated report artifact" : "Nothing attached";
}

function attachmentsMarkup(
  attachments: readonly ApplicationAttachmentRow[],
  ifApplicableKeys?: ReadonlySet<string>,
  documentTitles?: ReadonlyMap<string, string>
): string {
  if (attachments.length === 0) {
    return `<section>
      <h2 class="section-title">Attachment checklist</h2>
      <p class="empty">No checklist items are recorded for this application.</p>
    </section>`;
  }

  return `<section>
    <h2 class="section-title">Attachment checklist</h2>
    <div class="table-scroll"><table>
      <thead>
        <tr><th>Attachment</th><th>Required</th><th>Status</th><th>Fulfillment</th><th>Note</th></tr>
      </thead>
      <tbody>
        ${attachments
          .map((attachment) => {
            const fulfillment = attachmentFulfillment(attachment, documentTitles);
            return `<tr>
          <td>${esc(attachment.title)}</td>
          <td>${attachmentRequirementLabel(attachment, ifApplicableKeys)}</td>
          <td>${esc(ATTACHMENT_STATUS_LABELS[attachment.status] ?? attachment.status)}</td>
          <td>${esc(fulfillment)}</td>
          <td>${esc(attachment.note?.trim() || "No note")}</td>
        </tr>`;
          })
          .join("\n        ")}
      </tbody>
    </table></div>
  </section>`;
}

function provenanceMarkup(sections: readonly GrantApplicationExportSection[], calendar: WorkspaceCalendar): string {
  return `<section id="provenance-appendix">
    <h2 class="section-title">Provenance appendix</h2>
    <p>How each section's text came to be, disclosed per section. AI drafts are writing support
    grounded in workspace evidence; the operator who finalized a section is the authority for it.</p>
    <div class="table-scroll"><table>
      <thead>
        <tr><th>Section</th><th>Status</th><th>Origin</th><th>Model</th><th>Grounding</th><th>Finalized by</th><th>Finalized</th></tr>
      </thead>
      <tbody>
        ${sections
          .map((entry) => {
            const { section, provenance } = entry;
            // An empty cell says why it is empty, in words.
            const fromAiDraft = provenance.origin === "ai_draft_unedited" || provenance.origin === "ai_draft_edited";
            const isFinal = section.status === "final";
            const grounding =
              provenance.groundedSentenceCount !== null && provenance.totalSentenceCount !== null
                ? `${provenance.groundedSentenceCount} of ${provenance.totalSentenceCount} sentences grounded`
                : fromAiDraft ? "Not recorded" : "Not applicable";
            return `<tr>
          <td>${esc(section.title)}</td>
          <td>${esc(SECTION_STATUS_LABELS[section.status] ?? section.status)}</td>
          <td>${esc(ORIGIN_LABELS[provenance.origin])}</td>
          <td>${esc(provenance.model ?? (fromAiDraft ? "Not recorded" : "No model"))}</td>
          <td>${esc(grounding)}</td>
          <td>${esc(provenance.finalizedBy ?? (isFinal ? "Not recorded" : "Not finalized"))}</td>
          <td>${esc(provenance.finalizedAt ? formatDateTime(provenance.finalizedAt, calendar) : isFinal ? "Not recorded" : "Not finalized")}</td>
        </tr>`;
          })
          .join("\n        ")}
      </tbody>
    </table></div>
  </section>`;
}

export function buildGrantApplicationHtml(data: GrantApplicationExportData): string {
  const orderedSections = [...data.sections].sort(
    (left, right) => left.section.sort_order - right.section.sort_order
  );
  const draftStamps = applicationDraftStamps(
    orderedSections.map((entry) => entry.section),
    data.attachments
  );

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(data.opportunity.title)}: ${esc(applicationExportPacketLabel(data.opportunity.pursuit_kind))}</title>
    <style>${DOCUMENT_STYLES}
    </style>
  </head>
  <body>
    <main>
      ${coverMarkup({ ...data, sections: orderedSections }, draftStamps)}
      ${orderedSections.map((entry) => sectionMarkup(entry)).join("\n      ")}
      ${attachmentsMarkup(data.attachments, data.ifApplicableAttachmentKeys, data.attachmentDocumentTitles)}
      ${evidenceAppendicesMarkup(data.evidenceAppendices, data.evidenceAppendixFrame ?? SS4A_APPENDIX_FRAME)}
      ${provenanceMarkup(orderedSections, data.calendar ?? UTC_CALENDAR)}
      ${safetySeedHistoryMarkup(data.safetySeedHistory ?? orderedSections.flatMap((entry) => entry.provenance.safetySeed ? [entry.provenance.safetySeed] : []))}
    </main>
  </body>
</html>`;
}

/** Frozen qualifications remain in exports even after later operator edits. */
function safetySeedHistoryMarkup(history: readonly SafetySeedProvenance[]): string {
  if (!history.length) return "";
  return `<section id="safety-seed-provenance"><h2>Safety seed sources and caveats</h2>${history.map((p) => `<article>
    <p>${esc(p.caveat)}</p>
    <p>Source report: <a href="/reports/${esc(p.reportId)}#artifact-${esc(p.artifactId)}">${esc(p.reportId)}</a>.
    Artifact: <a href="/api/reports/${esc(p.reportId)}/artifacts/${esc(p.artifactId)}/download">${esc(p.artifactId)}</a>.
    Acquisition: ${esc(p.acquisitionId)}. Snapshot SHA-256: ${esc(p.snapshotHash)}.</p>
    <ul>${p.sourceCaveats.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></article>`).join("")}</section>`;
}

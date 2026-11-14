/**
 * AN APPLICATION WHOSE FINAL SECTIONS STILL HOLD [VERIFY] MARKERS OR THE SAFETY
 * SEED'S UNFILLED PLACEHOLDERS IS STAMPED DRAFT, WITH THE REASON
 * (KI-2026-11-14-061, first full journey, run 9).
 *
 * Run 9 finalized all six SS4A sections straight from the Safety seed. The
 * packet printed dozens of [VERIFY] markers in its own section text and a
 * budget section that was still the seed's placeholder, and its cover carried
 * no DRAFT stamp. Finalizing stays the planner's call; the export now says
 * what remains.
 *
 * What counts: [VERIFY], [VERIFY: ...] and [OPERATOR: ...] in the final text
 * of final sections. What does not: markers the product prints by design in
 * the evidence appendices (the countermeasure table's CMF note, the
 * attachment note) and the Safety seed sources appendix, and text of sections
 * that are not final.
 *
 * Blind category: the PDF itself (the email guard file renders it with
 * Chrome), how the stamp reads at 390 px, and markers spelled any other way
 * (a lowercase "[verify]" is not this product's marker and is not counted).
 */

import { describe, expect, it } from "vitest";
import {
  applicationDraftStamps,
  countUnverifiedItems,
  summarizeUnverifiedSections,
  unverifiedDraftStamp,
} from "@/lib/grants/application-draft-stamps";
import {
  buildGrantApplicationHtml,
  type GrantApplicationExportData,
  type GrantApplicationExportSection,
} from "@/lib/grants/application-html";
import type { ApplicationAttachmentRow, ApplicationSectionRow } from "@/lib/grants/application";
import { SS4A_APPENDIX_KEYS } from "@/lib/grants/ss4a-appendix-keys";
import { buildSs4aEvidenceAppendices } from "@/lib/grants/ss4a-evidence-appendices";
import { buildSafetySeedPreview } from "@/lib/grants/ss4a-safety-seed";
import { safetySeedFixture } from "./fixtures/grants/safety-seed";
import { completeEvidenceRecords, evidenceSnapshot } from "./fixtures/grants/ss4a-evidence";

const OPPORTUNITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

function section(index: number, overrides: Partial<ApplicationSectionRow> = {}): ApplicationSectionRow {
  return {
    id: `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`,
    workspace_id: WORKSPACE_ID,
    opportunity_id: OPPORTUNITY_ID,
    section_key: `section-${index}`,
    title: `Section ${index}`,
    guidance: null,
    sort_order: index,
    source: "catalog",
    suggested_evidence: [],
    ai_drafting_enabled: true,
    status: "final",
    final_markdown: "Staff confirmed every figure in this section.",
    finalized_from_draft_id: null,
    finalized_by: "22222222-2222-4222-8222-222222222222",
    finalized_at: "2026-11-14T05:54:00.000Z",
    updated_by: null,
    created_at: "2026-11-14T00:00:00.000Z",
    updated_at: "2026-11-14T05:54:00.000Z",
    ...overrides,
  };
}

function entry(row: ApplicationSectionRow): GrantApplicationExportSection {
  return {
    section: row,
    provenance: { origin: "operator_authored", model: null, groundedSentenceCount: null, totalSentenceCount: null,
      finalizedBy: "Workspace owner", finalizedAt: row.finalized_at },
  };
}

function requiredAttachment(status: ApplicationAttachmentRow["status"]): ApplicationAttachmentRow {
  return {
    id: "66666666-6666-4666-8666-666666666666", workspace_id: WORKSPACE_ID, opportunity_id: OPPORTUNITY_ID,
    attachment_key: "letters-of-support", title: "Letters of support", guidance: null, required: true, status,
    kb_document_id: null, report_artifact_id: null, note: null, sort_order: 0, updated_by: null,
    created_at: "2026-11-14T00:00:00.000Z", updated_at: "2026-11-14T00:00:00.000Z",
  };
}

function packet(sections: ApplicationSectionRow[], overrides: Partial<GrantApplicationExportData> = {}): string {
  return buildGrantApplicationHtml({
    opportunity: { id: OPPORTUNITY_ID, title: "SS4A application", agency_name: null, summary: null, expected_award_amount: null,
      closes_at: null, opportunity_status: null, decision_state: null },
    programTitle: null,
    sections: sections.map(entry),
    attachments: [],
    generatedAt: "2026-11-14T06:00:00.000Z",
    ...overrides,
  });
}

/** The cover's stamps, read from the rendered document. */
function stamps(html: string): string[] {
  return [...html.matchAll(/<div class="draft-stamp">([^<]*)<\/div>/g)].map((match) => match[1]);
}

describe("final section text with unverified items stamps the export DRAFT", () => {
  it("stamps a packet whose final section holds a [VERIFY] marker, and says why", () => {
    const html = packet([
      section(1, { final_markdown: "Fatal crashes rose 40 percent [VERIFY]. The county adopted a goal [VERIFY: adoption date]." }),
      section(2),
    ]);
    expect(stamps(html)).toEqual(["DRAFT: 2 unverified items remain in 1 section"]);
  });

  it("does not stamp a packet whose final sections hold no marker", () => {
    const html = packet([section(1), section(2)]);
    expect(stamps(html)).toEqual([]);
    expect(html).not.toContain("DRAFT:");
  });

  it("counts the Safety seed's unfilled placeholders, singular and plural said right", () => {
    const html = packet([section(1, { final_markdown: "[OPERATOR: Enter the approved cost estimate.]" })]);
    expect(stamps(html)).toEqual(["DRAFT: 1 unfilled placeholder remains in 1 section"]);
  });

  it("does not count text of a section that is not final, which never prints as prose", () => {
    const html = packet([section(1, { status: "operator_review", final_markdown: "Draft claim [VERIFY]." }), section(2)]);
    expect(stamps(html)).toEqual([]);
  });

  it("prints both reasons when attachments are outstanding and items remain", () => {
    const html = packet([section(1, { final_markdown: "A claim [VERIFY]." })], { attachments: [requiredAttachment("missing")] });
    expect(stamps(html)).toEqual([
      "DRAFT: 1 required attachment(s) outstanding",
      "DRAFT: 1 unverified item remains in 1 section",
    ]);
  });

  it("leaves the markers the product prints by design in the appendices alone", () => {
    // A countermeasure with no cited CMF prints "[VERIFY] No crash
    // modification factor cited." in Appendix C, and the attachment note
    // prints "[VERIFY] Confirm the required attachments ...". The Safety seed
    // sources appendix repeats the seed's caveats, which carry [VERIFY] too.
    const records = completeEvidenceRecords();
    records.safety = { status: "ready", snapshot: evidenceSnapshot({}, ["walkways"]), otherSeededArtifactCount: 0 };
    const seed = buildSafetySeedPreview(safetySeedFixture()).sections[0].provenance;
    const html = packet([section(1)], {
      evidenceAppendices: buildSs4aEvidenceAppendices(records, new Set(SS4A_APPENDIX_KEYS)),
      safetySeedHistory: [{ ...seed, sourceCaveats: [...seed.sourceCaveats, "Equity is its own component [VERIFY]."] }],
    });
    // The document does carry by-design markers, so a stamp that counted the
    // whole document would fire here.
    expect(html.match(/\[VERIFY\]/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(stamps(html)).toEqual([]);
  });

  it("stamps six sections finalized straight from the Safety seed, as run 9 did", () => {
    const seeded = buildSafetySeedPreview(safetySeedFixture()).sections;
    const rows = seeded.map((draft, index) =>
      section(index, { section_key: draft.section_key, title: draft.section_key, final_markdown: draft.draft_markdown })
    );
    const [stamp] = stamps(packet(rows));
    // Every seeded section ends a manual gap with one [OPERATOR: ...] placeholder.
    expect(stamp).toMatch(/^DRAFT: (\d+ unverified items?, )?6 unfilled placeholders remain in 6 sections$/);
    const summary = summarizeUnverifiedSections(rows);
    expect(summary.sections.map((entry) => entry.sectionKey)).toEqual(seeded.map((draft) => draft.section_key));
  });
});

describe("the counter and the stamp text", () => {
  it("counts [VERIFY], [VERIFY: ...] and [OPERATOR: ...] and nothing else", () => {
    expect(countUnverifiedItems("A [VERIFY] B [VERIFY: source] C [OPERATOR: fill in] D [verify] E [VERIFIED] F VERIFY")).toEqual({
      verify: 2,
      placeholders: 1,
    });
    expect(countUnverifiedItems(null)).toEqual({ verify: 0, placeholders: 0 });
  });

  it("names the totals and the number of sections that hold them", () => {
    const summary = summarizeUnverifiedSections([
      section(1, { final_markdown: "[VERIFY] [VERIFY] [OPERATOR: a]" }),
      section(2, { final_markdown: "[OPERATOR: b]" }),
      section(3),
    ]);
    expect(unverifiedDraftStamp(summary)).toBe("DRAFT: 2 unverified items, 2 unfilled placeholders remain in 2 sections");
    expect(applicationDraftStamps([section(3)], [requiredAttachment("attached")])).toEqual([]);
  });
});

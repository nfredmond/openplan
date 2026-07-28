import { describe, expect, it } from "vitest";

import {
  APPLICATION_EXPORT_STANDING_CAVEATS,
  buildGrantApplicationHtml,
  countOutstandingRequiredAttachments,
  type GrantApplicationExportData,
  type GrantApplicationExportSection,
} from "@/lib/grants/application-html";
import { GRANT_MODELING_PLANNING_CAVEAT } from "@/lib/grants/modeling-evidence";
import { BCA_NARRATIVE_CAVEAT } from "@/lib/bca/parameters";
import { ENGAGEMENT_NARRATIVE_CAVEAT } from "@/lib/grants/engagement-evidence";
import { KB_NARRATIVE_CAVEAT } from "@/lib/grants/kb-evidence";
import type { ApplicationAttachmentRow, ApplicationSectionRow } from "@/lib/grants/application";

const OPPORTUNITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

function section(overrides: Partial<ApplicationSectionRow> = {}): ApplicationSectionRow {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    workspace_id: WORKSPACE_ID,
    opportunity_id: OPPORTUNITY_ID,
    section_key: "project-narrative",
    title: "Project description and scope",
    guidance: null,
    sort_order: 0,
    source: "catalog",
    suggested_evidence: [],
    ai_drafting_enabled: true,
    status: "final",
    final_markdown: "This corridor **matters** to the region. [fact:fact_1]",
    finalized_from_draft_id: null,
    updated_by: "22222222-2222-4222-8222-222222222222",
    created_at: "2026-07-27T00:00:00.000Z",
    updated_at: "2026-07-27T02:00:00.000Z",
    ...overrides,
  };
}

function exportSection(
  overrides: Partial<ApplicationSectionRow> = {},
  provenance: Partial<GrantApplicationExportSection["provenance"]> = {}
): GrantApplicationExportSection {
  return {
    section: section(overrides),
    provenance: {
      origin: "operator_authored",
      model: null,
      groundedSentenceCount: null,
      totalSentenceCount: null,
      finalizedBy: "22222222-2222-4222-8222-222222222222",
      finalizedAt: "2026-07-27T02:00:00.000Z",
      ...provenance,
    },
  };
}

function attachment(overrides: Partial<ApplicationAttachmentRow> = {}): ApplicationAttachmentRow {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    workspace_id: WORKSPACE_ID,
    opportunity_id: OPPORTUNITY_ID,
    attachment_key: "letters-of-support",
    title: "Letters of support",
    guidance: null,
    required: true,
    status: "missing",
    kb_document_id: null,
    report_artifact_id: null,
    note: null,
    sort_order: 0,
    updated_by: null,
    created_at: "2026-07-27T00:00:00.000Z",
    updated_at: "2026-07-27T00:00:00.000Z",
    ...overrides,
  };
}

function exportData(overrides: Partial<GrantApplicationExportData> = {}): GrantApplicationExportData {
  return {
    opportunity: {
      id: OPPORTUNITY_ID,
      title: "Corridor safety package",
      agency_name: "State transportation commission",
      summary: "A grant application assembled from workspace evidence.",
      expected_award_amount: 500000,
      closes_at: "2026-09-30T00:00:00.000Z",
      opportunity_status: "open",
      decision_state: "pursue",
    },
    programTitle: "Active Transportation Program",
    sections: [exportSection()],
    attachments: [attachment()],
    generatedAt: "2026-07-27T03:00:00.000Z",
    ...overrides,
  };
}

describe("buildGrantApplicationHtml", () => {
  it("renders a complete self-contained document: cover, sections, checklist, provenance", () => {
    const html = buildGrantApplicationHtml(exportData());

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Corridor safety package");
    expect(html).toContain("State transportation commission");
    expect(html).toContain("Active Transportation Program");
    expect(html).toContain("$500,000");
    // Final markdown renders through the chapter renderer, citation tokens stripped.
    expect(html).toContain("<strong>matters</strong>");
    expect(html).not.toContain("[fact:");
    // Checklist table and provenance appendix are present.
    expect(html).toContain("Attachment checklist");
    expect(html).toContain("Letters of support");
    expect(html).toContain("Provenance appendix");
    expect(html).toContain("Operator-authored");
    expect(html).toContain("22222222-2222-4222-8222-222222222222");
    // No external assets — a strict offline document.
    expect(html).not.toMatch(/src="http/);
    expect(html).not.toMatch(/href="http/);
  });

  it("escapes hostile values instead of letting them into the markup", () => {
    const html = buildGrantApplicationHtml(
      exportData({
        opportunity: {
          ...exportData().opportunity,
          title: 'Corridor <script>alert("x")</script> package',
          agency_name: '<img src="x" onerror="steal()">',
        },
        attachments: [attachment({ note: "<script>document.cookie</script>" })],
      })
    );

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=");
    expect(html).toContain("&lt;script&gt;");
  });

  it("carries every standing caveat line on the cover verbatim", () => {
    const html = buildGrantApplicationHtml(exportData());

    expect(APPLICATION_EXPORT_STANDING_CAVEATS).toEqual([
      GRANT_MODELING_PLANNING_CAVEAT,
      BCA_NARRATIVE_CAVEAT,
      ENGAGEMENT_NARRATIVE_CAVEAT,
      KB_NARRATIVE_CAVEAT,
    ]);
    for (const caveat of APPLICATION_EXPORT_STANDING_CAVEATS) {
      expect(html).toContain(caveat);
    }
  });

  it("stamps the document DRAFT when required attachments are outstanding", () => {
    const html = buildGrantApplicationHtml(
      exportData({
        attachments: [
          attachment(),
          attachment({ id: "67676767-6767-4767-8767-676767676767", attachment_key: "site-plan", title: "Site plan", status: "in_progress" }),
        ],
      })
    );

    expect(html).toContain("DRAFT — 2 required attachment(s) outstanding");
  });

  it("does not stamp DRAFT when every required item is attached or not applicable", () => {
    const html = buildGrantApplicationHtml(
      exportData({
        attachments: [
          attachment({ status: "attached", kb_document_id: "77777777-7777-4777-8777-777777777777" }),
          attachment({
            id: "67676767-6767-4767-8767-676767676767",
            attachment_key: "site-plan",
            title: "Site plan",
            status: "not_applicable",
          }),
        ],
      })
    );

    expect(html).not.toContain("DRAFT —");
  });

  it("renders a non-final section as a disclosed outstanding item, never as prose", () => {
    const html = buildGrantApplicationHtml(
      exportData({
        sections: [
          exportSection(),
          exportSection(
            {
              id: "56565656-5656-4656-8656-565656565656",
              section_key: "community-engagement",
              title: "Community engagement",
              status: "drafting",
              final_markdown: null,
              sort_order: 1,
            },
            { origin: "none", finalizedBy: null, finalizedAt: null }
          ),
        ],
      })
    );

    expect(html).toContain("Community engagement");
    expect(html).toContain("Not finalized");
    expect(html).toContain("no approved text exists for it yet");
  });

  it("discloses AI-draft provenance with model and grounding verdict", () => {
    const html = buildGrantApplicationHtml(
      exportData({
        sections: [
          exportSection(
            {},
            {
              origin: "ai_draft_unedited",
              model: "claude-opus-4-8",
              groundedSentenceCount: 4,
              totalSentenceCount: 4,
            }
          ),
        ],
      })
    );

    expect(html).toContain("AI draft finalized unedited (passed the grounding gate)");
    expect(html).toContain("claude-opus-4-8");
    expect(html).toContain("4 of 4 sentences grounded");
  });
});

describe("countOutstandingRequiredAttachments", () => {
  it("counts required items that are neither attached nor not-applicable", () => {
    expect(
      countOutstandingRequiredAttachments([
        attachment({ status: "missing" }),
        attachment({ status: "in_progress" }),
        attachment({ status: "attached" }),
        attachment({ status: "not_applicable" }),
        attachment({ required: false, status: "missing" }),
      ])
    ).toBe(2);
  });
});

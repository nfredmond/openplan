import { describe, expect, it } from "vitest";

/**
 * PROVENANCE IN THE BOARD EXPORT BODY — Nathaniel's Q2 decision, 2026-08-11,
 * and the word BODY is the decision.
 *
 * A board member reading a programmed cost in the packet is the person who most
 * needs to know it was copied from page 44 of the adopted plan and what that
 * page says. They need it beside the figure, at the meeting, not in a table at
 * the back that nobody opens — so the citation is rendered inline in the
 * project list, with the document's own sentence.
 *
 * THE THREE STATES, AND THE THIRD IS THE ONE THAT GETS FORGOTTEN:
 *
 *   a transcribed figure  → its document, its page, its quote, in the body.
 *   a hand-typed figure   → nothing at all. A citation on a typed number is an
 *                           invented one.
 *   citations UNREADABLE  → the section says so. `null` and `{}` are different
 *                           facts: "we could not read where these came from"
 *                           and "none of these came from a document". Only the
 *                           second is a statement about the plan, and a packet
 *                           that silently dropped its citations would look
 *                           exactly like a plan somebody typed by hand.
 *
 * MUTATION RESULTS are recorded at the bottom of this file.
 */

import {
  buildRtpExportHtml,
  normalizeRtpLinkedProjects,
  type RtpExportOptions,
} from "@/lib/rtp/export";
import type { TranscriptionRecord } from "@/lib/rtp/extraction/display";

const TRANSCRIBED_LINK_ID = "link-transcribed";
const TYPED_LINK_ID = "link-typed";

const subject = {
  cycle: {
    id: "cycle-1",
    workspace_id: "workspace-1",
    title: "2027 Regional Transportation Plan",
    status: "public_review",
    geography_label: "Example County",
    horizon_start_year: 2027,
    horizon_end_year: 2050,
    adoption_target_date: null,
    public_review_open_at: null,
    public_review_close_at: null,
    summary: null,
    updated_at: "2026-04-24T00:00:00.000Z",
  },
  chapters: [],
  linkedProjects: normalizeRtpLinkedProjects([
    {
      id: TRANSCRIBED_LINK_ID,
      project_id: "project-1",
      portfolio_role: "constrained",
      priority_rationale: null,
      horizon_band_id: null,
      estimated_cost: 12_400_000,
      cost_basis_year: 2023,
      projects: {
        id: "project-1",
        name: "Main Street Complete Street",
        status: null,
        delivery_phase: null,
        summary: null,
      },
    },
    {
      id: TYPED_LINK_ID,
      project_id: "project-2",
      portfolio_role: "constrained",
      priority_rationale: null,
      horizon_band_id: null,
      estimated_cost: 3_000_000,
      cost_basis_year: 2023,
      projects: {
        id: "project-2",
        name: "Riverside Path Extension",
        status: null,
        delivery_phase: null,
        summary: null,
      },
    },
  ]),
  campaigns: [],
  priorityCriteria: [],
};

const transcribedCost: TranscriptionRecord = {
  candidateId: "candidate-1",
  kbDocumentId: "document-1",
  documentTitle: "Example County RTP 2050 (adopted)",
  page: 44,
  quote: "Main Street Complete Street — Constrained — 2023–2032 — $12.4M",
  divergentFields: [],
};

function render(options: Partial<RtpExportOptions>): string {
  return buildRtpExportHtml({
    ...subject,
    options: { composition: "whole_plan", sectionKeys: ["project_lists"], ...options },
  });
}

describe("a transcribed cost in the export body", () => {
  it("names the document and the page beside the figure", () => {
    const html = render({ transcriptions: { [TRANSCRIBED_LINK_ID]: transcribedCost } });
    expect(html).toContain("Copied from “Example County RTP 2050 (adopted)”, page 44");
  });

  it("prints the document's own sentence, escaped", () => {
    const html = render({ transcriptions: { [TRANSCRIBED_LINK_ID]: transcribedCost } });
    expect(html).toContain("Main Street Complete Street — Constrained — 2023–2032 — $12.4M");
  });

  it("puts it in the project list itself, not in a trailing appendix", () => {
    const html = render({ transcriptions: { [TRANSCRIBED_LINK_ID]: transcribedCost } });
    const listStart = html.indexOf("<h2>Project lists</h2>");
    const citation = html.indexOf("Copied from “Example County RTP 2050 (adopted)”, page 44");
    const nextSection = html.indexOf("<h2>", listStart + 1);
    expect(listStart).toBeGreaterThan(-1);
    expect(citation).toBeGreaterThan(listStart);
    // Inside the project-lists section, before whatever section follows it.
    expect(nextSection === -1 || citation < nextSection).toBe(true);
  });

  it("says the agency revised a figure it no longer matches", () => {
    const html = render({
      transcriptions: {
        [TRANSCRIBED_LINK_ID]: {
          ...transcribedCost,
          divergentFields: [
            {
              key: "estimatedCost",
              label: "Programmed cost",
              kind: "money",
              documentValue: 12_400_000,
              recordedValue: 15_000_000,
              same: false,
            },
          ],
        },
      },
    });
    expect(html).toContain("page 44, and revised since");
  });
});

describe("a hand-typed cost in the export body", () => {
  it("carries no citation of any kind", () => {
    const html = render({ transcriptions: { [TRANSCRIBED_LINK_ID]: transcribedCost } });

    // Both projects are in the document…
    expect(html).toContain("Riverside Path Extension");
    // …and exactly one citation is.
    expect(html.match(/Copied from/g)?.length ?? 0).toBe(1);
  });

  it("says nothing at all when nothing in the plan was transcribed", () => {
    const html = render({ transcriptions: {} });
    expect(html).not.toContain("Copied from");
    // And the "could not be read" sentence is NOT printed for an empty map:
    // "nothing was transcribed" is a fact about the plan and it needs no
    // apology.
    expect(html).not.toContain("could not be read when this document was generated");
  });
});

describe("citations that could not be read", () => {
  it("are stated in the section rather than silently dropped", () => {
    const html = render({ transcriptions: null });
    expect(html).toContain("Where these figures came from could not be read");
    expect(html).toContain("This does not mean they were entered by hand");
  });

  it("is a different rendering from an empty map — the two facts stay apart", () => {
    const unreadable = render({ transcriptions: null });
    const nothingTranscribed = render({ transcriptions: {} });
    expect(unreadable).not.toBe(nothingTranscribed);
  });
});

/*
  MUTATION RESULTS, 2026-08-11. Each applied to `lib/rtp/export.ts`, this file
  RUN, then restored:

    - the citation span dropped from the project-list `<li>` → 5 failures, led
      by "names the document and the page beside the figure".
    - `const transcription = transcriptions?.[row.id]` replaced with the first
      value of the map → "carries no citation of any kind" fails: the typed
      Riverside cost gains a citation to page 44 of a document it never came
      from.
    - `citationsUnavailable` made unconditional (the sentence always printed) →
      2 failures, including "says nothing at all when nothing in the plan was
      transcribed". This is the polarity this repository has been burned by
      before: an absence sentence that is always true is not a disclosure.
    - `citationsUnavailable` deleted entirely → 2 failures, including "is a
      different rendering from an empty map", which is the assertion that keeps
      `null` and `{}` from collapsing into one answer.
*/

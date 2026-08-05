import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRtpExportHtml, normalizeRtpLinkedProjects } from "@/lib/rtp/export";
import { renderReportPdf } from "@/lib/reports/pdf";
import { pdfDrawnText, pdfSource } from "./pdf-text-extraction-helpers";

import { resolveRtpPriorityCriteria } from "@/lib/rtp/priority-frameworks";
import { US_CA_RTP_PRIORITY_FRAMEWORK } from "@/lib/rtp/frameworks/us-ca";

// A real resolved framework, not a hand-written fixture: these builders are
// being asked to prove they render the basis they were GIVEN.
const CA_CRITERIA = resolveRtpPriorityCriteria(US_CA_RTP_PRIORITY_FRAMEWORK);


/**
 * The board packet must leave the building whole.
 *
 * `/api/rtp-cycles/[id]/export?format=pdf` used to assemble its OWN, much
 * shorter line list — omitting the modeling-evidence posture, the funding
 * source-context scans, the adoption-record checklist and the appendix
 * outright — and then cut it to 60 lines on a single `/Count 1` page. A
 * multi-chapter packet a planner had spent hours on came out as one clipped
 * page, with nothing saying anything was missing.
 *
 * These assertions run against the built-in typesetter, pinned by pointing
 * CHROME_EXECUTABLE_PATH at nothing: Chrome's output is version- and
 * font-dependent, and on a host that happens to have Chrome installed this
 * would otherwise launch a real browser.
 */

const CHAPTER_COUNT = 24;

function packetHtml() {
  return buildRtpExportHtml({
    priorityCriteria: CA_CRITERIA,
    cycle: {
      id: "cycle-1",
      workspace_id: "workspace-1",
      title: "2027 Regional Transportation Plan",
      status: "draft",
      geography_label: "Nevada County",
      horizon_start_year: 2027,
      horizon_end_year: 2050,
      adoption_target_date: "2026-06-01T00:00:00.000Z",
      public_review_open_at: "2026-04-20T00:00:00.000Z",
      public_review_close_at: "2026-05-20T00:00:00.000Z",
      summary: "Cycle summary",
      updated_at: "2026-04-16T00:00:00.000Z",
    },
    chapters: Array.from({ length: CHAPTER_COUNT }, (_, i) => ({
      id: `chapter-${i}`,
      title: `Chapter ${i + 1} — Corridor Element`,
      section_type: "financial_plan",
      status: "ready_for_review",
      summary: `Summary for chapter ${i + 1}.`,
      guidance: "",
      content_markdown: `Body content for chapter ${i + 1}. `.repeat(12),
      sort_order: i * 10,
    })),
    linkedProjects: normalizeRtpLinkedProjects(
      Array.from({ length: 12 }, (_, i) => ({
        id: `link-${i}`,
        project_id: `project-${i}`,
        portfolio_role: "constrained",
        priority_rationale: `Priority rationale ${i + 1}`,
        projects: {
          id: `project-${i}`,
          name: `Portfolio Project ${i + 1}`,
          status: "active",
          delivery_phase: "analysis",
          summary: `Project ${i + 1} summary`,
        },
      }))
    ),
    campaigns: [
      {
        id: "campaign-1",
        title: "Planwide comments",
        status: "active",
        engagement_type: "comment_collection",
        summary: "Collect planwide feedback",
        rtp_cycle_chapter_id: null,
      },
    ],
  });
}

async function renderPacket() {
  const html = packetHtml();
  const rendered = await renderReportPdf(html, {
    title: "2027 Regional Transportation Plan",
    generatedAt: null,
    footerLabel: "OpenPlan RTP board packet",
  });
  return {
    html,
    rendered,
    source: pdfSource(rendered.bytes),
    drawn: pdfDrawnText(rendered.bytes),
  };
}

describe("RTP board packet PDF", () => {
  const ORIGINAL = process.env.CHROME_EXECUTABLE_PATH;

  beforeEach(() => {
    process.env.CHROME_EXECUTABLE_PATH = "/nonexistent/chrome-for-tests";
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CHROME_EXECUTABLE_PATH;
    else process.env.CHROME_EXECUTABLE_PATH = ORIGINAL;
  });

  it("spans as many pages as it needs, and declares the true count", async () => {
    const { rendered, source } = await renderPacket();

    expect(rendered.pageCount).toBeGreaterThan(1);
    const declared = Number(/\/Count (\d+)/.exec(source)?.[1]);
    const pageObjects = [...source.matchAll(/\/Type \/Page[^s]/g)].length;
    expect(declared).toBe(rendered.pageCount);
    expect(pageObjects).toBe(rendered.pageCount);
  });

  it("keeps EVERY chapter, not the first N that fit on one page", async () => {
    const { drawn } = await renderPacket();

    for (let i = 1; i <= CHAPTER_COUNT; i += 1) {
      expect(drawn).toContain(`Chapter ${i} — Corridor Element`);
    }
  });

  it("keeps the whole linked-project portfolio", async () => {
    const { drawn } = await renderPacket();

    for (let i = 1; i <= 12; i += 1) {
      expect(drawn).toContain(`Portfolio Project ${i}`);
    }
  });

  /**
   * Parity is derived from the live HTML rather than a hardcoded list, so it
   * cannot decay as sections are added to the packet generator.
   */
  it("carries every section heading the HTML packet shows", async () => {
    const { html, drawn } = await renderPacket();

    const headings = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) =>
      m[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim()
    );
    expect(headings.length).toBeGreaterThan(2);

    for (const heading of headings) {
      expect(drawn).toContain(heading);
    }
  });

  it("numbers every page and never claims to be a single page", async () => {
    const { rendered, drawn } = await renderPacket();

    expect(drawn).toContain(`Page 1 of ${rendered.pageCount}`);
    expect(drawn).toContain(`Page ${rendered.pageCount} of ${rendered.pageCount}`);
    expect(drawn).toContain("OpenPlan RTP board packet");
  });

  it("discloses the typesetting tier inside the packet", async () => {
    const { rendered, drawn } = await renderPacket();

    expect(rendered.engine).toBe("builtin");
    expect(drawn).toContain("no section has been shortened or dropped");
  });
});

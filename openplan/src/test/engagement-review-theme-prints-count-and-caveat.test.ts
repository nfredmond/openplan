/**
 * A STAFF THEME IN THE REVIEW PDF SAYS HOW MANY COMMENTS IT HOLDS, AND THAT A
 * FEW COMMENTS ARE NOT PUBLIC OPINION.
 *
 * Found on 2026-11-14 by an agent running the engagement job on a local stack
 * for a county, a town and a tribal area. The internal review PDF printed each
 * staff theme as "<label> | Staff sentiment: not_assessed" with its summary. The
 * number of comments in the theme was only in the workbook, and nothing beside
 * the theme said that a theme of two comments is not what "the public" thinks.
 *
 * WHAT THIS FILE CANNOT PROVE. It reads the HTML the PDF is printed from, not a
 * rendered PDF, so it says nothing about page breaks or what a reader notices.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decisionSynthesisGroupCountCaveat } from "@/lib/engagement/decision-synthesis-export";
import { parseReviewSnapshot, buildCampaignReviewHtml } from "@/lib/engagement/review-export";
import { address, row, withReviewWords } from "./fixtures/engagement/decision-synthesis";
import nativeReview from "./fixtures/engagement-review-decision-history-native.json";

vi.mock("@/lib/reports/pdf", () => ({ renderReportPdf: vi.fn() }));

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

async function reviewHtml() {
  const snapshot = JSON.parse(nativeReview.snapshotText);
  snapshot.campaign.id = address.campaignId;
  snapshot.workspaceId = address.workspaceId;
  snapshot.decisionLinks = [row(withReviewWords())];
  snapshot.decisionLinkCount = 1;
  const raw = JSON.stringify(snapshot);
  return buildCampaignReviewHtml(await parseReviewSnapshot(raw, hash(raw)), "test");
}

describe("a staff theme in the internal review PDF", () => {
  it("prints its contribution count and the caveat in the same block as its label", async () => {
    const html = await reviewHtml();
    const document = new DOMParser().parseFromString(html, "text/html");
    const actions = [...document.querySelectorAll("section")].filter((section) =>
      /^Response-link action \d+/.test(section.querySelector("h4")?.textContent ?? "")
    );
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      const groupLine = [...action.querySelectorAll("p")].find((p) => /Staff sentiment:/.test(p.textContent ?? ""));
      expect(groupLine).toBeDefined();
      // The count printed beside the label is the action's own retained membership.
      const references = action.querySelectorAll('a[href^="#synthesis-source-"]').length;
      const noun = references === 1 ? "contribution" : "contributions";
      expect(groupLine!.textContent).toContain(`${references} ${noun} in this group`);
      expect(groupLine!.nextElementSibling?.textContent).toBe(decisionSynthesisGroupCountCaveat);
    }
  });

  it("says that a count of comments is not public opinion", () => {
    expect(decisionSynthesisGroupCountCaveat).toMatch(/not .*public opinion/);
    expect(decisionSynthesisGroupCountCaveat).toMatch(/records, not people/);
  });
});

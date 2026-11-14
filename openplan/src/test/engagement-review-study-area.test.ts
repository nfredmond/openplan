/**
 * THE REVIEW PDF NAMES THE STUDY AREA THE CAMPAIGN'S MAP USED, NOT "NOT
 * SUPPLIED" (KI-2026-11-14-323).
 *
 * A campaign with no area of its own opens its public map on its project's
 * place, or else the workspace's home area. The review PDF printed only the
 * campaign's own place, so in the November 14 run-through it said "Study area:
 * Not supplied." for three campaigns whose maps opened on Coos County, OR,
 * Lander and the Hopi Reservation, AZ. The retained campaign definition
 * already records the project's and the workspace's place as they stood when
 * the campaign's settings were saved (`project_frame`, `workspace_frame` in
 * `capture_engagement_configuration`), and the run-through's saved snapshots
 * held all three labels, so the PDF can name that place without a database
 * change. "Not supplied" stays only when none of the three was recorded.
 *
 * WHAT THIS FILE CANNOT PROVE. That the recorded place is the project's place
 * today: a project place changed after the campaign's settings were last saved
 * is not in the definition, and the sentence says the place is as recorded.
 */
import { describe, expect, it, vi } from "vitest";
import { buildCampaignReviewHtml, campaignStudyAreaText, parseReviewSnapshot } from "@/lib/engagement/review-export";
import { internalReviewCountSnapshot, savedSnapshot } from "./fixtures/engagement/review-counts";

vi.mock("@/lib/reports/pdf", () => ({ renderReportPdf: vi.fn() }));

const frame = (label: string | null) => ({ label, bbox: [null, null, null, null], source: label ? "tigerweb" : null });

async function studyAreaLine(campaign: Record<string, unknown> | null) {
  const snapshot = internalReviewCountSnapshot();
  if (campaign) {
    snapshot.campaign.configurationVersionId = "version-1";
    snapshot.definitions = [{ id: "version-1", sha256: "test", definition: { campaign, categories: [], questions: [], layers: [] } }];
  }
  const saved = savedSnapshot(snapshot);
  const html = buildCampaignReviewHtml(await parseReviewSnapshot(saved.text, saved.checksum), saved.checksum);
  const document = new DOMParser().parseFromString(html, "text/html");
  return [...document.querySelectorAll("p")].map((p) => p.textContent ?? "").find((text) => text.startsWith("Study area"));
}

describe("the review PDF's study area line", () => {
  it("names the campaign's own place when it has one", async () => {
    expect(await studyAreaLine({ place_label: "Campaign corridor", project_frame: frame("Coos County, OR"), workspace_frame: frame(null) }))
      .toMatch(/^Study area: Campaign corridor\. Participation opens/);
  });

  it("names the project's recorded place when the campaign has none, and says so", async () => {
    expect(await studyAreaLine({ place_label: null, project_frame: frame("Coos County, OR"), workspace_frame: frame(null) }))
      .toMatch(/^Study area: Coos County, OR \(the project's place, as recorded with the campaign's saved settings\)\. The campaign has no study area of its own\./);
  });

  it("names the workspace's recorded home area when neither the campaign nor its project has a place", () => {
    expect(campaignStudyAreaText({ place_label: null, project_frame: frame(null), workspace_frame: frame("Home county") }))
      .toBe("Study area: Home county (the workspace's home area, as recorded with the campaign's saved settings). Neither the campaign nor its project had a study area of its own.");
  });

  it("says not supplied only when no place was recorded, and unavailable when the definition is missing", async () => {
    expect(campaignStudyAreaText({ place_label: null, project_frame: frame(null), workspace_frame: frame(null) })).toBe("Study area: Not supplied.");
    expect(campaignStudyAreaText({ place_label: "  " })).toBe("Study area: Not supplied.");
    expect(await studyAreaLine(null)).toMatch(/^Study area: unavailable in this saved snapshot\./);
  });
});

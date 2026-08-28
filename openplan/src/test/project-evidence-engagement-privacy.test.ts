import { describe, expect, it } from "vitest";
import {
  isPublicProjectEngagementCampaign,
  isPublishableProjectEngagementGeometry,
} from "@/lib/project-evidence-bundles/engagement-export-privacy";

describe("project evidence engagement privacy", () => {
  it("exports only approved public geometry from a campaign with a live public page", () => {
    expect(isPublicProjectEngagementCampaign({
      status: "active",
      share_token: "public-campaign-token",
      allow_public_submissions: false,
      submissions_closed_at: "2026-08-20T00:00:00Z",
    })).toBe(true);
    expect(isPublishableProjectEngagementGeometry({
      id: "public-1",
      status: "approved",
      source_type: "public_comment",
      metadata_json: { submitted_via: "public_portal" },
    })).toBe(true);
  });

  it.each([
    { id: "private-1", status: "approved", source_type: "public_comment", metadata_json: { visibility: "private" } },
    { id: "internal-1", status: "approved", source_type: "internal", metadata_json: {} },
    { id: "pending-1", status: "pending", source_type: "public_comment", metadata_json: {} },
  ])("keeps $id inside the workspace", (item) => {
    expect(isPublishableProjectEngagementGeometry(item)).toBe(false);
  });

  it("does not treat a draft or unshared campaign as public", () => {
    expect(isPublicProjectEngagementCampaign({ status: "draft", share_token: "staged-token" })).toBe(false);
    expect(isPublicProjectEngagementCampaign({ status: "active", share_token: null })).toBe(false);
  });
});

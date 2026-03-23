import { describe, expect, it } from "vitest";
import {
  titleizeEngagementValue,
  normalizeEngagementSlug,
  makeEngagementCategorySlug,
  engagementStatusTone,
} from "@/lib/engagement/catalog";

describe("engagement catalog utilities (extended)", () => {
  it("titleizes compound engagement values", () => {
    expect(titleizeEngagementValue("map_feedback")).toBe("Map Feedback");
    expect(titleizeEngagementValue("comment_collection")).toBe("Comment Collection");
    expect(titleizeEngagementValue("meeting_intake")).toBe("Meeting Intake");
    expect(titleizeEngagementValue(null)).toBe("Unknown");
    expect(titleizeEngagementValue(undefined)).toBe("Unknown");
  });

  it("normalizes slugs consistently", () => {
    expect(normalizeEngagementSlug("Safety & Crossings")).toBe("safety-crossings");
    expect(normalizeEngagementSlug("  Highway 49 Corridor  ")).toBe("highway-49-corridor");
    expect(normalizeEngagementSlug("")).toBe("engagement-category");
  });

  it("generates unique category slugs with suffix", () => {
    const slug1 = makeEngagementCategorySlug("Safety");
    const slug2 = makeEngagementCategorySlug("Safety");
    expect(slug1).toMatch(/^safety-[a-f0-9]{6}$/);
    expect(slug2).toMatch(/^safety-[a-f0-9]{6}$/);
    // Should be unique due to UUID suffix
    expect(slug1).not.toBe(slug2);
  });

  it("maps engagement statuses to correct tones", () => {
    expect(engagementStatusTone("active")).toBe("success");
    expect(engagementStatusTone("approved")).toBe("success");
    expect(engagementStatusTone("closed")).toBe("warning");
    expect(engagementStatusTone("flagged")).toBe("warning");
    expect(engagementStatusTone("rejected")).toBe("danger");
    expect(engagementStatusTone("draft")).toBe("neutral");
    expect(engagementStatusTone("pending")).toBe("neutral");
    expect(engagementStatusTone("archived")).toBe("neutral");
    expect(engagementStatusTone("unknown_value")).toBe("neutral");
  });
});

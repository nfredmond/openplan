import { describe, expect, it } from "vitest";

import {
  DEMO_ENGAGEMENT_CAMPAIGN_ID,
  DEMO_ENGAGEMENT_ITEM_LIBRARY_BIKE_ID,
  DEMO_ENGAGEMENT_ITEM_NEAL_MILL_ID,
  DEMO_ENGAGEMENT_ITEM_RURAL_BUS_ID,
  DEMO_ENGAGEMENT_ITEM_SR20_SPEEDING_ID,
  DEMO_ENGAGEMENT_ITEMS,
} from "../../scripts/seed-nctc-demo";

describe("NCTC demo engagement items", () => {
  it("seeds four approved community-input points", () => {
    expect(DEMO_ENGAGEMENT_ITEMS).toHaveLength(4);
    for (const item of DEMO_ENGAGEMENT_ITEMS) {
      expect(item.status).toBe("approved");
      expect(item.title.trim().length).toBeGreaterThan(0);
      expect(item.body.trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps every point inside the authored Grass Valley area envelope", () => {
    for (const item of DEMO_ENGAGEMENT_ITEMS) {
      expect(item.latitude).toBeGreaterThanOrEqual(39.19);
      expect(item.latitude).toBeLessThanOrEqual(39.28);
      expect(item.longitude).toBeGreaterThanOrEqual(-121.08);
      expect(item.longitude).toBeLessThanOrEqual(-120.99);
    }
  });

  it("links every item to the deterministic demo campaign", () => {
    for (const item of DEMO_ENGAGEMENT_ITEMS) {
      expect(item.campaign_id).toBe(DEMO_ENGAGEMENT_CAMPAIGN_ID);
    }
  });

  it("uses deterministic UUIDs for idempotent upserts", () => {
    expect(DEMO_ENGAGEMENT_ITEMS.map((item) => item.id)).toEqual([
      DEMO_ENGAGEMENT_ITEM_NEAL_MILL_ID,
      DEMO_ENGAGEMENT_ITEM_LIBRARY_BIKE_ID,
      DEMO_ENGAGEMENT_ITEM_SR20_SPEEDING_ID,
      DEMO_ENGAGEMENT_ITEM_RURAL_BUS_ID,
    ]);
    expect(new Set(DEMO_ENGAGEMENT_ITEMS.map((item) => item.id)).size).toBe(4);
  });
});

import { describe, expect, it } from "vitest";

import {
  DEMO_ENGAGEMENT_CAMPAIGN_ID,
  DEMO_ENGAGEMENT_ITEM_BENNETT_SIDEWALK_LINE_ID,
  DEMO_ENGAGEMENT_ITEM_DOWNTOWN_CALM_AREA_ID,
  DEMO_ENGAGEMENT_ITEM_LIBRARY_BIKE_ID,
  DEMO_ENGAGEMENT_ITEM_NEAL_MILL_ID,
  DEMO_ENGAGEMENT_ITEM_RURAL_BUS_ID,
  DEMO_ENGAGEMENT_ITEM_SR20_SPEEDING_ID,
  DEMO_ENGAGEMENT_ITEM_SR49_SHOULDER_LINE_ID,
  DEMO_ENGAGEMENT_ITEM_VOTES,
  DEMO_ENGAGEMENT_ITEMS,
} from "../../scripts/seed-nctc-demo";
import {
  computeEngagementGeometryRepresentativePoint,
  parseEngagementGeometry,
} from "@/lib/engagement/geometry";

describe("NCTC demo engagement items", () => {
  it("seeds seven approved community-input items across points, lines, and an area", () => {
    expect(DEMO_ENGAGEMENT_ITEMS).toHaveLength(7);
    for (const item of DEMO_ENGAGEMENT_ITEMS) {
      expect(item.status).toBe("approved");
      expect(item.title.trim().length).toBeGreaterThan(0);
      expect(item.body.trim().length).toBeGreaterThan(0);
    }

    const geometryTypes = DEMO_ENGAGEMENT_ITEMS.map((item) => item.geometry.type);
    expect(geometryTypes.filter((type) => type === "Point")).toHaveLength(4);
    expect(geometryTypes.filter((type) => type === "LineString")).toHaveLength(2);
    expect(geometryTypes.filter((type) => type === "Polygon")).toHaveLength(1);
  });

  it("attaches a valid GeoJSON geometry to every item", () => {
    for (const item of DEMO_ENGAGEMENT_ITEMS) {
      const parsed = parseEngagementGeometry(item.geometry);
      expect(parsed.ok, `geometry for ${item.id} should validate`).toBe(true);
    }
  });

  it("stores the representative point of each geometry into latitude/longitude", () => {
    for (const item of DEMO_ENGAGEMENT_ITEMS) {
      const parsed = parseEngagementGeometry(item.geometry);
      if (!parsed.ok) throw new Error(`invalid geometry for ${item.id}`);
      const representative = computeEngagementGeometryRepresentativePoint(parsed.geometry);
      expect(item.latitude).toBeCloseTo(representative.latitude, 8);
      expect(item.longitude).toBeCloseTo(representative.longitude, 8);
    }
  });

  it("keeps every representative point inside the authored Grass Valley area envelope", () => {
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
      DEMO_ENGAGEMENT_ITEM_SR49_SHOULDER_LINE_ID,
      DEMO_ENGAGEMENT_ITEM_BENNETT_SIDEWALK_LINE_ID,
      DEMO_ENGAGEMENT_ITEM_DOWNTOWN_CALM_AREA_ID,
    ]);
    expect(new Set(DEMO_ENGAGEMENT_ITEMS.map((item) => item.id)).size).toBe(7);
  });

  it("spreads support votes across seeded items with unique deterministic rows", () => {
    expect(DEMO_ENGAGEMENT_ITEM_VOTES.length).toBeGreaterThan(0);

    const itemIds = new Set(DEMO_ENGAGEMENT_ITEMS.map((item) => item.id));
    for (const vote of DEMO_ENGAGEMENT_ITEM_VOTES) {
      expect(itemIds.has(vote.item_id), `vote ${vote.id} must reference a seeded item`).toBe(true);
      expect(vote.voter_fingerprint.trim().length).toBeGreaterThan(0);
    }

    // Vote ids are unique (idempotent upsert key).
    expect(new Set(DEMO_ENGAGEMENT_ITEM_VOTES.map((vote) => vote.id)).size).toBe(
      DEMO_ENGAGEMENT_ITEM_VOTES.length
    );

    // The (item, fingerprint) pairs are unique — they must not collide with
    // the UNIQUE(item_id, voter_fingerprint) constraint on re-seed.
    const pairs = DEMO_ENGAGEMENT_ITEM_VOTES.map((vote) => `${vote.item_id}|${vote.voter_fingerprint}`);
    expect(new Set(pairs).size).toBe(pairs.length);

    // Votes cover multiple items so the "Most supported" sort is meaningful.
    expect(new Set(DEMO_ENGAGEMENT_ITEM_VOTES.map((vote) => vote.item_id)).size).toBeGreaterThanOrEqual(5);
  });
});

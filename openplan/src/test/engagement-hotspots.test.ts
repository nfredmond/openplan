import { describe, expect, it, vi } from "vitest";

import {
  classifyHotspots,
  hotspotsToFeatureCollection,
  inverseStandardNormalCdf,
  loadSentimentHotspots,
  negativeItemIdsFromSyntheses,
  upperTailCriticalZ,
  HOTSPOT_SCREENING_CAVEAT,
  type RawHotspotCluster,
} from "@/lib/engagement/hotspots";
import type { EngagementSynthesis } from "@/lib/engagement/ai-synthesis";

const POLY = '{"type":"Polygon","coordinates":[[[-121.03,39.24],[-121.02,39.24],[-121.02,39.25],[-121.03,39.24]]]}';

function raw(overrides: Partial<RawHotspotCluster>): RawHotspotCluster {
  return {
    cluster_id: 0,
    n_items: 40,
    n_negative: 16,
    cluster_negative_share: 0.4,
    global_negative_share: 0.4,
    z_score: 0,
    centroid_lng: -121.03,
    centroid_lat: 39.24,
    footprint_geojson: POLY,
    item_ids: ["a", "b"],
    ...overrides,
  };
}

describe("inverse normal / critical z", () => {
  it("recovers the standard critical values", () => {
    expect(inverseStandardNormalCdf(0.5)).toBeCloseTo(0, 6);
    expect(upperTailCriticalZ(0.05)).toBeCloseTo(1.6449, 3);
    expect(upperTailCriticalZ(0.025)).toBeCloseTo(1.96, 3);
    expect(upperTailCriticalZ(0.005)).toBeCloseTo(2.5758, 3);
  });

  it("is monotonic — a smaller tail needs a larger z", () => {
    expect(upperTailCriticalZ(0.01)).toBeGreaterThan(upperTailCriticalZ(0.05));
  });
});

describe("classifyHotspots", () => {
  const rows: RawHotspotCluster[] = [
    raw({ cluster_id: 0, n_items: 40, n_negative: 30, cluster_negative_share: 0.75, z_score: 4.52 }),
    raw({ cluster_id: 1, n_items: 30, n_negative: 6, cluster_negative_share: 0.2, z_score: -2.236 }),
    raw({ cluster_id: 2, n_items: 25, n_negative: 11, cluster_negative_share: 0.44, z_score: 0.408 }),
  ];

  it("flags only clusters above the Bonferroni-adjusted critical z, one-sided", () => {
    const analysis = classifyHotspots(rows, { alpha: 0.05, sentimentAvailable: true });
    expect(analysis.globalNegativeSharePct).toBe(40);
    expect(analysis.testedCount).toBe(3); // all clear the expected-count gate (n*0.4 >= 5)
    // Bonferroni over 3 tests → alpha 0.05/3 → z* ≈ 2.128 (> the naive 1.645).
    expect(analysis.zCritical).toBeCloseTo(2.128, 2);
    expect(analysis.zCritical as number).toBeGreaterThan(upperTailCriticalZ(0.05));
    expect(analysis.significantCount).toBe(1);
    // sorted z desc: cluster 0 (4.52) first, cluster 1 (-2.236) last
    expect(analysis.clusters.map((c) => c.clusterId)).toEqual([0, 2, 1]);
    const top = analysis.clusters[0];
    expect(top.significant).toBe(true);
    expect(top.clusterNegativeSharePct).toBe(75);
    // the negative-z ("cold") cluster is never flagged — we only flag elevated negativity
    expect(analysis.clusters.find((c) => c.clusterId === 1)?.significant).toBe(false);
    expect(analysis.caveat).toBe(HOTSPOT_SCREENING_CAVEAT);
  });

  it("gates out small clusters where the normal approximation is invalid (n*P < 5)", () => {
    // n=8, baseline 0.389 → expected negatives 3.1 < 5 → not testable, never significant
    const small = [raw({ cluster_id: 9, n_items: 8, n_negative: 8, cluster_negative_share: 1, global_negative_share: 0.389, z_score: 9.9 })];
    const analysis = classifyHotspots(small, { sentimentAvailable: true });
    expect(analysis.testedCount).toBe(0);
    expect(analysis.zCritical).toBeNull();
    expect(analysis.significantCount).toBe(0);
    expect(analysis.clusters[0].testable).toBe(false);
    expect(analysis.clusters[0].significant).toBe(false);
    // z is still surfaced for transparency
    expect(analysis.clusters[0].zScore).toBe(9.9);
  });

  it("gates out high-baseline clusters failing the second-cell rule (n*(1-P) < 5)", () => {
    // baseline P=0.8 → n=20 passes n*P=16>=5 but fails n*(1-P)=4<5; the normal
    // approximation over-flags here (exact binomial upper tail is not <0.05).
    const highBaseline = [
      raw({ cluster_id: 7, n_items: 20, n_negative: 19, cluster_negative_share: 0.95, global_negative_share: 0.8, z_score: 1.68 }),
    ];
    const analysis = classifyHotspots(highBaseline, { sentimentAvailable: true });
    expect(analysis.testedCount).toBe(0);
    expect(analysis.significantCount).toBe(0);
    expect(analysis.clusters[0].testable).toBe(false);
  });

  it("tightens the threshold as more clusters are tested (multiple comparisons)", () => {
    const one = classifyHotspots([rows[0]], { sentimentAvailable: true });
    const three = classifyHotspots(rows, { sentimentAvailable: true });
    expect(one.zCritical).toBeCloseTo(1.6449, 2); // single test → no penalty
    expect(three.zCritical as number).toBeGreaterThan(one.zCritical as number);
  });

  it("suppresses shares and significance when sentiment is unavailable", () => {
    const noSentiment = [raw({ z_score: null, cluster_negative_share: 0, global_negative_share: 0, n_negative: 0 })];
    const analysis = classifyHotspots(noSentiment, { sentimentAvailable: false });
    expect(analysis.sentimentAvailable).toBe(false);
    expect(analysis.globalNegativeSharePct).toBeNull();
    expect(analysis.clusters[0].clusterNegativeSharePct).toBeNull();
    expect(analysis.clusters[0].significant).toBe(false);
    expect(analysis.testedCount).toBe(0);
  });

  it("coerces string-typed bigint columns", () => {
    const stringy = [raw({ cluster_id: "3", n_items: "40", n_negative: "30", z_score: "4.52" })];
    const analysis = classifyHotspots(stringy, { sentimentAvailable: true });
    expect(analysis.clusters[0].clusterId).toBe(3);
    expect(analysis.clusters[0].nItems).toBe(40);
    expect(analysis.clusters[0].zScore).toBe(4.52);
  });
});

describe("hotspotsToFeatureCollection", () => {
  it("emits one feature per parseable footprint and drops the rest", () => {
    const analysis = classifyHotspots(
      [
        raw({ cluster_id: 0, z_score: 4.52, n_items: 40, n_negative: 30, cluster_negative_share: 0.75 }),
        raw({ cluster_id: 1, footprint_geojson: null }),
        raw({ cluster_id: 2, footprint_geojson: "not json" }),
      ],
      { sentimentAvailable: true }
    );
    const fc = hotspotsToFeatureCollection(analysis.clusters);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.type).toBe("Polygon");
    expect(fc.features[0].properties.clusterId).toBe(0);
    expect(fc.features[0].properties.significant).toBe(true); // z=4.52 > Bonferroni z* over the 3 tested clusters
  });
});

describe("negativeItemIdsFromSyntheses", () => {
  it("pulls only item ids from negative themes", () => {
    const synthesis = {
      themes: [
        { label: "Traffic", sentiment: "negative", item_count: 2, fact_ids: ["item_a", "item_b"], summary: "" },
        { label: "Parks", sentiment: "positive", item_count: 1, fact_ids: ["item_c"], summary: "" },
        { label: "Mixed", sentiment: "mixed", item_count: 1, fact_ids: ["item_d"], summary: "" },
      ],
    } as unknown as EngagementSynthesis;
    expect(negativeItemIdsFromSyntheses([synthesis, null]).sort()).toEqual(["a", "b"]);
  });
});

describe("loadSentimentHotspots", () => {
  it("calls the RPC with scoped params and classifies the rows", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [raw({ cluster_id: 0, n_items: 40, n_negative: 30, cluster_negative_share: 0.75, z_score: 4.52 })],
      error: null,
    });
    const { analysis, error } = await loadSentimentHotspots({ rpc }, {
      workspaceId: "ws-1",
      campaignId: "camp-1",
      negativeItemIds: ["a", "b", "c"],
    });
    expect(error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("engagement_sentiment_hotspots", {
      p_workspace_id: "ws-1",
      p_eps_meters: 250,
      p_min_points: 5,
      p_negative_item_ids: ["a", "b", "c"],
      p_campaign_id: "camp-1",
    });
    expect(analysis.clusterCount).toBe(1);
    expect(analysis.sentimentAvailable).toBe(true);
  });

  it("returns an empty analysis and the message on RPC error", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    const { analysis, error } = await loadSentimentHotspots({ rpc }, {
      workspaceId: "ws-1",
      negativeItemIds: [],
    });
    expect(error).toBe("boom");
    expect(analysis.clusters).toEqual([]);
    expect(analysis.sentimentAvailable).toBe(false);
    expect(analysis.caveat).toBe(HOTSPOT_SCREENING_CAVEAT);
  });
});

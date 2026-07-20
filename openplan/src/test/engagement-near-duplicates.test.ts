import { describe, expect, it, vi } from "vitest";

import {
  NEAR_DUPLICATE_CAVEAT,
  groupNearDuplicates,
  loadNearDuplicates,
  type NearDuplicatePair,
} from "@/lib/engagement/near-duplicates";

describe("groupNearDuplicates", () => {
  it("merges transitive pairs into one connected group with the max similarity", () => {
    const pairs: NearDuplicatePair[] = [
      { item_a: "a", item_b: "b", similarity: 0.9 },
      { item_a: "b", item_b: "c", similarity: 0.7 },
    ];
    const groups = groupNearDuplicates(pairs);
    expect(groups).toHaveLength(1);
    expect(groups[0].itemIds).toEqual(["a", "b", "c"]);
    expect(groups[0].maxSimilarity).toBe(0.9);
  });

  it("keeps disconnected pairs as separate groups", () => {
    const groups = groupNearDuplicates([
      { item_a: "a", item_b: "b", similarity: 0.8 },
      { item_a: "c", item_b: "d", similarity: 0.6 },
    ]);
    expect(groups).toHaveLength(2);
    // sorted by size then similarity → the 0.8 group first
    expect(groups[0].itemIds).toEqual(["a", "b"]);
  });

  it("coerces string similarities and handles no pairs", () => {
    expect(groupNearDuplicates([])).toEqual([]);
    const groups = groupNearDuplicates([{ item_a: "x", item_b: "y", similarity: "0.75" }]);
    expect(groups[0].maxSimilarity).toBe(0.75);
  });
});

describe("loadNearDuplicates", () => {
  it("calls the RPC with a clamped threshold and groups the pairs", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ item_a: "a", item_b: "b", similarity: 0.9 }],
      error: null,
    });
    const { analysis, error } = await loadNearDuplicates({ rpc }, { workspaceId: "ws-1", campaignId: "c-1", threshold: 0.1 });
    expect(error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("engagement_near_duplicate_pairs", {
      p_workspace_id: "ws-1",
      p_campaign_id: "c-1",
      p_threshold: 0.3, // clamped up from 0.1 to the pg_trgm floor
    });
    expect(analysis.groupCount).toBe(1);
    expect(analysis.itemCount).toBe(2);
    expect(analysis.caveat).toBe(NEAR_DUPLICATE_CAVEAT);
  });

  it("returns an empty analysis and the message on RPC error", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    const { analysis, error } = await loadNearDuplicates({ rpc }, { workspaceId: "ws-1" });
    expect(error).toBe("boom");
    expect(analysis.groups).toEqual([]);
  });
});

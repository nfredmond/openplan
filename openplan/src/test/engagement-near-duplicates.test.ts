import { describe, expect, it, vi } from "vitest";

import {
  NEAR_DUPLICATE_CAVEAT,
  NEAR_DUPLICATE_MAX_PAIRS,
  groupNearDuplicates,
  loadNearDuplicates,
  type NearDuplicatePair,
} from "@/lib/engagement/near-duplicates";
import { pagingFake } from "./helpers/paging-fake";

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

/** An RPC whose result pages like PostgREST: sliced by `.range`, at most 1,000 rows per response. */
function rpcClient(result: { data: unknown[] | null; error: { message: string } | null }) {
  const paging = pagingFake(() => result, { serverCap: 1000 });
  const rpc = vi.fn((..._args: unknown[]) => paging.chain);
  return { rpc, paging };
}

/** `count` distinct pairs, as the function returns them. */
function distinctPairs(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    item_a: `a-${String(i).padStart(5, "0")}`,
    item_b: `b-${String(i).padStart(5, "0")}`,
    similarity: 0.9,
  }));
}

describe("loadNearDuplicates", () => {
  it("calls the RPC with a clamped threshold and groups the pairs", async () => {
    const { rpc } = rpcClient({
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
    const { rpc } = rpcClient({ data: null, error: { message: "boom" } });
    const { analysis, error } = await loadNearDuplicates({ rpc }, { workspaceId: "ws-1" });
    expect(error).toBe("boom");
    expect(analysis.groups).toEqual([]);
  });

  /*
    PostgREST stops a function result at 1,000 rows with no error. The function
    may return 2,000 pairs, so an unpaged read lost up to half of them, and
    `truncated` (pairs >= 2,000) could never fire.
  */
  it("reads every pair past the 1,000-row cap, in a total order", async () => {
    const { rpc, paging } = rpcClient({ data: distinctPairs(1500), error: null });
    const { analysis, error } = await loadNearDuplicates({ rpc }, { workspaceId: "ws-1", campaignId: "c-1" });

    expect(error).toBeNull();
    expect(analysis.groupCount).toBe(1500);
    expect(analysis.truncated).toBe(false);
    const orders = paging.calls.filter(([method]) => method === "order").map(([, column]) => column);
    expect(orders.slice(0, 3)).toEqual(["similarity", "item_a", "item_b"]);
  });

  it("reports the scan as truncated when the function returns its full 2,000 pairs", async () => {
    const { rpc } = rpcClient({ data: distinctPairs(NEAR_DUPLICATE_MAX_PAIRS), error: null });
    const { analysis } = await loadNearDuplicates({ rpc }, { workspaceId: "ws-1", campaignId: "c-1" });

    expect(analysis.groupCount).toBe(NEAR_DUPLICATE_MAX_PAIRS);
    expect(analysis.truncated).toBe(true);
  });
});

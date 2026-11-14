import { describe, expect, it } from "vitest";

import {
  CAMPAIGN_ITEM_STATUS_COLUMNS,
  CAMPAIGN_ITEM_SUMMARY_COLUMNS,
  readEveryCampaignItem,
  type CampaignItemReadClient,
} from "@/lib/engagement/campaign-item-reads";
import { readEveryPageAsResult } from "@/lib/supabase/paged-read";
import { pagingFake } from "./helpers/paging-fake";

/**
 * THE SHARED READ BEHIND THE PLAN, PROGRAM, REPORT AND RTP COMMENT COUNTS.
 *
 * PostgREST stops a response at 1,000 rows with no error. The fake here holds
 * that cap on ranged and unranged reads, so a single request returns 1,000 of
 * 1,234 rows and the count assertions below fail for it.
 */

function clientFor(rows: unknown[]) {
  const paging = pagingFake(() => ({ data: rows, error: null }), { serverCap: 1000 });
  const tables: string[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      return paging.chain;
    },
  } as unknown as CampaignItemReadClient;
  return { client, paging, tables };
}

function items(count: number) {
  return Array.from({ length: count }, (_, i) => ({ campaign_id: i % 2 ? "c-1" : "c-2", status: "approved" }));
}

describe("readEveryCampaignItem", () => {
  it("returns every comment past the 1,000-row cap", async () => {
    const { client, paging, tables } = clientFor(items(1234));

    const result = await readEveryCampaignItem(client, ["c-1", "c-2"], CAMPAIGN_ITEM_STATUS_COLUMNS);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1234);
    expect(new Set(tables)).toEqual(new Set(["engagement_items"]));
    expect(paging.calls[0]).toEqual(["select", "campaign_id, status"]);
    expect(paging.calls).toContainEqual(["in", "campaign_id", ["c-1", "c-2"]]);
  });

  it("orders every page by created_at then id, before it ranges", async () => {
    const { client, paging } = clientFor(items(1234));

    await readEveryCampaignItem(client, ["c-1"], CAMPAIGN_ITEM_SUMMARY_COLUMNS);

    const firstRange = paging.calls.findIndex(([method]) => method === "range");
    const ordersBeforeRange = paging.calls
      .slice(0, firstRange)
      .filter(([method]) => method === "order")
      .map(([, column]) => column);
    expect(ordersBeforeRange).toEqual(["created_at", "id"]);
  });

  it("returns a read that fails part way as an error with no rows", async () => {
    const { client, paging } = clientFor(items(1234));
    paging.failPage(2, { message: "statement timeout", code: "57014" });

    const result = await readEveryCampaignItem(client, ["c-1"], CAMPAIGN_ITEM_STATUS_COLUMNS);

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ message: "statement timeout", code: "57014" });
  });

  it("answers no campaigns with no comments, without a request", async () => {
    const { client, tables } = clientFor(items(5));

    const result = await readEveryCampaignItem(client, [], CAMPAIGN_ITEM_STATUS_COLUMNS);

    expect(result).toEqual({ data: [], error: null });
    expect(tables).toEqual([]);
  });
});

describe("readEveryPageAsResult", () => {
  it("reports a read stopped by the page ceiling as an error, never as a prefix", async () => {
    const result = await readEveryPageAsResult(
      async (from, to) => ({ data: Array.from({ length: to - from + 1 }, (_, i) => from + i), error: null }),
      "could not finish",
      { pageSize: 10, maxPages: 3 }
    );

    expect(result).toEqual({ data: null, error: { message: "could not finish" } });
  });
});

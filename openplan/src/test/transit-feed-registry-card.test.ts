import { describe, expect, it } from "vitest";
import { describeTransitFeedRegistry, type TransitFeedRow } from "@/lib/transit/feed-registry-card";

/**
 * THE CARD THAT PROMISED A FEATURE THAT DOES NOT EXIST.
 *
 * The Data Hub shipped a constant reading "GTFS uploads — Transit feed storage
 * already exists in the current architecture and can fold into this registry",
 * rendered under "Visible system component" beside registries that are real.
 * Nine GTFS tables have existed since 20260219000001 and nothing in `src/`
 * reads or writes one of them: no upload route, no parser, no ingest worker.
 *
 * These assertions are about what may be SAID, which is why they are made on
 * the wording rather than only on the state code. A future refactor that keeps
 * the state and softens the sentence back into "storage already exists" would
 * reintroduce the defect with the tests green.
 */

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

/** Deterministic, so this file is locale-free. The page passes its own. */
const formatTimestamp = (value: string | null) => (value ? `at ${value}` : "never");

function feed(overrides: Partial<TransitFeedRow> = {}): TransitFeedRow {
  return {
    id: "feed-1",
    workspace_id: WORKSPACE_ID,
    agency_name: "Mountain Transit",
    status: "loaded",
    loaded_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function describe_(input: Partial<Parameters<typeof describeTransitFeedRegistry>[0]> = {}) {
  return describeTransitFeedRegistry({
    workspaceId: WORKSPACE_ID,
    readFailed: false,
    feeds: [],
    formatTimestamp,
    ...input,
  });
}

describe("describeTransitFeedRegistry", () => {
  it("says no feed has been ingested, and does not promise an upload that does not exist", () => {
    const card = describe_({ feeds: [] });

    expect(card.state).toBe("no-feed");
    expect(card.detail).toContain("No transit feed has been ingested for this workspace");
    // What a feed would unlock, stated as a conditional.
    expect(card.detail).toMatch(/would/i);

    // The exact claim that was on the page, and the family it belongs to. A
    // planner acted on this by going to look for an upload control.
    expect(card.detail).not.toMatch(/storage already exists/i);
    expect(card.detail).not.toMatch(/already exists/i);
    expect(card.detail).not.toMatch(/can fold into/i);
    // And it names the reason the state is empty, rather than leaving the
    // reader to conclude they configured something wrong.
    expect(card.detail).toMatch(/does not have a feed upload path yet/i);
  });

  it("declines to claim anything when the registry read failed", () => {
    const card = describe_({ readFailed: true, feeds: [feed()] });

    expect(card.state).toBe("read-failed");
    expect(card.tone).toBe("warning");
    // A failed question is not an answer of none — the collapse `data ?? []`
    // makes, which would have reported this workspace as having no feed.
    expect(card.detail).not.toContain("No transit feed has been ingested");
    expect(card.detail).toMatch(/could not be read/i);
    // And it must not describe the rows it was handed, either.
    expect(card.detail).not.toContain("Mountain Transit");
  });

  it("reports the agency, status and load time of a feed that is present", () => {
    const card = describe_({
      feeds: [feed({ agency_name: "Mountain Transit", status: "loaded", loaded_at: "2026-08-01T00:00:00.000Z" })],
    });

    expect(card.state).toBe("feed-present");
    expect(card.detail).toContain("Mountain Transit");
    expect(card.detail).toContain("loaded");
    expect(card.detail).toContain("at 2026-08-01T00:00:00.000Z");
    expect(card.tone).toBe("success");
  });

  it("does not present another workspace's feed, or a public one, as this workspace's own", () => {
    // `gtfs_feeds.workspace_id` is NULLABLE and a null means a PUBLIC preloaded
    // feed shared across deployments. If the caller's `.eq("workspace_id", …)`
    // were ever dropped, this workspace would be shown a stranger's agency
    // name under "no feed has been ingested"'s replacement — a false statement
    // about the agency's own data that nothing downstream could detect.
    const card = describe_({
      feeds: [
        feed({ id: "public-feed", workspace_id: null, agency_name: "Preloaded Metro" }),
        feed({ id: "other-feed", workspace_id: OTHER_WORKSPACE_ID, agency_name: "Somebody Else Transit" }),
      ],
    });

    expect(card.state).toBe("no-feed");
    expect(card.detail).not.toContain("Preloaded Metro");
    expect(card.detail).not.toContain("Somebody Else Transit");
  });

  it("says a registered feed is not loaded rather than inventing a load time", () => {
    const card = describe_({ feeds: [feed({ status: "pending", loaded_at: null })] });

    expect(card.state).toBe("feed-present");
    expect(card.detail).toContain("not loaded yet");
    expect(card.detail).not.toContain("never");
    expect(card.tone).toBe("info");
  });

  it("leads with the most recently loaded feed and counts the rest", () => {
    const card = describe_({
      feeds: [
        feed({ id: "a", agency_name: "Older Agency", loaded_at: "2026-01-01T00:00:00.000Z" }),
        feed({ id: "b", agency_name: "Newer Agency", loaded_at: "2026-08-01T00:00:00.000Z" }),
      ],
    });

    expect(card.detail.startsWith("Newer Agency")).toBe(true);
    expect(card.detail).toContain("1 other feed is registered");
  });

  it("passes an unrecognised status through instead of inventing a vocabulary", () => {
    // `gtfs_feeds.status` is unconstrained TEXT with no CHECK, so a value this
    // module does not know is a value the database will happily store.
    const card = describe_({ feeds: [feed({ status: "partially_ingested" })] });

    expect(card.detail).toContain("partially_ingested");
    expect(card.tone).toBe("neutral");
  });
});

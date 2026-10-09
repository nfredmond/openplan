import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { failGtfsFeedVersion } from "@/lib/gtfs/persist";

// Response custody only; SQL rejection has separate native evidence.
function fixture(version: "ok" | "error" | "empty", feed: "ok" | "error" | "empty") {
  let feedWrites = 0;
  const service = createClient("http://127.0.0.1:1", "synthetic-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)); const method = init?.method ?? "GET";
      if (method === "DELETE") {
        expect(url.searchParams.get("feed_version_id")).toBe("eq.version");
        expect(url.searchParams.get("select")).toBe("id");
        return new Response("[]", { status: 200 });
      }
      if (method === "GET") {
        expect(url.pathname).toBe("/rest/v1/gtfs_feeds");
        expect(url.searchParams.get("select")).toBe("id,current_version_id");
        expect(url.searchParams.get("id")).toBe("eq.feed");
        return new Response(JSON.stringify([{ id: "feed", current_version_id: null }]), { status: 200 });
      }
      expect(method).toBe("PATCH");
      const isVersion = url.pathname === "/rest/v1/gtfs_feed_versions";
      if (!isVersion) { expect(url.pathname).toBe("/rest/v1/gtfs_feeds"); feedWrites++; }
      expect(url.searchParams.get("id")).toBe(isVersion ? "eq.version" : "eq.feed");
      expect(url.searchParams.get("select")).toBe("id");
      const outcome = isVersion ? version : feed;
      return new Response(JSON.stringify(outcome === "error" ? { code: "55000", message: "write refused" } : outcome === "empty" ? [] : [{ id: isVersion ? "version" : "feed" }]), { status: outcome === "error" ? 500 : 200 });
    } },
  });
  return { service, feedWrites: () => feedWrites };
}
describe("GTFS failure write receipts", () => {
  it.each(["error", "empty"] as const)("does not claim a %s version update was recorded", async version => {
    const f = fixture(version, "ok");
    expect(await failGtfsFeedVersion({ service: f.service, versionId: "version", feedId: "feed", code: "partial_write", detail: "test" })).toEqual({ recorded: false, feedStatusChanged: false });
    expect(f.feedWrites()).toBe(0);
  });
  it.each(["error", "empty", "ok"] as const)("reports the actual %s feed update outcome", async feed => {
    const f = fixture("ok", feed);
    expect(await failGtfsFeedVersion({ service: f.service, versionId: "version", feedId: "feed", code: "partial_write", detail: "test" })).toEqual({ recorded: true, feedStatusChanged: feed === "ok" });
    expect(f.feedWrites()).toBe(1);
  });
});

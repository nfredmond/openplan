import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { reapAbandonedGtfsIngests } from "@/lib/gtfs/persist";

// HTTP projection and response handling; native controls cover SQL locking separately.
function fixture(result: unknown, status = 200) {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const client = createClient("http://127.0.0.1:1", "synthetic-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      calls.push({ path: url.pathname, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (method === "GET") {
        expect(url.searchParams.get("select")).toBe("id,feed_id,storage_path,status,updated_at");
        expect(url.searchParams.get("status")).toBe("in.(pending,fetching,parsing)");
        expect(url.searchParams.get("updated_at")).toBe("lt.2026-10-09T11:45:00.000Z");
        return new Response(JSON.stringify([{ id: "version", feed_id: "feed", storage_path: "private/feed.zip" }]), { status: 200 });
      }
      if (url.pathname === "/rest/v1/rpc/reap_gtfs_feed_version") return new Response(JSON.stringify(result), { status });
      if (url.pathname === "/storage/v1/object/gtfs-uploads") return new Response("[]", { status: 200 });
      throw new Error(`Unexpected write ${method} ${url.pathname}`);
    } },
  });
  return { client, calls };
}
const now = Date.parse("2026-10-09T12:00:00Z");
describe("atomic GTFS stale cleanup", () => {
  it("removes private bytes only after confirmed cleanup", async () => {
    const { client, calls } = fixture(true);
    expect(await reapAbandonedGtfsIngests(client, now)).toEqual({ scanned: 1, reaped: ["version"] });
    expect(calls[1]).toEqual({ path: "/rest/v1/rpc/reap_gtfs_feed_version", method: "POST", body: {
      p_version_id: "version", p_cutoff: "2026-10-09T11:45:00.000Z",
    } });
    expect(calls[2].path).toBe("/storage/v1/object/gtfs-uploads");
    expect(calls).toHaveLength(3);
  });
  it("preserves a version that no longer qualifies", async () => {
    const { client, calls } = fixture(false);
    expect(await reapAbandonedGtfsIngests(client, now)).toEqual({ scanned: 1, reaped: [] });
    expect(calls).toHaveLength(2);
  });
  it.each([null, {}, "true", 1])("rejects malformed result %j without removing bytes", async result => {
    const { client, calls } = fixture(result);
    await expect(reapAbandonedGtfsIngests(client, now)).rejects.toThrow("invalid cleanup result");
    expect(calls).toHaveLength(2);
  });
  it("surfaces a failed transaction without removing bytes", async () => {
    const { client, calls } = fixture({ code: "55000", message: "transaction refused" }, 400);
    await expect(reapAbandonedGtfsIngests(client, now)).rejects.toThrow("transaction refused");
    expect(calls).toHaveLength(2);
  });
});

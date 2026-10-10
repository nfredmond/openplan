import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runGtfsIngest } from "@/lib/gtfs/ingest";
import { failGtfsFeedVersion, markGtfsFeedVersionStage, writeParsedFeedVersion } from "@/lib/gtfs/persist";
import { parseGtfsFeed } from "@/lib/gtfs/parse";

vi.mock("@/lib/gtfs/persist", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/gtfs/persist")>(),
  beginGtfsFeedVersion: vi.fn(async () => ({ ok: true, feedId: "feed", versionId: "version", createdFeed: true })),
  failGtfsFeedVersion: vi.fn(async () => ({ recorded: false, feedStatusChanged: false })),
  writeParsedFeedVersion: vi.fn(),
}));
vi.mock("@/lib/gtfs/parse", () => ({ parseGtfsFeed: vi.fn(async () => ({ ok: false, code: "not_a_zip", detail: "parser reached" })) }));

// Native controls prove the fence. This fixture tests stopping work after its HTTP refusal.
function clientFor(stage: "fetching" | "parsing" | "object", missing = false) {
  const calls: Array<{ method: string; path: string; payload: Record<string, unknown> }> = [];
  const client = createClient("http://127.0.0.1:1", "synthetic-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      if (method === "PATCH") {
        expect(url.pathname).toBe("/rest/v1/gtfs_feed_versions");
        expect(url.searchParams.get("id")).toBe("eq.version");
        expect(url.searchParams.get("select")).toBe("id");
        const payload = JSON.parse(String(init?.body));
        calls.push({ method, path: url.pathname, payload });
        if (payload.status === stage || (stage === "object" && payload.storage_path)) {
          return new Response(JSON.stringify(missing ? null : { code: "55000", message: "GTFS ingest was abandoned" }), { status: missing ? 200 : 400 });
        }
        return new Response(JSON.stringify({ id: "version" }), { status: 200 });
      }
      expect(method).toBe("POST");
      expect(url.pathname).toContain("/storage/v1/object/gtfs-uploads/");
      calls.push({ method, path: url.pathname, payload: {} });
      return new Response(JSON.stringify({ Key: "synthetic.zip" }), { status: 200 });
    } },
  });
  return { client, calls };
}

beforeEach(() => vi.clearAllMocks());
describe("closed GTFS attempts stop before parsing", () => {
  it.each(["fetching", "parsing", "object"] as const)("stops at an unconfirmed %s write", async stage => {
    const { client, calls } = clientFor(stage);
    const result = await runGtfsIngest({ service: client, workspaceId: "workspace", requestedBy: null, provisionalName: "Synthetic feed", source: { kind: "upload", bytes: new Uint8Array([1, 2]), contentType: "application/zip", filename: "synthetic.zip" } });
    expect(result).toMatchObject({ ok: false, code: "partial_write", versionId: "version" });
    expect(parseGtfsFeed).not.toHaveBeenCalled();
    expect(writeParsedFeedVersion).not.toHaveBeenCalled();
    expect(failGtfsFeedVersion).toHaveBeenCalledOnce();
    const failure = vi.mocked(failGtfsFeedVersion).mock.calls[0][0];
    expect(failure.storagePath === null).toBe(stage === "fetching");
    expect(calls.filter(call => call.method === "POST")).toHaveLength(stage === "fetching" ? 0 : 1);
  });
  it("does not report a database refusal as confirmed progress", async () => {
    const { client } = clientFor("fetching");
    expect(await markGtfsFeedVersionStage(client, "version", "fetching")).toBe(false);
  });
  it("does not report a missing row as confirmed progress", async () => {
    const { client } = clientFor("fetching", true);
    expect(await markGtfsFeedVersionStage(client, "version", "fetching")).toBe(false);
  });
});

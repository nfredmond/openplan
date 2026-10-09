import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { failGtfsFeedVersion } from "@/lib/gtfs/persist";

// RPC argument and receipt handling only; separate native checks cover SQL effects.
async function close(result: unknown, status = 200) {
  let calls = 0;
  const service = createClient("http://127.0.0.1:1", "synthetic-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      calls++;
      expect(new URL(String(input)).pathname).toBe("/rest/v1/rpc/close_failed_gtfs_version");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ p_version_id: "version", p_code: "partial_write", p_detail: "interrupted", p_storage_path: "workspace/feed/version.zip" });
      return new Response(JSON.stringify(result), { status });
    } },
  });
  const receipt = await failGtfsFeedVersion({ service, versionId: "version", feedId: "feed", code: "partial_write", detail: "interrupted", storagePath: "workspace/feed/version.zip" });
  expect(calls).toBe(1);
  return receipt;
}
describe("GTFS atomic failure receipts", () => {
  it.each([{ recorded: true, feedStatusChanged: true }, { recorded: true, feedStatusChanged: false }, { recorded: false, feedStatusChanged: false }])("returns the confirmed receipt %j", async result => {
    expect(await close(result)).toEqual(result);
  });
  it("does not claim a rejected transaction was recorded", async () => {
    expect(await close({ message: "write refused" }, 500)).toEqual({ recorded: false, feedStatusChanged: false });
  });
  it.each([null, [], {}, { recorded: "true", feedStatusChanged: false }, { recorded: false, feedStatusChanged: true }])("refuses malformed receipt %j", async result => {
    expect(await close(result)).toEqual({ recorded: false, feedStatusChanged: false });
  });
});

// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { readGtfsSubmissionStatus } from "@/lib/gtfs/managed-worker-service";
const id = (n: number) => `eb000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { workspaceId: id(1), requestId: id(2), actorId: id(3) };
const status = { schemaVersion: 1, requestId: id(2), versionId: id(4), feedId: id(5), workspaceId: id(1), state: "queued", stage: "pending", attempts: 0,
  leaseUntil: null, archiveConfirmed: false, submittedAt: "2026-10-10T12:00:00Z", isCurrent: false, failureCode: null, failureDetail: null, submitterAccessUnavailable: false };
function fixture(raw: unknown) {
 const transport = vi.fn<typeof fetch>(async () => Response.json(raw));
 const service = createClient("http://127.0.0.1:54321", "synthetic-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport } });
 return { transport, run: (value = scope, signal = new AbortController().signal) => readGtfsSubmissionStatus(service, value, signal) };
}
describe("GTFS submission status custody", () => {
 it("sends the exact authenticated request and workspace scope", async () => {
  const f = fixture(status); expect(await f.run()).toEqual(status);
  expect(String(f.transport.mock.calls[0][0])).toBe("http://127.0.0.1:54321/rest/v1/rpc/read_gtfs_submission_status");
  expect(JSON.parse(String(f.transport.mock.calls[0][1]?.body))).toEqual({ p_workspace: id(1), p_request: id(2), p_actor: id(3) });
 });
 it("keeps an uncommitted submission unconfirmed", async () => { expect(await fixture(null).run()).toBeNull(); });
 it.each(["workspaceId", "requestId"] as const)("refuses a reply for another %s", async field => { await expect(fixture({ ...status, [field]: id(9) }).run()).rejects.toThrow(); });
 it("refuses private worker fields in a public status reply", async () => { await expect(fixture({ ...status, token: id(9) }).run()).rejects.toThrow(); });
 it("refuses inconsistent lifecycle evidence", async () => { await expect(fixture({ ...status, state: "running" }).run()).rejects.toThrow("running lease missing"); });
 it.each(["workspaceId", "requestId", "actorId"] as const)("refuses invalid %s before transport", async field => {
  const f = fixture(status); await expect(f.run({ ...scope, [field]: "invalid" })).rejects.toThrow(); expect(f.transport).not.toHaveBeenCalled();
 });
 it("stops a pre-cancelled status read before transport", async () => { const f = fixture(status), stopping = new AbortController(); stopping.abort(); await expect(f.run(scope, stopping.signal)).rejects.toThrow(); expect(f.transport).not.toHaveBeenCalled(); });
});

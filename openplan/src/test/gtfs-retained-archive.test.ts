// @vitest-environment node
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { readRetainedGtfsArchive, type RetainedGtfsArchive } from "@/lib/gtfs/retained-archive";

const bytes = new Uint8Array([80, 75, 3, 4, 1, 2]);
const identity: RetainedGtfsArchive = {
  workspaceId: "10000000-0000-0000-0000-000000000001",
  feedId: "20000000-0000-0000-0000-000000000002",
  versionId: "30000000-0000-0000-0000-000000000003",
  storagePath: "10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000002/30000000-0000-0000-0000-000000000003.zip",
  byteSize: bytes.length,
  checksumSha256: createHash("sha256").update(bytes).digest("hex"),
};
function client(response: () => Response | Promise<Response>) {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response());
  const service = createClient("http://127.0.0.1:54321", "synthetic-test-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher },
  });
  return { service, fetcher };
}
describe("retained GTFS archive", () => {
  it("reads the exact private object through the installed streaming SDK", async () => {
    const { service, fetcher } = client(() => new Response(bytes));
    expect(await readRetainedGtfsArchive(service, identity)).toEqual({ ok: true, bytes, checksumSha256: identity.checksumSha256 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(`/storage/v1/object/gtfs-uploads/${identity.storagePath}`);
  });
  it.each(["../other.zip", "other/version.zip", null])("refuses a mismatched path before I/O: %s", async (storagePath) => {
    const { service, fetcher } = client(() => new Response(bytes));
    expect(await readRetainedGtfsArchive(service, { ...identity, storagePath })).toEqual({ ok: false, code: "invalid_identity" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses declared oversize before I/O", async () => {
    const { service, fetcher } = client(() => new Response(bytes));
    expect(await readRetainedGtfsArchive(service, identity, { env: { OPENPLAN_GTFS_MAX_ARCHIVE_BYTES: "5" } })).toEqual({ ok: false, code: "archive_too_large" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([new Uint8Array([1, 2, 3, 4, 5, 6]), bytes.slice(0, 2), new Uint8Array(7)])("refuses altered, truncated or oversized bytes", async (body) => {
    const { service } = client(() => new Response(body));
    expect(await readRetainedGtfsArchive(service, identity)).toEqual({ ok: false, code: "archive_mismatch" });
  });
  it("reports unavailable storage without refetching a publisher URL", async () => {
    const { service, fetcher } = client(() => new Response('{"message":"not found","statusCode":"404"}', { status: 404 }));
    expect(await readRetainedGtfsArchive(service, identity)).toEqual({ ok: false, code: "archive_unavailable" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("cancels a stalled stream", async () => {
    const abort = new AbortController();
    const cancelled = vi.fn();
    const { service } = client(() => new Response(new ReadableStream({ cancel: cancelled })));
    const pending = readRetainedGtfsArchive(service, identity, { signal: abort.signal });
    setTimeout(() => abort.abort(), 10);
    expect(await pending).toEqual({ ok: false, code: "cancelled" });
    expect(cancelled).toHaveBeenCalled();
  });
  it("times out a stalled body independently of transport cancellation", async () => {
    const { service } = client(() => new Response(new ReadableStream()));
    expect(await readRetainedGtfsArchive(service, identity, { env: { OPENPLAN_GTFS_PARSE_BUDGET_MS: "10" } })).toEqual({ ok: false, code: "timed_out" });
  });
});

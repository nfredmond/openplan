// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { listGtfsCandidates } from "@/lib/gtfs/managed-worker-service";
const id = "ed000000-0000-4000-8000-000000000001";
function fixture(rows: unknown) {
  const transport = vi.fn<typeof fetch>(async () => Response.json(rows));
  const service = createClient("http://127.0.0.1:54321", "synthetic-key", { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: transport } });
  return { service, transport };
}
describe("GTFS candidate cursor", () => {
  it.each([null, id])("passes the exact native scan cursor %s", async cursor => {
    const f = fixture([{ version_id: id }]);
    expect(await listGtfsCandidates(f.service, 1, new AbortController().signal, cursor)).toEqual([id]);
    expect(String(f.transport.mock.calls[0][0])).toBe("http://127.0.0.1:54321/rest/v1/rpc/scan_gtfs_ingest_candidates");
    expect(JSON.parse(String(f.transport.mock.calls[0][1]?.body))).toEqual({ p_limit: 1, p_after: cursor });
  });
  it("refuses invalid cursor identity before transport", async () => {
    const f = fixture([]); await expect(listGtfsCandidates(f.service, 1, new AbortController().signal, "invalid")).rejects.toThrow();
    expect(f.transport).not.toHaveBeenCalled();
  });
  it.each([0, 101])("refuses scan limit %s before transport", async limit => {
    const f = fixture([]); await expect(listGtfsCandidates(f.service, limit, new AbortController().signal, null)).rejects.toThrow();
    expect(f.transport).not.toHaveBeenCalled();
  });
  it.each([{ rows: [{ version_id: id }, { version_id: id }] }, { rows: [{ version_id: id }, { version_id: "ed000000-0000-4000-8000-000000000002" }] }, { rows: [{ version_id: "invalid" }] }, { rows: [{ version_id: id, token: id }] }])("refuses inconsistent scan reply %j", async ({ rows }) => {
    const f = fixture(rows); await expect(listGtfsCandidates(f.service, 1, new AbortController().signal, null)).rejects.toThrow();
  });
});

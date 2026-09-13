import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadResponseHistory } from "@/lib/engagement/response-history-server";

const campaignId = "10000000-0000-4000-8000-000000000001";
const responseId = "20000000-0000-4000-8000-000000000001";
function revision(number = 1, event = "created") {
  const record = { id: responseId, campaign_id: campaignId, category_id: null, theme_title: "Crossings",
    you_said: "Original words é", we_did: number === 1 ? "Original answer" : "Corrected answer", status: "draft", ai_assisted: false,
    source_item_ids: [], sort_order: 0, published_at: null, created_at: "2026-09-12T00:00:00Z", updated_at: "2026-09-12T00:00:00Z" };
  // Spaces deliberately differ from JSON.stringify: the verifier must hash returned text.
  const record_text = JSON.stringify(record, null, 1);
  return { id: randomUUID(), campaign_id: campaignId, response_id: responseId, revision: number,
    actor_id: null, recorded_at: "2026-09-12T00:00:00+00:00", event, record_text,
    record_sha256: createHash("sha256").update(record_text).digest("hex") };
}
function snapshot(entries = [revision()]) { return { campaignId, count: entries.length, entries }; }
async function read(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  const result = await loadResponseHistory({ rpc } as never, campaignId);
  expect(rpc).toHaveBeenCalledWith("read_engagement_response_history", { p_campaign: campaignId });
  return result;
}

describe("private response history verification", () => {
  it("retains original, correction and removed copies without a current-row query", async () => {
    const result = await read(snapshot([revision(), revision(2, "corrected"), revision(3, "removed")]));
    expect(result.error).toBeNull();
    expect(result.rows.map(row => row.record.we_did)).toEqual(["Original answer", "Corrected answer", "Corrected answer"]);
    expect(result.rows[2].event).toBe("removed");
  });
  it("accepts a truthful legacy baseline and a healthy empty snapshot", async () => {
    expect((await read(snapshot([revision(1, "legacy_baseline")]))).error).toBeNull();
    expect(await read(snapshot([]))).toEqual({ rows: [], error: null });
  });
  it("reads beyond 1000 revisions", async () => {
    const entries = Array.from({ length: 1005 }, (_, n) => revision(n + 1, n ? "corrected" : "created"));
    expect((await read(snapshot(entries))).rows).toHaveLength(1005);
  });
  it.each([
    ["checksum corruption", (s: ReturnType<typeof snapshot>) => { s.entries[0].record_sha256 = "a".repeat(64); }],
    ["count mismatch", (s: ReturnType<typeof snapshot>) => { s.count++; }],
    ["foreign envelope", (s: ReturnType<typeof snapshot>) => { s.campaignId = randomUUID(); }],
    ["foreign row", (s: ReturnType<typeof snapshot>) => { s.entries[0].campaign_id = randomUUID(); }],
    ["foreign retained response", (s: ReturnType<typeof snapshot>) => { s.entries[0].response_id = randomUUID(); }],
    ["missing baseline", (s: ReturnType<typeof snapshot>) => { s.entries[0].revision = 2; }],
    ["wrong initial event", (s: ReturnType<typeof snapshot>) => { s.entries[0].event = "corrected"; }],
    ["duplicate row", (s: ReturnType<typeof snapshot>) => { s.entries.push(s.entries[0]); s.count++; }],
    ["duplicate identity with valid revisions", (s: ReturnType<typeof snapshot>) => { s.entries.push({ ...revision(2, "corrected"), id: s.entries[0].id }); s.count++; }],
    ["foreign retained campaign", (s: ReturnType<typeof snapshot>) => {
      const entry = s.entries[0];
      const record = JSON.parse(entry.record_text); record.campaign_id = responseId;
      entry.record_text = JSON.stringify(record); entry.record_sha256 = createHash("sha256").update(entry.record_text).digest("hex");
    }],
    ["revision gap", (s: ReturnType<typeof snapshot>) => { s.entries.push(revision(3, "corrected")); s.count++; }],
    ["identity reused after removal", (s: ReturnType<typeof snapshot>) => { s.entries.push(revision(2, "removed"), revision(3, "corrected")); s.count += 2; }],
  ])("rejects all rows on %s", async (_name, corrupt) => {
    const data = snapshot(); corrupt(data);
    const result = await read(data);
    expect(result.rows).toEqual([]);
    expect(result.error?.message).toContain("could not be read and verified completely");
  });
  it("keeps database and transport failures distinct from empty history", async () => {
    for (const rpc of [vi.fn().mockResolvedValue({ data: null, error: { message: "offline" } }), vi.fn().mockRejectedValue(new Error("interrupted"))]) {
      expect((await loadResponseHistory({ rpc } as never, campaignId)).error).not.toBeNull();
    }
  });
});

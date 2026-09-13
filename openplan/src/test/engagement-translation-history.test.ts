import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadTranslationHistory } from "@/lib/engagement/translation-history-server";

const campaignId = "10000000-0000-4000-8000-000000000001";
const workspaceId = "40000000-0000-4000-8000-000000000001";
const translationId = "20000000-0000-4000-8000-000000000001";
function revision(number = 1, event = "created") {
  const record = { id: translationId, workspace_id: workspaceId, campaign_id: campaignId,
    entity_type: "close_loop_entry", entity_id: "50000000-0000-4000-8000-000000000001", field: "we_did", locale: "es",
    translated_text: number === 1 ? "Original answer" : "Corrected answer", source: number === 1 ? "machine" : "operator",
    machine_model: number === 1 ? "synthetic-model" : null, source_text_hash: "b".repeat(64), created_by: null,
    created_at: "2026-09-12T00:00:00Z", updated_at: "2026-09-12T00:00:00Z" };
  // Spaces deliberately differ from JSON.stringify: the verifier must hash returned text.
  const record_text = JSON.stringify(record, null, 1);
  return { id: randomUUID(), campaign_id: campaignId, translation_id: translationId, revision: number,
    actor_id: null as string | null, recorded_at: "2026-09-12T00:00:00+00:00", event, record_text,
    record_sha256: createHash("sha256").update(record_text).digest("hex") };
}
function snapshot(entries = [revision()]) { return { campaignId, count: entries.length, entries }; }
async function read(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  const result = await loadTranslationHistory({ rpc } as never, campaignId, workspaceId);
  expect(rpc).toHaveBeenCalledWith("read_engagement_translation_history", { p_campaign: campaignId });
  return result;
}

describe("private translation history verification", () => {
  it("retains original, correction and removed copies without a current-row query", async () => {
    const result = await read(snapshot([revision(), revision(2, "corrected"), revision(3, "removed")]));
    expect(result.error).toBeNull();
    expect(result.rows.map(row => row.record.translated_text)).toEqual(["Original answer", "Corrected answer", "Corrected answer"]);
    expect(result.rows[2].event).toBe("removed");
  });
  it("accepts a truthful legacy baseline and a healthy empty snapshot", async () => {
    expect((await read(snapshot([revision(1, "legacy_baseline")]))).error).toBeNull();
    expect(await read(snapshot([]))).toEqual({ rows: [], error: null });
  });
  it("retains original machine attribution after acceptance", async () => {
    const result = await read(snapshot([revision(), revision(2, "accepted")]));
    expect(result.error).toBeNull();
    expect(result.rows[0].record.machine_model).toBe("synthetic-model");
    expect(result.rows[1].record.source).toBe("operator");
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
    ["foreign retained response", (s: ReturnType<typeof snapshot>) => { s.entries[0].translation_id = randomUUID(); }],
    ["missing baseline", (s: ReturnType<typeof snapshot>) => { s.entries[0].revision = 2; }],
    ["wrong initial event", (s: ReturnType<typeof snapshot>) => { s.entries[0].event = "corrected"; }],
    ["duplicate row", (s: ReturnType<typeof snapshot>) => { s.entries.push(s.entries[0]); s.count++; }],
    ["duplicate identity with valid revisions", (s: ReturnType<typeof snapshot>) => { s.entries.push({ ...revision(2, "corrected"), id: s.entries[0].id }); s.count++; }],
    ["foreign retained campaign", (s: ReturnType<typeof snapshot>) => {
      const entry = s.entries[0];
      const record = JSON.parse(entry.record_text); record.campaign_id = translationId;
      entry.record_text = JSON.stringify(record); entry.record_sha256 = createHash("sha256").update(entry.record_text).digest("hex");
    }],
    ["invented legacy actor", (s: ReturnType<typeof snapshot>) => { s.entries[0].event = "legacy_baseline"; s.entries[0].actor_id = randomUUID(); }],
    ["foreign retained workspace", (s: ReturnType<typeof snapshot>) => {
      const entry = s.entries[0]; const record = JSON.parse(entry.record_text); record.workspace_id = randomUUID();
      entry.record_text = JSON.stringify(record); entry.record_sha256 = createHash("sha256").update(entry.record_text).digest("hex");
    }],
    ["address changed within identity", (s: ReturnType<typeof snapshot>) => {
      const entry = revision(2, "corrected"); const record = JSON.parse(entry.record_text); record.locale = "fr";
      entry.record_text = JSON.stringify(record); entry.record_sha256 = createHash("sha256").update(entry.record_text).digest("hex");
      s.entries.push(entry); s.count++;
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
      expect((await loadTranslationHistory({ rpc } as never, campaignId, workspaceId)).error).not.toBeNull();
    }
  });
});

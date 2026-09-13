import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadTranslationHistory } from "@/lib/engagement/translation-history-server";
import { translationEditorFixture, translationTestId as id, translationTestUser as userId, translationTestWorkspace as workspaceId,
  rawTranslationSource, rawOriginalTranslation } from "./helpers/translation-editor-fixture";
import type { TranslationWriteIntent, TranslationWriteResult } from "@/lib/engagement/translation-write";

const sha = (raw: string) => createHash("sha256").update(raw, "utf8").digest("hex");
const words = "\u00a0SYNTHETIC revised words\ufeff", reason = "\u00a0SYNTHETIC change reason\ufeff";
function bundle(operation: "save" | "accept" | "withdraw" = "save") {
  const { revision: _revision, ...saved } = translationEditorFixture().translations[0];
  const before = { ...saved, source: operation === "accept" ? "machine" : "operator", machine_model: operation === "accept" ? "SYNTHETIC original model" : null,
    created_at: "2026-09-13T00:00:00Z" };
  const after = operation === "withdraw" ? { ...before } : { ...before, source: "operator", machine_model: null, translated_text: operation === "save" ? words : before.translated_text, updated_at: "2026-09-13T01:00:00Z" };
  const history = (record: typeof before, revision: number, event: string, linked: boolean) => {
    const record_text = JSON.stringify(record, null, 1);
    return { id: id(20 + revision), campaign_id: id(1), translation_id: id(4), revision, actor_id: linked ? userId : null,
      recorded_at: "2026-09-13T01:00:00Z", event, write_request_id: linked ? id(6) : null, record_text, record_sha256: sha(record_text) };
  };
  const payload = { schema: 1, campaignId: id(1), actorId: userId, requestId: id(6), operation, locale: "es", reason,
    entries: [{ entityType: "campaign", entityId: id(1), field: "title", expectedSource: { text: rawTranslationSource, sourceLocale: null, available: true },
      expectedTranslation: { id: id(4), revision: 1 }, ...(operation === "save" ? { text: words } : {}) }] };
  const result = { campaignId: id(1), requestId: id(6), operation, locale: "es", replayed: false,
    entries: [{ entry: after, revision: 2, removed: operation === "withdraw" }] };
  const payload_text = JSON.stringify(payload, null, 1), result_text = JSON.stringify(result, null, 1);
  return { schema: 2, campaignId: id(1), count: 2, entries: [history(before, 1, "legacy_baseline", false),
    history(after, 2, operation === "withdraw" ? "removed" : operation === "accept" ? "accepted" : "corrected", true)],
    receiptCount: 1, receipts: [{ request_id: id(6), actor_id: userId, payload_text, payload_sha256: sha(payload_text), result_text, result_sha256: sha(result_text) }] };
}
type Bundle = ReturnType<typeof bundle>;
function payload(data: Bundle, update: (value: TranslationWriteIntent & { schema: number; campaignId: string; actorId: string }) => void) {
  const receipt = data.receipts[0], value = JSON.parse(receipt.payload_text); update(value); receipt.payload_text = JSON.stringify(value); receipt.payload_sha256 = sha(receipt.payload_text);
}
function result(data: Bundle, update: (value: TranslationWriteResult) => void) {
  const receipt = data.receipts[0], value = JSON.parse(receipt.result_text); update(value); receipt.result_text = JSON.stringify(value); receipt.result_sha256 = sha(receipt.result_text);
}
async function read(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  const answer = await loadTranslationHistory({ rpc } as never, id(1), workspaceId);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("read_engagement_translation_history", { p_campaign: id(1) });
  return answer;
}

describe("translation history command evidence", () => {
  it.each(["save", "accept", "withdraw"] as const)("joins exact reason and source for %s without inventing legacy evidence", async operation => {
    const answer = await read(bundle(operation)); expect(answer.error).toBeNull(); expect(answer.rows).toHaveLength(2);
    expect(answer.rows[0].change).toBeNull();
    expect(answer.rows[1].change).toMatchObject({ requestId: id(6), operation, reason,
      source: { text: rawTranslationSource, sourceLocale: null, available: true }, expectedTranslation: { id: id(4), revision: 1 } });
    expect(answer.rows[0].record.translated_text).toBe(rawOriginalTranslation);
    if (operation === "accept") expect(answer.rows[0].record.machine_model).toBe("SYNTHETIC original model");
  });
  it.each([false, true])("reads one shared batch receipt including a no-op field: %s", noOp => {
    const data = bundle();
    const added = data.entries.map((entry, index) => {
      const record = JSON.parse(entry.record_text); record.id = id(8); record.field = "summary";
      if (noOp || index === 0) record.translated_text = rawOriginalTranslation;
      const record_text = JSON.stringify(record);
      return { ...entry, id: id(30 + index), translation_id: id(8), record_text, record_sha256: sha(record_text) };
    });
    payload(data, value => { if (value.operation !== "save") throw new Error("Expected save fixture"); value.entries.push({ ...value.entries[0], field: "summary", expectedTranslation: { id: id(8), revision: 1 }, text: noOp ? rawOriginalTranslation : words }); });
    result(data, value => { value.entries.push({ ...value.entries[0], entry: JSON.parse(added[noOp ? 0 : 1].record_text), revision: noOp ? 1 : 2 }); });
    data.entries.push(...(noOp ? added.slice(0, 1) : added)); data.count = data.entries.length;
    return read(data).then(answer => {
      expect(answer.error).toBeNull(); expect(answer.rows).toHaveLength(noOp ? 3 : 4);
      expect(answer.rows.filter(row => row.change !== null)).toHaveLength(noOp ? 1 : 2);
    });
  });
  it("retains a withdrawal's changed or absent source without comparing it to the original translation hash", async () => {
    const data = bundle("withdraw"); payload(data, value => { value.entries[0].expectedSource = { text: null, sourceLocale: "qaa", available: false }; });
    const answer = await read(data); expect(answer.error).toBeNull(); expect(answer.rows[1].change?.source).toEqual({ text: null, sourceLocale: "qaa", available: false });
  });
  it.each([
    ["payload checksum", (data: Bundle) => { data.receipts[0].payload_sha256 = "0".repeat(64); }],
    ["result checksum", (data: Bundle) => { data.receipts[0].result_sha256 = "0".repeat(64); }],
    ["receipt count", (data: Bundle) => { data.receiptCount++; }],
    ["missing linked receipt", (data: Bundle) => { data.receipts = []; data.receiptCount = 0; }],
    ["duplicate receipt", (data: Bundle) => { data.receipts.push(data.receipts[0]); data.receiptCount++; }],
    ["foreign campaign", (data: Bundle) => payload(data, value => { value.campaignId = id(99); })],
    ["foreign actor metadata", (data: Bundle) => { data.receipts[0].actor_id = id(99); }],
    ["foreign request metadata", (data: Bundle) => { data.receipts[0].request_id = id(99); data.entries[1].write_request_id = id(99); }],
    ["foreign history actor", (data: Bundle) => { data.entries[1].actor_id = id(99); }],
    ["invented baseline link", (data: Bundle) => { data.entries[0].write_request_id = id(6); }],
    ["missing reason", (data: Bundle) => payload(data, value => { value.reason = null; })],
    ["other starting version", (data: Bundle) => payload(data, value => { value.entries[0].expectedTranslation!.revision = 2; })],
    ["other completed revision", (data: Bundle) => result(data, value => { value.entries[0].revision = 1; })],
    ["wrong history event", (data: Bundle) => { data.entries[1].event = "removed"; }],
    ["replayed stored result", (data: Bundle) => result(data, value => { value.replayed = true; })],
    ["receipt wording differs", (data: Bundle) => { payload(data, value => { if (value.operation === "save") value.entries[0].text = "SYNTHETIC different words"; }); result(data, value => { value.entries[0].entry.translated_text = "SYNTHETIC different words"; }); }],
    ["source words differ", (data: Bundle) => payload(data, value => { value.entries[0].expectedSource.text = "SYNTHETIC different source"; })],
    ["source missing", (data: Bundle) => payload(data, value => { value.entries[0].expectedSource.text = null; })],
    ["unrelated receipt", (data: Bundle) => { data.entries[1].write_request_id = null; }],
    ["legacy wire version", (data: Bundle) => { data.schema = 1; }],
  ])("withholds all history on %s", async (_name, corrupt) => {
    const data = bundle(); corrupt(data); const answer = await read(data);
    expect(answer.rows).toEqual([]); expect(answer.error?.message).toContain("could not be read and verified completely");
  });
});

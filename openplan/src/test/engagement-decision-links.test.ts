import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import rawNative from "./fixtures/decision-link-native.json";
import { decisionLinkIntentSchema, readDecisionContext, readDecisionLinkReceipt, readDecisionLinkSnapshot } from "@/lib/engagement/decision-links";
import type { DecisionLinkScope, DecisionLinkSnapshotPacket } from "@/lib/engagement/decision-links";

const native = rawNative as { synthetic: boolean; scope: DecisionLinkScope & { actorId: string }; initial: DecisionLinkSnapshotPacket; withdrawn: DecisionLinkSnapshotPacket };

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const other = "40000000-0000-4000-8000-000000000004";
const address = { ...native.scope, responseId: native.initial.entries[0].response_id, decisionId: native.initial.entries[0].decision_id };
function originalIntent() {
  const body = { ...native.initial.entries[0].payload_json };
  return decisionLinkIntentSchema.parse({ requestId: native.initial.entries[0].id, responseId: body.responseId,
    decisionId: body.decisionId, operation: body.operation, predecessorId: body.predecessorId,
    expectedContextSha256: body.expectedContextSha256, reason: body.reason });
}
function updatePayload(row: typeof native.initial.entries[number]) {
  row.payload_text = JSON.stringify(row.payload_json); row.payload_sha256 = hash(row.payload_text);
}
function changeContext(row: typeof native.initial.entries[number], change: (value: Record<string, unknown>) => void) {
  const context = JSON.parse(row.context_text) as Record<string, unknown>;
  change(context); row.context_text = JSON.stringify(context); row.context_sha256 = hash(row.context_text);
  if (row.operation !== "withdraw") { row.payload_json.expectedContextSha256 = row.context_sha256; updatePayload(row); }
}
const packet = (row = native.initial.entries[0]) => ({ contextText: row.context_text, contextSha256: row.context_sha256 });

// Native fixture is synthetic. SQL/RLS are exercised by the separate native probes.
describe("retained engagement decision links", () => {
  it("reads native context and originals after withdrawal", async () => {
    expect(native.synthetic).toBe(true);
    const initial = await readDecisionLinkSnapshot(native.initial, native.scope);
    expect(initial.entries[0].context.decision.status).toBe("proposed");
    expect(initial.entries[0].context.sources).toHaveLength(5);
    expect(initial.entries[0].context.sources[1].configurationAvailability).toBe("unknown");
    const closed = await readDecisionLinkSnapshot(native.withdrawn, native.scope);
    expect(closed.entries).toHaveLength(2);
    expect(closed.entries[1].operation).toBe("withdraw");
    expect(closed.entries[1].context_text).toBe(closed.entries[0].context_text);
    expect(closed.current[0].sourceState).toBe("unavailable");
  });
  it("accepts exact old receipts without current sources", async () => {
    for (const replayed of [false, true]) {
      const result = await readDecisionLinkReceipt({ link: native.initial.entries[0], replayed }, native.scope, originalIntent());
      expect(result.receipt.replayed).toBe(replayed);
      expect(result.link.context.decision.rationale).toBe("SYNTHETIC private rationale");
    }
  });
  it("allows a no-op response clock advance without inventing history", async () => {
    const row = structuredClone(native.initial.entries[0]);
    changeContext(row, context => { (context.response as Record<string, unknown>).updated_at = "2026-09-15T00:00:00Z"; });
    expect((await readDecisionContext(packet(row), address)).context.responseHistory.revision).toBe(2);
  });
  it("refuses altered context bytes", async () => {
    const row = structuredClone(native.initial.entries[0]); row.context_text += " ";
    await expect(readDecisionContext(packet(row), address)).rejects.toThrow("checksum differs");
  });
  it("refuses foreign context with a recomputed hash", async () => {
    const row = structuredClone(native.initial.entries[0]);
    changeContext(row, context => { (context.campaign as Record<string, unknown>).id = other; });
    await expect(readDecisionContext(packet(row), address)).rejects.toThrow("scope differs");
  });
  it("refuses changed retained response content with recomputed hashes", async () => {
    const row = structuredClone(native.initial.entries[0]);
    changeContext(row, context => {
      const history = context.responseHistory as Record<string, string>;
      const old = JSON.parse(history.recordText); old.we_did = "SYNTHETIC replaced original";
      history.recordText = JSON.stringify(old); history.recordSha256 = hash(history.recordText);
    });
    await expect(readDecisionContext(packet(row), address)).rejects.toThrow("Retained response differs");
  });
  it("refuses lost references even with a reduced declared count", async () => {
    const row = structuredClone(native.initial.entries[0]);
    changeContext(row, context => { (context.sources as unknown[]).pop(); context.sourceCount = 4; });
    await expect(readDecisionContext(packet(row), address)).rejects.toThrow("inventory is incomplete");
  });
  it("refuses changed order and invented unavailable content", async () => {
    const row = structuredClone(native.initial.entries[0]);
    changeContext(row, context => { (context.sources as Record<string, unknown>[])[0].position = 2; });
    await expect(readDecisionContext(packet(row), address)).rejects.toThrow("source order differs");
    const missing = structuredClone(native.initial.entries[0]);
    changeContext(missing, context => { const items = context.sources as Record<string, unknown>[]; items[3].record = items[0].record; });
    await expect(readDecisionContext(packet(missing), address)).rejects.toThrow("invented content");
  });
  it("refuses foreign source records and fabricated configuration", async () => {
    const row = structuredClone(native.initial.entries[0]);
    changeContext(row, context => { (context.sources as { record: Record<string, unknown> }[])[0].record.campaign_id = other; });
    await expect(readDecisionContext(packet(row), address)).rejects.toThrow("source scope differs");
    const unknown = structuredClone(native.initial.entries[0]);
    changeContext(unknown, context => { (context.sources as Record<string, unknown>[])[1].configurationAvailability = "available"; });
    await expect(readDecisionContext(packet(unknown), address)).rejects.toThrow("source configuration differs");
  });
  it("checks original definition bytes and rejects unused definitions", async () => {
    const row = structuredClone(native.initial.entries[0]);
    changeContext(row, context => { (context.configurations as Record<string, unknown>[])[0].definitionText = "{}"; });
    await expect(readDecisionContext(packet(row), address)).rejects.toThrow("checksum differs");
    const extra = structuredClone(native.initial.entries[0]);
    changeContext(extra, context => { const definitions = context.configurations as Record<string, unknown>[]; definitions.push({ ...definitions[0], id: other }); context.configurationCount = 2; });
    await expect(readDecisionContext(packet(extra), address)).rejects.toThrow("unrelated definitions");
  });
  it("refuses another actor, request or reason", async () => {
    const receipt = { link: native.initial.entries[0], replayed: true };
    await expect(readDecisionLinkReceipt(receipt, { ...native.scope, actorId: other }, originalIntent())).rejects.toThrow("does not match the request");
    await expect(readDecisionLinkReceipt(receipt, native.scope, { ...originalIntent(), requestId: other })).rejects.toThrow("does not match the request");
    await expect(readDecisionLinkReceipt(receipt, native.scope, { ...originalIntent(), reason: "SYNTHETIC different reason" })).rejects.toThrow("does not match the request");
  });
  it("refuses changed request bytes and contradictory row fields", async () => {
    const row = structuredClone(native.initial.entries[0]); row.payload_text += " ";
    await expect(readDecisionLinkReceipt({ link: row, replayed: false }, native.scope, originalIntent())).rejects.toThrow("checksum differs");
    const altered = structuredClone(native.initial.entries[0]); altered.reason = "SYNTHETIC changed reason";
    await expect(readDecisionLinkReceipt({ link: altered, replayed: false }, native.scope, originalIntent())).rejects.toThrow("payload differs");
  });
  it("refuses incomplete counts, duplicate rows and missing predecessors", async () => {
    const snapshot = structuredClone(native.initial); snapshot.entryCount++;
    await expect(readDecisionLinkSnapshot(snapshot, native.scope)).rejects.toThrow("inventory is incomplete");
    const duplicate = structuredClone(native.initial); duplicate.entries.push(duplicate.entries[0]); duplicate.entryCount++;
    await expect(readDecisionLinkSnapshot(duplicate, native.scope)).rejects.toThrow("Duplicate decision records");
    const missing = structuredClone(native.withdrawn); missing.entries.shift(); missing.entryCount--;
    await expect(readDecisionLinkSnapshot(missing, native.scope)).rejects.toThrow("Invalid decision link predecessor");
  });
  it("refuses forks and duplicate roots", async () => {
    const fork = structuredClone(native.withdrawn); fork.entries.push({ ...fork.entries[1], id: other }); fork.entryCount++;
    fork.current.push({ ...fork.current[0], linkId: other }); fork.currentCount++;
    await expect(readDecisionLinkSnapshot(fork, native.scope)).rejects.toThrow("Invalid decision link predecessor");
    const roots = structuredClone(native.initial); roots.entries.push({ ...roots.entries[0], id: other }); roots.entryCount++;
    roots.current.push({ ...roots.current[0], linkId: other }); roots.currentCount++;
    await expect(readDecisionLinkSnapshot(roots, native.scope)).rejects.toThrow("Duplicate decision link root");
  });
  it("refuses a cycle whose referenced rows all exist", async () => {
    const snapshot = structuredClone(native.initial), first = snapshot.entries[0], second = structuredClone(first); second.id = other;
    first.predecessor_id = second.id; second.predecessor_id = first.id;
    for (const row of [first, second]) { row.operation = "refresh"; row.payload_json.operation = "refresh"; row.payload_json.predecessorId = row.predecessor_id; updatePayload(row); }
    snapshot.entries.push(second); snapshot.entryCount++;
    snapshot.current = []; snapshot.currentCount = 0;
    await expect(readDecisionLinkSnapshot(snapshot, native.scope)).rejects.toThrow("history has a cycle");
  });
  it("refuses an invented source state or missing current leaf", async () => {
    const state = structuredClone(native.initial); state.current[0].sourceState = "changed";
    await expect(readDecisionLinkSnapshot(state, native.scope)).rejects.toThrow("Current decision source state differs");
    const missing = structuredClone(native.initial); missing.current = []; missing.currentCount = 0;
    await expect(readDecisionLinkSnapshot(missing, native.scope)).rejects.toThrow("Current decision links are incomplete");
  });
  it("refuses malformed commands", () => {
    const good = originalIntent();
    for (const change of [{ operation: "refresh" }, { operation: "withdraw", predecessorId: other }, { reason: " " }, { reason: "\0" }, { operation: "refresh", predecessorId: good.requestId }]) {
      expect(decisionLinkIntentSchema.safeParse({ ...good, ...change }).success).toBe(false);
    }
  });
});

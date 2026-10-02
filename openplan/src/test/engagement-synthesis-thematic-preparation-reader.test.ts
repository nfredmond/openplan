// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSynthesisThematicPreparationReader } from "@/lib/engagement/synthesis-thematic-preparation-server";
import { synthesisThematicPreparationFixture as fixture } from "./fixtures/engagement/synthesis-thematic-preparation";
import { addThematicPreparationContext } from "./fixtures/engagement/synthesis-thematic-preparation-context";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";

function reader(f: Awaited<ReturnType<typeof fixture>>) {
  const { targetRecordId, ...scope } = f.scope;
  const read = createSynthesisThematicPreparationReader(f.service, scope);
  return () => read(targetRecordId, f.f.controller.signal);
}
const sourceReads = (f: Awaited<ReturnType<typeof fixture>>) => f.f.trace.filter(row => row.table === "engagement_synthesis_sources").length;
const parentReads = (f: Awaited<ReturnType<typeof fixture>>) => f.calls.filter(call => call.parameters.p_stage === "parent").length;

describe("request-scoped shared thematic preparation", () => {
  it("reuses original source and parent reads but replays each context with fresh authority", async () => {
    const f = await fixture(), read = reader(f), first = await read();
    const contextReads = f.calls.filter(call => call.parameters.p_stage === "context").length;
    const before = f.f.trace.length, second = await read();
    expect(second.history.canonical).toBe(first.history.canonical); expect(second.history.finalOutputText).toBe(first.history.finalOutputText);
    expect(sourceReads(f)).toBe(2); expect(parentReads(f)).toBe(1); expect(f.options.reads).toBe(4);
    expect(f.calls.filter(call => call.parameters.p_stage === "context")).toHaveLength(contextReads * 2);
    expect(f.f.trace.length).toBeGreaterThan(before);
    expect(f.f.trace.slice(before).some(row => row.table === "engagement_synthesis_context_attempt_inputs")).toBe(true);
  });
  it("shares one parent across distinct item and survey contexts without reusing context results", async () => {
    const f = await fixture(), source = JSON.parse(f.sourceRow.snapshot_text);
    const otherId = f.scope.targetRecordId.startsWith("answer:") ? `item:${source.items[0].id}` : `answer:${source.answers[0].id}`;
    const other = await addThematicPreparationContext(f, otherId), { targetRecordId, ...scope } = f.scope;
    const read = createSynthesisThematicPreparationReader(f.service, scope);
    const item = await read(targetRecordId, f.f.controller.signal), answer = await read(otherId, f.f.controller.signal);
    expect(item.history.canonical).toBe(f.expected.canonical); expect(answer.history.canonical).toBe(other.expected.canonical);
    expect(answer.history.sha256).not.toBe(item.history.sha256);
    expect(answer.delegation.choice.record.targetRecordId).toBe(otherId);
    expect(sourceReads(f)).toBe(2); expect(parentReads(f)).toBe(1); expect(f.options.reads).toBe(4);
    const stages = f.calls.filter(call => call.parameters.p_stage === "context").map(call => call.parameters.p_target);
    expect(stages).toContain(targetRecordId); expect(stages).toContain(otherId);
    other.context.history.at(-1)!.outputRow.capture_text = "{}";
    await expect(read(otherId, f.f.controller.signal)).rejects.toThrow();
    expect(sourceReads(f)).toBe(2);
  });
  it("detaches both initial and reused caller results from the private cache", async () => {
    const f = await fixture(), read = reader(f), first = await read(), expected = first.history.canonical;
    first.source.snapshotText = "corrupt"; first.parent.selections.entries.length = 0;
    first.delegation.parent.request.createdAt = "2020-01-01T00:00:00Z";
    const secondRead = read(); await expect(secondRead).resolves.toMatchObject({ history: { sha256: f.expected.sha256 } });
    const second = await secondRead; expect(second.history.canonical).toBe(expected);
    second.source.snapshotText = "corrupt"; second.parent.inventory.results.length = 0;
    await expect(read()).resolves.toMatchObject({ history: { sha256: f.expected.sha256 } }); expect(sourceReads(f)).toBe(2);
  });
  it.each(["thematicRequest", "thematicBinding", "parentRequest", "source"])("refuses changed cached %s before private context access", async kind => {
    const f = await fixture(), read = reader(f); await read(); const before = f.f.trace.length;
    f.options.change = packet => {
      if (kind === "thematicRequest") packet.thematic.request.createdAt = "2020-01-01T00:00:00Z";
      if (kind === "thematicBinding") packet.thematic.thematic.createdAt = "2020-01-01T00:00:00Z";
      if (kind === "parentRequest") packet.parent.request.createdAt = "2020-01-01T00:00:00Z";
      if (kind === "source") packet.source.createdAt = "2020-01-01T00:00:00Z";
    };
    await expect(read()).rejects.toThrow("preparation differs"); expect(f.f.trace).toHaveLength(before);
  });
  it.each([3, 4])("does not cache authority at native read %s", async denied => {
    const f = await fixture(), read = reader(f); await read(); f.options.denyRead = denied; const before = f.f.trace.length;
    await expect(read()).rejects.toThrow("preparation access unavailable");
    if (denied === 3) expect(f.f.trace).toHaveLength(before); else expect(f.f.trace.length).toBeGreaterThan(before);
  });
  it("refuses new cancellation after a successful cached read", async () => {
    const f = await fixture(), read = reader(f); await read(); f.bundle.thematic.cancellation = { retained: true };
    const before = f.f.trace.length; await expect(read()).rejects.toThrow("preparation differs"); expect(f.f.trace).toHaveLength(before);
  });
  it("keeps historical cancellations live without invalidating immutable parent originals", async () => {
    const f = await fixture(), read = reader(f); await read(); f.f.cancel();
    Object.assign(f.bundle.parent, { cancellation: { retained: true } });
    const result = await read(); expect(result.history.request.cancellation).not.toBeNull();
    expect(result.history.sha256).toBe(f.expected.sha256); expect(sourceReads(f)).toBe(2);
  });
  it("does not reuse a failed initial replay or a failed final authority check", async () => {
    for (const kind of ["pin", "authority", "parent"]) {
      const f = await fixture(), read = reader(f), original = f.bundle.choice.choiceText;
      if (kind === "pin") f.patchChoice({ finalResultSha256: "0".repeat(64) });
      if (kind === "authority") f.options.denyRead = 2;
      if (kind === "parent") f.f.options.failTable = "engagement_synthesis_generation_outputs";
      await expect(read()).rejects.toThrow(); expect(sourceReads(f)).toBe(2);
      f.bundle.choice.choiceText = original; f.bundle.choice.choiceSha256 = hash(original);
      f.options.denyRead = 0; f.f.options.failTable = "";
      expect((await read()).history.sha256).toBe(f.expected.sha256); expect(sourceReads(f)).toBe(4); expect(parentReads(f)).toBe(2);
    }
  });
  it("does not share cache between reader instances or accept injected trusted inputs", async () => {
    const f = await fixture(), first = reader(f), second = reader(f); await first(); await second();
    expect(sourceReads(f)).toBe(4); expect(parentReads(f)).toBe(2);
    const { targetRecordId: _target, ...scope } = f.scope;
    expect(() => createSynthesisThematicPreparationReader(f.service, { ...scope, cached: {} } as typeof scope)).toThrow();
  });
  it("refuses wrong targets and aborts before using a warm cache", async () => {
    const f = await fixture(), read = reader(f); await read(); const before = f.calls.length;
    f.f.controller.abort(); await expect(read()).rejects.toThrow(); expect(f.calls).toHaveLength(before);
    const other = await fixture(), { targetRecordId: _target, ...scope } = other.scope;
    const load = createSynthesisThematicPreparationReader(other.service, scope);
    await expect(load(`item:${randomUUID()}`, other.f.controller.signal)).rejects.toThrow(); expect(other.f.trace).toEqual([]);
  });
  it("refuses competing cold reads with different immutable roots", async () => {
    const f = await fixture(), read = reader(f);
    f.options.change = packet => { if (f.options.reads % 2 === 0) packet.thematic.request.createdAt = "2020-01-01T00:00:00Z"; };
    const outcomes = await Promise.allSettled([read(), read()]);
    expect(f.options.reads).toBe(4); expect(outcomes[0].status).toBe("fulfilled");
    expect(outcomes[1].status).toBe("rejected");
    if (outcomes[1].status === "rejected") expect(String(outcomes[1].reason)).toContain("preparation differs");
  });
  it("permits concurrent cold reads without sharing failed or pending authority", async () => {
    const f = await fixture(), read = reader(f), results = await Promise.all([read(), read()]);
    expect(results.map(result => result.history.sha256)).toEqual([f.expected.sha256, f.expected.sha256]);
    expect(sourceReads(f)).toBe(4); expect(f.options.reads).toBe(4);
    await read(); expect(sourceReads(f)).toBe(4); expect(f.options.reads).toBe(6);
  });
});

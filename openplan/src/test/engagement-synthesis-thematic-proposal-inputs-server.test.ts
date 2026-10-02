// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSynthesisThematicInputManifest } from "@/lib/engagement/synthesis-thematic-input-manifest";
import { createSynthesisThematicProposal } from "@/lib/engagement/synthesis-thematic-proposal";
import { thematicProposalInputsFixture as fixture } from "./fixtures/engagement/synthesis-thematic-proposal-inputs";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";

describe("complete sealed thematic proposal inputs", () => {
  it("replays every mixed-source context and feeds exact evidence into proposal conversion without writes", async () => {
    const f = await fixture(), result = await f.load();
    expect(result.input.manifestSha256).toBe(f.plan().manifestSha256); expect(result.input.sourceSha256).toBe(f.saved.snapshotSha256);
    expect(result.input.contexts.map(context => context.sourceId)).toEqual(f.metadata().map(entry => entry.targetRecordId));
    expect(result.originals).toEqual(f.metadata().map(entry => { const row = f.records.get(entry.targetRecordId)!;
      return { targetRecordId: row.targetRecordId, proofText: row.proofText, outputText: row.outputText }; }));
    const noted = result.input.contexts.find(context => context.notes.length)!, empty = result.input.contexts.find(context => !context.notes.length)!;
    expect(noted.notes).toEqual([{ id: 0, text: "SYNTHETIC retained note é 中文" }]);
    for (const context of result.input.contexts) {
      const output = JSON.parse(f.records.get(context.sourceId)!.outputText);
      expect(context.uncertainties).toEqual(output.uncertainties);
      expect(context.notes).toEqual(output.notes.map((note: { id: number; text: string }) => ({ id: note.id, text: note.text })));
    }
    const taskSha256 = hash("SYNTHETIC receiving task"), outputText = JSON.stringify({ status: "complete", title: "SYNTHETIC proposal", notes: "Unreviewed",
      groups: [{ id: "g", label: "SYNTHETIC issue", summary: "Unreviewed grouping", sentiment: "not_assessed", members: [
        { sourceId: noted.sourceId, rationale: "SYNTHETIC evidence", citations: [{ noteId: 0, quote: "é 中文" }] }] }],
      unassigned: [{ sourceId: empty.sourceId, reason: "No contextual note was retained", citations: [] }], uncertainties: ["SYNTHETIC unassessed"] });
    const proposal = createSynthesisThematicProposal(result.source, { ...f.scope, requestId: result.source.requestId }, result.input,
      taskSha256, { taskSha256, outputText, finishReason: "stop" });
    expect(proposal.content).toMatchObject({ status: "machine_unreviewed", assignedSourceCount: 1, unassignedSourceIds: [empty.sourceId] });
    expect(f.calls.every(call => call.name.startsWith("read_"))).toBe(true);
    expect(f.calls.every(call => call.signal instanceof AbortSignal)).toBe(true);
    expect(f.options.inventoryReads).toBe(4); expect(f.f.options.reads).toBe(4);
    expect(f.f.calls.filter(call => call.parameters.p_stage === "parent")).toHaveLength(1);
    expect(f.f.f.trace.filter(call => call.table === "engagement_synthesis_sources")).toHaveLength(4);
  });
  it("requires an existing exact seal and uncancelled current request before context access", async () => {
    for (const kind of ["absent", "cancelled", "invalid"]) {
      const f = await fixture(); if (kind === "absent") f.options.seal = null;
      if (kind === "cancelled") f.f.bundle.thematic.cancellation = { retained: true };
      if (kind === "invalid") f.options.seal!.receiptSha256 = "0".repeat(64);
      const error = kind === "absent" ? "requires sealed complete-source" : kind === "cancelled" ? "preparation was cancelled" : "seal differs from reconstructed custody";
      await expect(f.load()).rejects.toThrow(error); expect(f.f.calls).toEqual([]);
    }
  });
  it("refuses missing, denied and aborted retained input reads", async () => {
    for (const kind of ["missing", "denied", "abort"]) {
      const f = await fixture(); if (kind === "missing") f.options.missingTarget = f.metadata()[0].targetRecordId;
      if (kind === "denied") f.options.deny = "read_engagement_synthesis_thematic_input";
      if (kind === "abort") f.options.abortInput = true;
      const error = kind === "missing" ? "Sealed thematic input custody is missing" : kind === "denied" ? "input custody unavailable" : "aborted";
      await expect(f.load()).rejects.toThrow(error); expect(f.f.calls).toEqual([]);
    }
  });
  it.each(["bytes", "proof"])("refuses inventory %s that disagree with original retained custody", async kind => {
    const f = await fixture(), entries = f.metadata(), first = entries[0];
    // Alter both pages and the seal while leaving original custody untouched.
    if (kind === "bytes") first.outputBytes++;
    else { first.proofText = JSON.stringify({ ...JSON.parse(first.proofText), choiceSha256: "0".repeat(64) }); first.proofSha256 = hash(first.proofText); }
    const plan = createSynthesisThematicInputManifest(f.f.bundle.thematic, f.scope, f.saved, entries);
    const receiptText = JSON.stringify({ ...JSON.parse(f.options.seal!.receiptText), manifestSha256: plan.manifestSha256 });
    f.options.seal = { manifestText: plan.manifestText, manifestSha256: plan.manifestSha256, receiptText, receiptSha256: hash(receiptText) };
    f.options.changeInventory = page => { page.entries = page.entries.map(row => row.targetRecordId === first.targetRecordId ? { ...first } : row); };
    await expect(f.load()).rejects.toThrow("proposal inputs differ"); expect(f.f.calls).toEqual([]);
  });
  it.each(["proof", "output"])("refuses self-hashed %s substitution even under a matching inventory seal", async kind => {
    const f = await fixture(), record = [...f.records.values()][0], proof = JSON.parse(record.proofText);
    if (kind === "proof") proof.choiceSha256 = "0".repeat(64);
    else { record.outputText += " "; record.outputSha256 = hash(record.outputText); proof.outputSha256 = record.outputSha256; }
    record.proofText = JSON.stringify(proof); record.proofSha256 = hash(record.proofText); f.options.seal = f.makeSeal();
    await expect(f.load()).rejects.toThrow("differs from reconstructed originals");
  });
  it("refuses corrupt or incomplete original context even when its saved proof remains valid", async () => {
    const f = await fixture(); f.other.context.history.at(-1)!.outputRow.capture_text = "{}";
    await expect(f.load()).rejects.toThrow();
  });
  it.each(["request", "binding", "source-date"])("refuses a different replayed %s from the sealed inventory", async kind => {
    const f = await fixture(); f.f.options.change = packet => {
      if (kind === "request") packet.thematic.request.createdAt = "2020-01-01T00:00:00Z";
      if (kind === "binding") packet.thematic.thematic.createdAt = "2020-01-01T00:00:00Z";
      if (kind === "source-date") {
        packet.source.createdAt = "2020-01-01T00:00:00Z";
        f.f.f.options.returnedPatch = { table: "engagement_synthesis_sources", patch: { created_at: packet.source.createdAt } };
      }
    };
    // Restore the inventory's source row after replay so its final read cannot
    // mask a missing comparison against the first sealed inventory.
    f.options.changeInventory = () => {
      if (f.options.inventoryReads >= 3) f.f.f.options.returnedPatch = null;
    };
    await expect(f.load()).rejects.toThrow("proposal inputs differ");
  });
  it.each(["denied", "cancelled", "seal", "request", "binding", "source"])("rechecks %s after all context replays", async kind => {
    const f = await fixture(); if (kind === "denied") f.options.denyInventory = 3;
    f.options.changeInventory = page => {
      if (f.options.inventoryReads < 3) return;
      if (kind === "cancelled") page.thematic.cancellation = { retained: true };
      if (kind === "seal") { const text = JSON.stringify({ ...JSON.parse(page.seal!.receiptText), sealedAt: "2020-01-01T00:00:00Z" }); page.seal!.receiptText = text; page.seal!.receiptSha256 = hash(text); }
      if (kind === "request") page.thematic.request.createdAt = "2020-01-01T00:00:00Z";
      if (kind === "binding") page.thematic.thematic.createdAt = "2020-01-01T00:00:00Z";
      if (kind === "source") { page.source.createdAt = "2020-01-01T00:00:00Z"; f.f.f.options.returnedPatch = { table: "engagement_synthesis_sources", patch: { created_at: page.source.createdAt } }; }
    };
    await expect(f.load()).rejects.toThrow(); expect(f.f.options.reads).toBe(4);
  });
});

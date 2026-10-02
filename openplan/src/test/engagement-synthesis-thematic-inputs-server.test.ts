// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { readSynthesisThematicInput, readSynthesisThematicInputHistory, retainSynthesisThematicInput,
  verifySynthesisThematicInput } from "@/lib/engagement/synthesis-thematic-inputs-server";
import { synthesisThematicPreparationFixture } from "./fixtures/engagement/synthesis-thematic-preparation";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";

type Record = ReturnType<typeof verifySynthesisThematicInput>["record"];
async function fixture() {
  const f = await synthesisThematicPreparationFixture(), calls: Array<{ name: string; args: object; signal?: AbortSignal }> = [];
  let stored: Record | null = null;
  const options = { fail: "", abort: "", reply: null as null | ((record: Record) => void) };
  const rpc = (name: string, args: { p_request?: string; p_target?: string; p_proof_text?: string; p_output_text?: string }) => {
    if (!name.includes("thematic_input")) return f.service.rpc(name, args);
    const call = { name, args, signal: undefined as AbortSignal | undefined }; calls.push(call);
    const result = (async () => {
      if (name === "retain_engagement_synthesis_thematic_input") {
        const replayed = stored !== null;
        stored ??= { schemaVersion: 1, requestId: args.p_request!, targetRecordId: args.p_target!,
          proofText: args.p_proof_text!, proofSha256: hash(args.p_proof_text!), outputText: args.p_output_text!,
          outputSha256: hash(args.p_output_text!), createdAt: "2026-10-01T12:00:00Z" };
        const data = { ...stored, replayed }; options.reply?.(data);
        if (name === options.abort) f.f.controller.abort();
        return { data, error: name === options.fail ? { code: "PT503" } : null };
      }
      const data = stored === null ? null : structuredClone(stored); if (data) options.reply?.(data);
      if (name === options.abort) f.f.controller.abort();
      return { data, error: name === options.fail ? { code: "42501" } : null };
    })();
    return Object.assign(result, { abortSignal(signal: AbortSignal) { call.signal = signal; return result; } });
  };
  const service = { from: f.service.from, rpc } as unknown as Pick<SupabaseClient, "rpc" | "from">;
  return { f, service, options, calls, save: () => retainSynthesisThematicInput(service, f.scope, f.f.controller.signal),
    read: () => readSynthesisThematicInput(service, f.scope, f.f.controller.signal),
    history: () => readSynthesisThematicInputHistory(service, f.scope, f.f.controller.signal) };
}

describe("reconstructed thematic input custody", () => {
  it("retains exact original output and all original bindings after complete replay", async () => {
    const f = await fixture(); expect(await f.read()).toBeNull();
    const result = await f.save(), { bundle, expected, scope } = f.f;
    expect(result.proof).toEqual({ schemaVersion: 1, purpose: "private_synthesis_thematic_input", ...scope,
      actorId: bundle.thematic.request.actorId, intentSha256: bundle.thematic.request.intentSha256,
      thematicSha256: bundle.thematic.thematic.thematicSha256, sourceId: bundle.source.requestId,
      sourceSha256: bundle.source.snapshotSha256, choiceSha256: bundle.choice.choiceSha256,
      contextRequestId: bundle.context.request.id, contextRequestSha256: bundle.context.context.contextSha256,
      historyManifestSha256: expected.sha256, finalCaptureSha256: expected.entries.at(-1)!.captureSha256,
      finalResultSha256: expected.entries.at(-1)!.resultSha256, outputSha256: hash(expected.finalOutputText!) });
    expect(result.record.outputText).toBe(expected.finalOutputText); expect(result.record.replayed).toBe(false);
    expect(f.f.options.reads).toBe(2); expect(f.f.f.trace.length).toBeGreaterThan(0);
    expect((await f.save()).record).toEqual({ ...result.record, replayed: true });
    const { replayed: _replayed, ...original } = result.record;
    expect((await f.read())?.record).toEqual(original); expect((await f.history())?.record).toEqual(original);
    expect(f.calls.at(-1)).toMatchObject({ name: "read_engagement_synthesis_thematic_input_history",
      args: { p_campaign: scope.campaignId, p_request: scope.requestId, p_target: scope.targetRecordId }, signal: expect.any(AbortSignal) });
    expect(f.calls.every(call => call.signal instanceof AbortSignal)).toBe(true);
  });
  it("does not retain unavailable, incomplete or unpinned original history", async () => {
    const f = await fixture(); f.f.options.denyRead = 2;
    await expect(f.save()).rejects.toThrow("preparation access unavailable"); expect(f.calls).toEqual([]);
    const missing = await fixture(); missing.f.f.rows.set("engagement_synthesis_generation_outputs", []);
    await expect(missing.save()).rejects.toThrow(); expect(missing.calls).toEqual([]);
    const different = await fixture(); different.f.patchChoice({ finalResultSha256: "0".repeat(64) });
    await expect(different.save()).rejects.toThrow(); expect(different.calls).toEqual([]);
  });
  it("recovers retained custody after an unconfirmed save without another reconstruction or write", async () => {
    const f = await fixture(); f.options.fail = "retain_engagement_synthesis_thematic_input";
    await expect(f.save()).rejects.toThrow("save unconfirmed"); const privateReads = f.f.f.trace.length;
    f.f.options.deny = "read_engagement_synthesis_thematic_preparation";
    const saved = await f.read(); expect(saved?.record.outputText).toBe(f.f.expected.finalOutputText);
    expect(f.f.f.trace.length).toBe(privateReads); expect(f.calls.filter(call => call.name.startsWith("retain")).length).toBe(1);
  });
  it.each(["worker", "staff"])("keeps absent and denied %s reads distinct", async kind => {
    const f = await fixture(); const read = kind === "worker" ? f.read : f.history;
    expect(await read()).toBeNull(); f.options.fail = kind === "worker" ? "read_engagement_synthesis_thematic_input" : "read_engagement_synthesis_thematic_input_history";
    await expect(read()).rejects.toThrow("unavailable");
  });
  it.each(["worker", "staff", "save"])("propagates aborted %s calls", async kind => {
    const f = await fixture(), call = kind === "worker" ? f.read : kind === "staff" ? f.history : f.save;
    f.options.abort = kind === "worker" ? "read_engagement_synthesis_thematic_input" : kind === "staff" ? "read_engagement_synthesis_thematic_input_history" : "retain_engagement_synthesis_thematic_input";
    await expect(call()).rejects.toThrow();
    const early = await fixture(); early.f.f.controller.abort(); await expect(early.save()).rejects.toThrow(); expect(early.calls).toEqual([]);
  });
  it("rejects receipt scope, byte length, malformed text and independently mismatched digests", async () => {
    const f = await fixture(), original = (await f.save()).record;
    const cases: Array<(record: Record) => void> = [
      r => { r.requestId = randomUUID(); }, r => { r.targetRecordId = `item:${randomUUID()}`; },
      r => { r.proofSha256 = "0".repeat(64); }, r => {
        r.outputSha256 = "0".repeat(64);
        r.proofText = JSON.stringify({ ...JSON.parse(r.proofText), outputSha256: r.outputSha256 }); r.proofSha256 = hash(r.proofText);
      },
      r => { r.outputText += " "; r.outputSha256 = hash(r.outputText); },
      r => { r.proofText = " ".repeat(8192) + r.proofText; r.proofSha256 = hash(r.proofText); },
    ];
    for (const change of cases) { const record = structuredClone(original); change(record);
      expect(() => verifySynthesisThematicInput(record, f.f.scope)).toThrow("custody differs"); }
    for (const key of ["requestId", "campaignId", "workspaceId", "targetRecordId"]) {
      const record = structuredClone(original), proof = JSON.parse(record.proofText);
      proof[key] = key === "targetRecordId" ? `item:${randomUUID()}` : randomUUID(); record.proofText = JSON.stringify(proof); record.proofSha256 = hash(record.proofText);
      expect(() => verifySynthesisThematicInput(record, f.f.scope)).toThrow("custody differs");
    }
    for (const output of ["", "a".repeat(4_194_305), "\ud800", "bad\0text"]) {
      const record = structuredClone(original); record.outputText = output; record.outputSha256 = hash(output);
      record.proofText = JSON.stringify({ ...JSON.parse(record.proofText), outputSha256: record.outputSha256 }); record.proofSha256 = hash(record.proofText);
      expect(() => verifySynthesisThematicInput(record, f.f.scope)).toThrow("custody differs");
    }
  });
  it("preserves escaped provider Unicode as raw output text", async () => {
    const f = await fixture(), record = (await f.save()).record;
    record.outputText = '{"notes":["\\ud800","\\u0000","中文"]}'; record.outputSha256 = hash(record.outputText);
    record.proofText = JSON.stringify({ ...JSON.parse(record.proofText), outputSha256: record.outputSha256 }); record.proofSha256 = hash(record.proofText);
    expect(verifySynthesisThematicInput(record, f.f.scope).record.outputText).toBe(record.outputText);
  });
  it("rejects self-hashed substituted save acknowledgement and missing retry evidence", async () => {
    for (const kind of ["proof", "output", "retry"]) {
      const f = await fixture(); f.options.reply = record => {
        if (kind === "retry") { delete record.replayed; return; }
        const proof = JSON.parse(record.proofText);
        if (kind === "proof") proof.choiceSha256 = "0".repeat(64);
        if (kind === "output") { record.outputText += " "; record.outputSha256 = hash(record.outputText); proof.outputSha256 = record.outputSha256; }
        record.proofText = JSON.stringify(proof); record.proofSha256 = hash(record.proofText);
      };
      await expect(f.save()).rejects.toThrow("differs from reconstructed originals");
    }
  });
});

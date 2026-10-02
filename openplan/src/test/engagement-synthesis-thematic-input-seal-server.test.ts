// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { loadSynthesisThematicInputInventory, retainSynthesisThematicInputSeal } from "@/lib/engagement/synthesis-thematic-input-seal-server";
import { thematicInputManifestFixture } from "./fixtures/engagement/synthesis-thematic-input-manifest";
import { makeSourceSnapshot, sourceHash as hash } from "./fixtures/engagement/synthesis-source";

function fixture(count = 301) {
  const f = thematicInputManifestFixture(makeSourceSnapshot(count)), controller = new AbortController();
  type Seal = ReturnType<typeof f.makeSeal>;
  let stored: Seal | null = null;
  const { snapshotText: _snapshotText, ...reference } = f.source;
  const basePage = { schemaVersion: 1, ...f.scope, thematic: f.request, source: reference,
    afterTargetRecordId: null as string | null, hasMore: false, entries: [] as typeof f.entries, seal: null as Seal | null };
  const options = { pageSize: 128, denyPage: 0, pageReads: 0, failSource: false, abortSource: false,
    lostSeal: false, abortSeal: false, abortPage: 0,
    sourcePatch: {} as Record<string, unknown>, changePage: null as null | ((page: typeof basePage, count: number) => void),
    changeSeal: null as null | ((seal: Seal) => void) };
  const calls: Array<{ name: string; args: Record<string, unknown>; signal?: AbortSignal }> = [];
  const trace: Array<{ table: string; columns: string; key?: string; value?: unknown; signal?: AbortSignal }> = [];
  const rpc = (name: string, args: Record<string, unknown>) => {
    const call = { name, args, signal: undefined as AbortSignal | undefined }; calls.push(call);
    const result = (async () => {
      if (name === "read_engagement_synthesis_thematic_input_inventory") {
        options.pageReads++;
        const remaining = f.entries.filter(row => args.p_after_target === null || row.targetRecordId > String(args.p_after_target));
        const limit = Math.min(Number(args.p_limit), options.pageSize), data = structuredClone({ ...basePage,
          thematic: f.request, afterTargetRecordId: args.p_after_target as string | null,
          entries: remaining.slice(0, limit), hasMore: remaining.length > limit, seal: stored });
        options.changePage?.(data, options.pageReads);
        if (options.abortPage === options.pageReads) controller.abort();
        return { data, error: options.denyPage === options.pageReads ? { code: "42501" } : null };
      }
      if (name === "seal_engagement_synthesis_thematic_inputs") {
        const expected = f.build(); if (args.p_manifest_text !== expected.manifestText) throw new Error("Unexpected submitted manifest");
        stored ??= f.makeSeal(expected); const data = structuredClone(stored); options.changeSeal?.(data);
        if (options.abortSeal) controller.abort();
        return { data, error: options.lostSeal ? { code: "PT503" } : null };
      }
      throw new Error(`Unexpected seal RPC ${name}`);
    })();
    return Object.assign(result, { abortSignal(signal: AbortSignal) { call.signal = signal; return result; } });
  };
  const from = (table: string) => {
    const call = { table, columns: "", key: "", value: undefined as unknown, signal: undefined as AbortSignal | undefined }; trace.push(call);
    const query = { select(columns: string) { call.columns = columns; return query; }, eq(key: string, value: unknown) { call.key = key; call.value = value; return query; },
      abortSignal(signal: AbortSignal) { call.signal = signal; return query; }, async maybeSingle() {
        if (options.abortSource) controller.abort();
        const row: Record<string, unknown> = { id: f.source.requestId, campaign_id: f.scope.campaignId, workspace_id: f.scope.workspaceId,
          snapshot_text: f.source.snapshotText, snapshot_sha256: f.source.snapshotSha256, created_at: f.source.createdAt, ...options.sourcePatch };
        return { data: Object.fromEntries(call.columns.split(",").map(column => [column, row[column]])), error: options.failSource ? { code: "42501" } : null };
      } };
    return query;
  };
  const service = { rpc, from } as unknown as Pick<SupabaseClient, "rpc" | "from">;
  return { f, controller, options, calls, trace, service, read: () => loadSynthesisThematicInputInventory(service, f.scope, controller.signal),
    seal: () => retainSynthesisThematicInputSeal(service, f.scope, controller.signal) };
}

describe("thematic complete-source seal service", () => {
  it("reads every bounded page, rechecks scope and submits the independently computed manifest", async () => {
    const f = fixture(), result = await f.seal();
    expect(result.plan.manifestText).toBe(f.f.build().manifestText); expect(result.plan.manifest.inputCount).toBe(302);
    expect(result.seal.manifestSha256).toBe(result.plan.manifestSha256);
    expect(f.calls.filter(call => call.name.endsWith("_inventory")).map(call => call.args)).toEqual([
      { p_request: f.f.scope.requestId, p_after_target: null, p_limit: 128 },
      { p_request: f.f.scope.requestId, p_after_target: f.f.entries[127].targetRecordId, p_limit: 128 },
      { p_request: f.f.scope.requestId, p_after_target: f.f.entries[255].targetRecordId, p_limit: 128 },
      { p_request: f.f.scope.requestId, p_after_target: f.f.entries[301].targetRecordId, p_limit: 1 },
    ]);
    expect(f.trace).toEqual([{ table: "engagement_synthesis_sources", columns: "id,campaign_id,workspace_id,snapshot_text,snapshot_sha256,created_at",
      key: "id", value: f.f.source.requestId, signal: expect.any(AbortSignal) }]);
    expect(f.calls.every(call => call.signal instanceof AbortSignal)).toBe(true);
    expect(f.calls.at(-1)?.name).toBe("seal_engagement_synthesis_thematic_inputs");
  });
  it("recovers an unconfirmed seal after cancellation without another write", async () => {
    const f = fixture(1); f.options.lostSeal = true;
    await expect(f.seal()).rejects.toThrow("seal save unconfirmed"); f.f.request.cancellation = { retained: true };
    const recovered = await f.seal(); expect(recovered.seal.manifestText).toBe(f.f.build().manifestText);
    expect(f.calls.filter(call => call.name.startsWith("seal_")).length).toBe(1);
  });
  it("keeps an incomplete inventory inspectable but refuses to seal it", async () => {
    const f = fixture(1); f.f.entries.pop(); const inventory = await f.read(); expect(inventory.entries).toHaveLength(1);
    await expect(f.seal()).rejects.toThrow("membership is incomplete or differs"); expect(f.calls.every(call => !call.name.startsWith("seal_"))).toBe(true);
  });
  it("refuses fresh sealing after cancellation arrives during source inspection", async () => {
    const f = fixture(1); f.options.changePage = (page, count) => { if (count === 2) page.thematic.cancellation = { retained: true }; };
    await expect(f.seal()).rejects.toThrow("sealing was cancelled"); expect(f.calls.every(call => !call.name.startsWith("seal_"))).toBe(true);
  });
  it.each([1, 2])("refuses denied native scope at read %s", async denyPage => {
    const f = fixture(1); f.options.denyPage = denyPage;
    await expect(f.seal()).rejects.toThrow("inventory unavailable"); expect(f.calls.every(call => !call.name.startsWith("seal_"))).toBe(true);
    expect(f.trace.length).toBe(denyPage === 1 ? 0 : 1);
  });
  it("refuses wrong page identity, cursor, empty continuation and excess entries", async () => {
    const patches: Array<(page: Parameters<NonNullable<ReturnType<typeof fixture>["options"]["changePage"]>>[0]) => void> = [
      page => { page.requestId = randomUUID(); }, page => { page.campaignId = randomUUID(); }, page => { page.workspaceId = randomUUID(); },
      page => { page.afterTargetRecordId = `item:${randomUUID()}`; }, page => { page.entries = []; page.hasMore = true; },
      page => { page.entries = Array.from({ length: 129 }, () => page.entries[0]); },
    ];
    for (const patch of patches) { const f = fixture(1); f.options.denyPage = 2; f.options.changePage = page => patch(page);
      await expect(f.read()).rejects.toThrow(); expect(f.trace).toEqual([]); }
  });
  it.each(["requestId", "snapshotSha256", "campaignId", "workspaceId"] as const)("refuses a substituted native source reference %s before private access", async key => {
    const f = fixture(1); f.options.changePage = page => { page.source[key] = key === "snapshotSha256" ? "0".repeat(64) : randomUUID(); };
    await expect(f.read()).rejects.toThrow("inventory identity differs"); expect(f.trace).toEqual([]);
  });
  it("enforces the smaller final recheck limit", async () => {
    const f = fixture(1); f.options.changePage = (page, count) => { if (count === 2) page.entries = f.f.entries; };
    await expect(f.read()).rejects.toThrow("inventory identity differs");
  });
  it("refuses duplicated, reversed and newly appearing tail entries", async () => {
    for (const kind of ["duplicate", "reversed", "new-tail"]) {
      const f = fixture(1); f.options.changePage = (page, count) => {
        if (kind === "duplicate" && count === 1) page.entries[1] = page.entries[0];
        if (kind === "reversed" && count === 1) page.entries.reverse();
        if (kind === "new-tail" && count === 2) page.entries = [f.f.entries[1]];
      };
      await expect(f.seal()).rejects.toThrow(kind === "new-tail" ? "changed while reading" : "inventory identity differs");
      expect(f.calls.every(call => !call.name.startsWith("seal_"))).toBe(true);
    }
  });
  it("refuses changed request, binding, source identity or disappearing historical cancellation", async () => {
    for (const kind of ["request", "binding", "source", "cancellation"]) {
      const f = fixture(1); if (kind === "cancellation") f.f.request.cancellation = { retained: true };
      f.options.changePage = (page, count) => {
        if (count !== 2) return;
        if (kind === "request") page.thematic.request.actorId = randomUUID();
        if (kind === "binding") { const value = JSON.parse(page.thematic.thematic.thematicText); value.frameByteLimit = 8192;
          page.thematic.thematic.thematicText = JSON.stringify(value); page.thematic.thematic.thematicSha256 = hash(page.thematic.thematic.thematicText); }
        if (kind === "source") page.source.createdAt = "2026-01-03T00:00:00Z";
        if (kind === "cancellation") page.thematic.cancellation = null;
      };
      await expect(f.read()).rejects.toThrow("inventory identity differs");
    }
  });
  it.each(["id", "campaign_id", "workspace_id", "snapshot_sha256", "snapshot_text", "created_at"])("refuses changed private source %s", async key => {
    const f = fixture(1); f.options.sourcePatch = { [key]: key === "snapshot_sha256" ? "0".repeat(64) : key === "snapshot_text" ? "{}" : key === "created_at" ? "2026-01-03T00:00:00Z" : randomUUID() };
    await expect(f.read()).rejects.toThrow(key === "snapshot_text" ? "checksum differs" : "inventory identity differs");
  });
  it("refuses unavailable source and interrupted reads or seal writes", async () => {
    const missing = fixture(1); missing.options.failSource = true; await expect(missing.read()).rejects.toThrow("source unavailable");
    for (const kind of ["early", "source", "page", "seal"]) {
      const f = fixture(1); if (kind === "early") f.controller.abort(); if (kind === "source") f.options.abortSource = true;
      if (kind === "page") f.options.abortPage = 2; if (kind === "seal") f.options.abortSeal = true;
      await expect(f.seal()).rejects.toThrow();
    }
  });
  it("refuses substituted stored or returned seals and disappearing seals", async () => {
    const f = fixture(1); f.options.changeSeal = seal => { seal.manifestSha256 = "0".repeat(64); };
    await expect(f.seal()).rejects.toThrow("seal differs");
    f.options.changeSeal = null; f.options.pageReads = 0;
    f.options.changePage = (page, count) => { if (count === 2) page.seal = null; };
    await expect(f.seal()).rejects.toThrow("inventory identity differs");
    f.options.pageReads = 0; f.options.changePage = page => { page.seal!.receiptSha256 = "0".repeat(64); };
    await expect(f.seal()).rejects.toThrow("seal differs");
  });
});

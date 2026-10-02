// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySynthesisThematicPreparation } from "@/lib/engagement/synthesis-thematic-preparation-server";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";
import { synthesisThematicPreparationFixture as fixture } from "./fixtures/engagement/synthesis-thematic-preparation";

describe("explicit thematic worker preparation", () => {
  it("checks every native dependency before replay", async () => {
    const f = await fixture();
    const cases: Array<(packet: typeof f.bundle) => void> = [
      p => { p.thematic.cancellation = {}; }, p => { p.choice.createdBy = randomUUID(); },
      p => { p.parent.campaignId = randomUUID(); }, p => { p.parent.workspaceId = randomUUID(); }, p => {
        const parentId = randomUUID(); p.parent.request.id = parentId;
        const binding = JSON.parse(p.context.context.contextText); binding.parentRequestId = parentId;
        p.context.context.parentRequestId = parentId; p.context.context.contextText = JSON.stringify(binding);
        p.context.context.contextSha256 = hash(p.context.context.contextText);
      },
      p => { p.parent.request.intentSha256 = "0".repeat(64); },
      p => { const value = randomUUID(); p.source.requestId = value;
        for (const request of [p.parent.request, p.context.request]) { const intent = JSON.parse(request.intentText); intent.sourceId = value;
          request.intentText = JSON.stringify(intent); request.intentSha256 = hash(request.intentText); } }, p => { p.source.campaignId = randomUUID(); }, p => { p.source.workspaceId = randomUUID(); },
      p => { const value = "0".repeat(64); p.source.snapshotSha256 = value;
        for (const request of [p.parent.request, p.context.request]) { const intent = JSON.parse(request.intentText); intent.sourceSha256 = value;
          request.intentText = JSON.stringify(intent); request.intentSha256 = hash(request.intentText); } },
    ];
    for (const kind of ["parent", "context"] as const) for (const key of ["sourceId", "sourceSha256"]) cases.push(p => {
      const intent = JSON.parse(p[kind].request.intentText); intent[key] = key === "sourceId" ? randomUUID() : "0".repeat(64);
      p[kind].request.intentText = JSON.stringify(intent); p[kind].request.intentSha256 = hash(p[kind].request.intentText);
    });
    for (const key of ["parentRequestId", "selectionSequence", "segmentResultsManifestSha256", "contextManifestSha256", "targetRecordId"]) cases.push(p => {
      const binding = JSON.parse(p.context.context.contextText);
      binding[key] = key === "parentRequestId" ? randomUUID() : key === "selectionSequence" ? 0 : key === "targetRecordId" ? `item:${randomUUID()}` : "0".repeat(64);
      if (key === "parentRequestId") p.context.context.parentRequestId = binding[key];
      p.context.context.contextText = JSON.stringify(binding); p.context.context.contextSha256 = hash(p.context.context.contextText);
    });
    for (const change of cases) {
      const packet = structuredClone(f.bundle); change(packet);
      expect(() => verifySynthesisThematicPreparation(packet, f.scope)).toThrow("Thematic preparation differs");
    }
  });
  it("replays bounded pages with the native dependency anchors", async () => {
    const f = await fixture(); f.f.historyOptions.pageSize = 1;
    expect((await f.load()).history.sha256).toBe(f.expected.sha256);
    const pages = f.calls.filter(call => call.parameters.p_stage === "context");
    expect(pages.length).toBe(f.f.history.length);
    expect(pages.map(call => call.parameters.p_after_task_index)).toEqual(f.f.history.map((_, index) => index - 1));
    expect(pages.every(call => call.parameters.p_request === f.scope.requestId && call.parameters.p_target === f.scope.targetRecordId
      && !("p_through_sequence" in call.parameters))).toBe(true);
  });

  it("reconstructs the identical pinned original through named native delegation", async () => {
    const f = await fixture(), result = await f.load();
    expect(result.history.canonical).toBe(f.expected.canonical); expect(result.history.finalOutputText).toBe(f.expected.finalOutputText);
    expect(result.delegation.thematic.state.request.actorId).not.toBe(result.history.request.state.request.actorId);
    expect(result.source.snapshotText).toBe(f.sourceRow.snapshot_text);
    expect(new Set(f.calls.map(call => call.name))).toEqual(new Set(["read_engagement_synthesis_thematic_preparation", "read_engagement_synthesis_thematic_preparation_selections"]));
    expect(f.calls.at(-1)?.name).toBe("read_engagement_synthesis_thematic_preparation"); expect(f.options.reads).toBe(2);
    expect(f.calls.every(call => call.signal instanceof AbortSignal)).toBe(true);
    expect(f.calls.filter(call => call.name.endsWith("_selections")).map(call => call.parameters)).toEqual([
      { p_request: f.scope.requestId, p_target: f.scope.targetRecordId, p_stage: "parent", p_after_task_index: -1, p_limit: 128 },
      { p_request: f.scope.requestId, p_target: f.scope.targetRecordId, p_stage: "context", p_after_task_index: -1, p_limit: 128 },
    ]);
    expect(f.f.trace.find(row => row.table === "engagement_synthesis_sources")).toMatchObject({
      columns: "id,campaign_id,workspace_id,snapshot_text,snapshot_sha256,created_at", filters: { id: f.sourceRow.id }, signal: expect.any(AbortSignal) });
    expect(f.f.trace.some(row => /credential|connection/.test(row.table))).toBe(false);
  });
  it.each(["historyManifestSha256", "finalCaptureSha256", "finalResultSha256"])("refuses a self-hashed wrong pinned %s", async key => {
    const f = await fixture(); f.patchChoice({ [key]: "0".repeat(64) });
    await expect(f.load()).rejects.toThrow("differs from its pinned originals");
  });
  it("refuses incomplete originals and a different selected sequence", async () => {
    const f = await fixture(); f.f.rows.set("engagement_synthesis_generation_outputs", []);
    await expect(f.load()).rejects.toThrow();
    const sequence = await fixture(); sequence.patchChoice({ selectionSequence: 0 });
    await expect(sequence.load()).rejects.toThrow("Historical context execution differs");
  });
  it.each(["requestId", "campaignId", "workspaceId", "targetRecordId"] as const)("refuses a different caller %s", async key => {
    const f = await fixture(); f.scope[key] = key === "targetRecordId" ? `item:${randomUUID()}` : randomUUID();
    await expect(f.load()).rejects.toThrow(); expect(f.f.trace).toEqual([]);
  });
  it("refuses cancellation, another choice author and mismatched native identities before private reads", async () => {
    const changes: Array<(bundle: Awaited<ReturnType<typeof fixture>>["bundle"]) => void> = [
      p => { p.thematic.cancellation = {}; }, p => { p.choice.createdBy = randomUUID(); },
      p => { p.source.campaignId = randomUUID(); }, p => { p.source.workspaceId = randomUUID(); },
      p => { p.source.requestId = randomUUID(); }, p => { p.source.snapshotSha256 = "0".repeat(64); },
      p => { p.parent.request.actorId = "invalid"; }, p => { p.parent.request.intentSha256 = "0".repeat(64); },
      p => { p.parent.campaignId = randomUUID(); }, p => { p.parent.workspaceId = randomUUID(); }, p => { p.parent.request.id = randomUUID(); },
    ];
    for (const change of changes) { const f = await fixture(); f.options.change = change; await expect(f.load()).rejects.toThrow(); expect(f.f.trace).toEqual([]); }
  });
  it.each(["id", "campaign_id", "workspace_id", "snapshot_sha256", "created_at", "snapshot_text"] as const)("refuses altered private source %s", async key => {
    const f = await fixture(); const value = key === "created_at" ? "2026-01-01T00:00:00Z" : key === "snapshot_sha256" ? "0".repeat(64) : key === "snapshot_text" ? "{}" : randomUUID();
    f.f.options.returnedPatch = { table: "engagement_synthesis_sources", patch: { [key]: value } };
    await expect(f.load()).rejects.toThrow(key === "snapshot_text" ? "checksum differs" : "Thematic preparation differs");
  });
  it("rechecks authority after private replay and permits original cancellation history to arrive", async () => {
    const f = await fixture(); f.options.denyRead = 2;
    await expect(f.load()).rejects.toThrow("preparation access unavailable"); expect(f.f.trace.length).toBeGreaterThan(0);
    const cancellation = await fixture(); cancellation.options.before = name => {
      if (name === "read_engagement_synthesis_thematic_preparation" && cancellation.options.reads === 1) cancellation.f.cancel();
    };
    const result = await cancellation.load(); expect(result.history.request.cancellation).not.toBeNull(); expect(result.history.sha256).toBe(cancellation.expected.sha256);
  });
  it("refuses changed originals on final access check", async () => {
    const f = await fixture(); f.options.change = packet => {
      if (f.options.reads === 2) packet.choice.createdAt = "2026-01-01T00:00:00Z";
    };
    await expect(f.load()).rejects.toThrow("preparation differs");
  });
  it("refuses unavailable or interrupted private source reads", async () => {
    const f = await fixture(); f.f.options.failTable = "engagement_synthesis_sources";
    await expect(f.load()).rejects.toThrow("preparation source unavailable");
    const aborted = await fixture(); aborted.f.options.abortTable = "engagement_synthesis_sources";
    await expect(aborted.load()).rejects.toThrow();
  });
  it("refuses unavailable and aborted delegation or selection reads", async () => {
    for (const name of ["read_engagement_synthesis_thematic_preparation", "read_engagement_synthesis_thematic_preparation_selections"]) {
      const f = await fixture(); f.options.deny = name; await expect(f.load()).rejects.toThrow();
      const aborted = await fixture(); aborted.options.abortAt = name; await expect(aborted.load()).rejects.toThrow();
    }
    const f = await fixture(); f.f.controller.abort(); await expect(f.load()).rejects.toThrow(); expect(f.calls).toEqual([]);
  });
});

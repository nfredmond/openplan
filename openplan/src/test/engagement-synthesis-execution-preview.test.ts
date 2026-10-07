import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { readSynthesisExecutionPreview } from "@/lib/engagement/synthesis-execution-preview-server";

const id = (n: number) => `c7200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const date = "2026-10-02T12:00:00.000Z";
type Stage = "segment" | "context" | "thematic";
const scope = { campaignId: id(1), workspaceId: id(2), requestId: id(3) };
function fixture(stage: Stage = "segment") {
  const configuration = { label: "SYNTHETIC provider", protocol: "openai_chat_completions", endpoint: "https://provider.invalid/v1/",
    modelIds: ["synthetic"], structuredOutput: true, authMode: "none", timeoutSeconds: 30 };
  const canonical = JSON.stringify(configuration);
  const intent = { schemaVersion: 1, sourceId: id(5), sourceSha256: "a".repeat(64), connectionId: id(6),
    configurationRevisionId: id(7), configurationHash: hash(canonical), modelId: "synthetic", taskByteLimit: 4096 };
  const intentText = JSON.stringify(intent);
  const request = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId,
    request: { id: scope.requestId, actorId: id(4), intentText, intentSha256: hash(intentText), createdAt: date }, cancellation: null };
  const segment = stage === "segment", thematic = stage === "thematic";
  const header = { schemaVersion: 1, purpose: segment ? "private_synthesis_segment_plan" : `private_synthesis_${stage}_frame_plan`,
    requestId: scope.requestId, intentSha256: hash(intentText), tailSha256: "b".repeat(64),
    ...(segment ? { taskCount: 2, taskBytes: 9000 } : { actorId: id(4), frameCount: 2, frameBytes: 9000 }),
    ...(thematic ? { campaignId: scope.campaignId, workspaceId: scope.workspaceId, taskCount: 3 } : {}) };
  const headerText = JSON.stringify(header), headerSha256 = hash(headerText);
  const seal = { schemaVersion: 1, requestId: scope.requestId, headerSha256, tailSha256: header.tailSha256, sealedAt: date,
    ...(segment ? { taskCount: 2, taskBytes: 9000 } : { frameCount: 2, frameBytes: 9000 }), ...(thematic ? { taskCount: 3 } : {}) };
  const receiptText = JSON.stringify(seal);
  const plan = { schemaVersion: 1, requestId: scope.requestId, headerText, headerSha256, nextIndex: 2,
    tailSha256: header.tailSha256, cancelled: false, ...(segment ? { taskBytes: 9000 } : { frameBytes: 9000 }),
    ...(thematic ? { campaignId: scope.campaignId, workspaceId: scope.workspaceId } : {}),
    seal: { receiptText, receiptSha256: hash(receiptText) } };
  const revision = { id: id(7), connection_id: id(6), workspace_id: scope.workspaceId, configuration,
    configuration_canonical: canonical, configuration_hash: hash(canonical) };
  const connection = { id: id(6), workspace_id: scope.workspaceId, current_revision_id: id(7), revoked_at: null as string | null };
  const rows: Record<string, unknown> = { workspace_provider_api_revisions: revision, workspace_provider_api_connections: connection };
  const trace: Array<{ table: string; columns: string; filters: Record<string, string> }> = [];
  const readRequest = vi.fn(async () => ({ data: request, error: null as null | { code: string } }));
  const clientRpc = vi.fn(() => ({ abortSignal: readRequest }));
  const readPlan = vi.fn(async () => ({ data: plan as unknown, error: null as null | { code: string } }));
  const serviceRpc = vi.fn(() => ({ abortSignal: readPlan }));
  const from = vi.fn((table: string) => ({ select(columns: string) {
    const item = { table, columns, filters: {} as Record<string, string> }; trace.push(item);
    const query = { eq(key: string, value: string) { item.filters[key] = value; return query; },
      abortSignal() { return { single: async () => ({ data: rows[table], error: null }) }; } };
    return query;
  } }));
  const client = { rpc: clientRpc } as unknown as Pick<SupabaseClient, "rpc">;
  const service = { rpc: serviceRpc, from } as unknown as Pick<SupabaseClient, "rpc" | "from">;
  const read = () => readSynthesisExecutionPreview(client, service, { ...scope, stage }, new AbortController().signal);
  return { read, request, intent, header, seal, plan, revision, connection, trace, from, readRequest, clientRpc, readPlan, serviceRpc };
}

describe("bounded staff execution preview", () => {
  it.each(["segment", "context", "thematic"] as const)("shows %s inventory and its original destination without reading credentials or source bytes", async stage => {
    const f = fixture(stage), result = await f.read();
    expect(result).toMatchObject({ ...scope, stage, actorId: id(4), sourceId: id(5), sourceSha256: f.intent.sourceSha256,
      headerSha256: f.plan.headerSha256, sealSha256: f.plan.seal.receiptSha256,
      taskCount: stage === "thematic" ? 3 : 2, inputBytes: 9000, cancelled: false,
      provider: { endpoint: f.revision.configuration.endpoint, modelId: "synthetic", current: true } });
    expect(f.clientRpc.mock.calls).toHaveLength(2);
    expect(f.serviceRpc).toHaveBeenCalledExactlyOnceWith(`read_engagement_synthesis_${stage === "segment" ? "generation" : stage}_plan`, { p_request: scope.requestId });
    expect(f.trace).toEqual([
      { table: "workspace_provider_api_revisions", columns: "id,connection_id,workspace_id,configuration,configuration_canonical,configuration_hash",
        filters: { id: id(7), connection_id: id(6), workspace_id: scope.workspaceId } },
      { table: "workspace_provider_api_connections", columns: "id,workspace_id,current_revision_id,revoked_at",
        filters: { id: id(6), workspace_id: scope.workspaceId } },
    ]);
    expect(JSON.stringify(result)).not.toContain("configuration_canonical");
  });
  it("does not make service reads before current native staff access", async () => {
    const f = fixture(); f.readRequest.mockResolvedValue({ data: f.request, error: { code: "42501" } });
    await expect(f.read()).rejects.toMatchObject({ status: 403 });
    expect(f.serviceRpc).not.toHaveBeenCalled(); expect(f.from).not.toHaveBeenCalled();
  });
  it("refuses disclosure after access is revoked during the private read", async () => {
    const f = fixture(); f.readRequest.mockResolvedValueOnce({ data: f.request, error: null })
      .mockResolvedValueOnce({ data: f.request, error: { code: "42501" } });
    await expect(f.read()).rejects.toMatchObject({ status: 403 });
    expect(f.trace).toHaveLength(2);
  });
  it.each(["header-hash", "seal-hash", "request", "partial", "bytes", "tail"])("refuses inconsistent native plan %s", async kind => {
    const f = fixture();
    if (kind === "header-hash") f.plan.headerSha256 = "d".repeat(64);
    if (kind === "seal-hash") f.plan.seal.receiptSha256 = "d".repeat(64);
    if (kind === "request") f.plan.requestId = id(99);
    if (kind === "partial") f.plan.nextIndex = 1;
    if (kind === "bytes") Object.assign(f.plan, { taskBytes: 1 });
    if (kind === "tail") f.plan.tailSha256 = "d".repeat(64);
    await expect(f.read()).rejects.toThrow(); expect(f.from).not.toHaveBeenCalled();
  });
  it.each(["intentSha256", "purpose", "taskCount"])("refuses rehashed mismatched header %s", async key => {
    const f = fixture(), header = { ...f.header, [key]: key === "taskCount" ? 1 : key === "purpose" ? "other" : "d".repeat(64) };
    f.plan.headerText = JSON.stringify(header); f.plan.headerSha256 = hash(f.plan.headerText);
    const receiptText = JSON.stringify({ ...f.seal, headerSha256: f.plan.headerSha256 });
    f.plan.seal = { receiptText, receiptSha256: hash(receiptText) };
    await expect(f.read()).rejects.toThrow(); expect(f.from).not.toHaveBeenCalled();
  });
  it("keeps an unsealed plan distinct from a zero-task prepared result", async () => {
    const f = fixture(); f.readPlan.mockResolvedValue({ data: { ...f.plan, seal: null }, error: null });
    await expect(f.read()).rejects.toMatchObject({ status: 409 }); expect(f.from).not.toHaveBeenCalled();
  });
  it.each(["revision-id", "revision-workspace", "revision-connection", "configuration-hash", "configuration-bytes", "connection-id", "connection-workspace"])(
    "refuses substituted provider metadata: %s", async kind => {
      const f = fixture();
      if (kind === "revision-id") f.revision.id = id(99);
      if (kind === "revision-workspace") f.revision.workspace_id = id(99);
      if (kind === "revision-connection") f.revision.connection_id = id(99);
      if (kind === "configuration-hash") f.revision.configuration_hash = "d".repeat(64);
      if (kind === "configuration-bytes") f.revision.configuration_canonical += " ";
      if (kind === "connection-id") f.connection.id = id(99);
      if (kind === "connection-workspace") f.connection.workspace_id = id(99);
      await expect(f.read()).rejects.toThrow();
    });
  it.each(["revoked", "new-revision"])("retains the original destination but marks %s unavailable for new authority", async kind => {
    const f = fixture();
    if (kind === "revoked") f.connection.revoked_at = date; else f.connection.current_revision_id = id(99);
    expect((await f.read()).provider).toMatchObject({ current: false, revisionId: id(7), endpoint: f.revision.configuration.endpoint });
  });
  it("retains cancellation in the preview", async () => {
    const f = fixture(); f.plan.cancelled = true;
    expect((await f.read()).cancelled).toBe(true);
  });
  it.each(["campaignId", "workspaceId"] as const)("refuses wrong thematic %s", async key => {
    const f = fixture("thematic"); f.plan[key] = id(99);
    await expect(f.read()).rejects.toThrow(); expect(f.from).not.toHaveBeenCalled();
  });
});

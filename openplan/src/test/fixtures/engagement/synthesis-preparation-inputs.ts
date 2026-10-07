import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";
import type { SynthesisPreparationLease } from "@/lib/engagement/synthesis-preparation-worker";
import { contextInputFixture } from "./synthesis-context";
import { sourceHash, sourceScope, makeSourceSnapshot } from "./synthesis-source";

export function preparationInputsFixture(stage: "segment" | "context" | "thematic" = "segment", count = 1) {
  const f = contextInputFixture(makeSourceSnapshot(count)), scope = f.scope, current = f.request.request;
  const request = { id: scope.requestId, campaign_id: scope.campaignId, workspace_id: scope.workspaceId, actor_id: current.actorId,
    source_id: sourceScope.requestId, intent_text: current.intentText, intent_sha256: current.intentSha256, created_at: current.createdAt };
  const parentIntent = JSON.stringify({ ...JSON.parse(current.intentText), modelId: "synthetic-content", taskByteLimit: 4096 });
  const parent = { ...request, id: f.f.args.job.jobId, actor_id: "a0000000-0000-4000-8000-000000000083", intent_text: parentIntent, intent_sha256: sourceHash(parentIntent) };
  const context = { request_id: scope.requestId, parent_request_id: parent.id, context_text: f.request.context.contextText,
    context_sha256: f.request.context.contextSha256, created_at: current.createdAt };
  const { contentManifestSha256: _content, targetRecordId: _target, ...binding } = JSON.parse(context.context_text);
  const thematicText = JSON.stringify(binding);
  const thematic = { request_id: scope.requestId, parent_request_id: parent.id, thematic_text: thematicText,
    thematic_sha256: sourceHash(thematicText), created_at: current.createdAt };
  const source = { id: sourceScope.requestId, campaign_id: scope.campaignId, workspace_id: scope.workspaceId,
    snapshot_text: f.f.args.saved.snapshotText, snapshot_sha256: f.f.args.saved.snapshotSha256, created_at: f.f.args.saved.createdAt };
  const token = "a0000000-0000-4000-8000-000000000084";
  const lease: SynthesisPreparationLease = { schemaVersion: 1, ...scope, actorId: current.actorId, intentSha256: current.intentSha256,
    stage, status: "running", attempts: 1, leaseUntil: "2026-10-03T02:02:00Z", leaseToken: token, failureCode: null, sealSha256: null,
    cancelled: false, createdAt: "2026-10-03T02:00:00Z", updatedAt: "2026-10-03T02:00:00Z", active: true,
    claim: { token, request_id: scope.requestId, attempt: 1, claimed_at: "2026-10-03T02:00:00Z", initial_lease_until: "2026-10-03T02:02:00Z" } };
  const rows = new Map<string, unknown>([
    [`engagement_synthesis_generation_requests:${request.id}`, request], [`engagement_synthesis_generation_requests:${parent.id}`, parent],
    [`engagement_synthesis_context_requests:${scope.requestId}`, stage === "context" ? context : null],
    [`engagement_synthesis_thematic_requests:${scope.requestId}`, stage === "thematic" ? thematic : null],
    [`engagement_synthesis_sources:${source.id}`, source],
  ]);
  const trace: Array<{ table: string; columns: string; key: string; value: unknown; signal?: AbortSignal }> = [];
  const response = vi.fn(async (table: string, value: unknown, _signal: AbortSignal): Promise<{ data: unknown; error: unknown }> => ({ data: rows.get(`${table}:${value}`) ?? null, error: null }));
  const from = vi.fn((table: string) => {
    const entry = { table, columns: "", key: "", value: undefined as unknown, signal: undefined as AbortSignal | undefined }; trace.push(entry);
    const query = { select(columns: string) { entry.columns = columns; return query; }, eq(key: string, value: unknown) { entry.key = key; entry.value = value; return query; },
      abortSignal(signal: AbortSignal) { entry.signal = signal; return query; }, maybeSingle() { return response(table, entry.value, entry.signal!); } };
    return query;
  });
  const renewal = vi.fn(async (_name: string, _parameters: Record<string, unknown>, _signal: AbortSignal): Promise<{ data: unknown; error: unknown }> => ({ data: structuredClone(lease), error: null }));
  const rpc = vi.fn((name: string, parameters: Record<string, unknown>) => ({ abortSignal: (signal: AbortSignal) => renewal(name, parameters, signal) }));
  const service = { from, rpc } as unknown as Pick<SupabaseClient, "from" | "rpc">;
  return { f, scope, request, parent, context, thematic, source, lease, rows, trace, response, from, renewal, rpc, service };
}

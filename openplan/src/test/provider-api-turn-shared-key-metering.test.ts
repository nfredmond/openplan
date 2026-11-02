/**
 * A Planner Agent API task paid by the deployment's shared key is metered
 * BEFORE the provider call, through the real limiter (ai-rate-limit.ts), and
 * makes no call when the usage lookup or the usage record fails
 * (KI-2026-10-12-014). Until 2026-11-01 this path recorded its usage event
 * with a best-effort insert whose failure it ignored, so a broken insert let
 * every shared-key call through unmetered.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runProviderApiTurn } from "@/lib/assistant/provider-api-turn";
import { retainedProviderTurnSchema, type ProviderService, type ProviderUserClient } from "@/lib/assistant/provider-server";
import { providerProjectPacketSchema } from "@/lib/assistant/provider-project-task";

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  keySource: vi.fn(),
  count: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("ai", () => ({ generateText: mocks.generate, Output: { object: (value: unknown) => value } }));
vi.mock("@/lib/integrations/anthropic-access", () => ({ anthropicModel: () => ({ fixture: true }), anthropicKeySource: mocks.keySource }));
vi.mock("@/lib/integrations/workspace-keys", () => ({
  listWorkspaceIntegrationKeyMetadata: async () => [],
  withWorkspaceIntegrationContext: (_workspace: string, fn: () => unknown) => fn(),
}));
// The limiter's own service client. reserve_ai_usage plays the SQL function
// (20261102110000) on the same count and insert mocks: count, refuse at the
// limit, else insert; a count or insert error is the function's error.
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table !== "usage_events") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({ eq: () => ({ in: () => ({ gte: mocks.count }) }) }),
        insert: mocks.insert,
      };
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn !== "reserve_ai_usage") throw new Error(`unexpected function ${fn}`);
      const counted = await mocks.count();
      if (counted.error) return { data: null, error: counted.error };
      if (counted.count >= (args.p_max_per_window as number)) return { data: { allowed: false, count: counted.count }, error: null };
      const inserted = await mocks.insert({ workspace_id: args.p_workspace_id, bucket_key: args.p_bucket_key, event_key: args.p_event_key,
        weight: 1, source_route: args.p_source_route, metadata_json: args.p_metadata });
      if (inserted.error) return { data: null, error: inserted.error };
      return { data: { allowed: true, count: counted.count }, error: null };
    },
  }),
}));

const id = "11111111-1111-4111-8111-111111111111", workspace = "22222222-2222-4222-8222-222222222222", project = "33333333-3333-4333-8333-333333333333", requestId = "44444444-4444-4444-8444-444444444444", attempt = "55555555-5555-4555-8555-555555555555", owner = "66666666-6666-4666-8666-666666666666";
const packet = providerProjectPacketSchema.parse({ version: 1, workspaceId: workspace, project: { id: project, name: "SYNTHETIC project", summary: null, status: "active", planType: "corridor", deliveryPhase: "planning", updatedAt: "2026-09-10T00:00:00Z" }, capturedAt: "2026-09-10T01:00:00Z", source: { id: `project:${project}`, label: "SYNTHETIC project", href: `/projects/${project}` } });
const canonical = JSON.stringify(packet);
const turn = retainedProviderTurnSchema.options[0].parse({ id, request_id: requestId, workspace_id: workspace, project_id: project, connection_id: null, provider: "anthropic", model_id: "fixture-api-model", auth_mode: "deployment_api_key", question: "What is known?", packet_canonical: canonical, packet_hash: createHash("sha256").update(canonical).digest("hex"), state: "running", attempt_id: attempt, lease_expires_at: "2099-01-01T00:00:00Z", result: null, provider_receipt: null, failure_code: null, created_at: "2026-09-10T01:00:00Z", started_at: "2026-09-10T01:00:00Z", finished_at: null });
const output = { answer: "The cost is not supplied.", citations: [`project:${project}`], submittal: null };

function run() {
  const read = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { id, state: "running", attempt_id: attempt }, error: null }) };
  read.select.mockReturnValue(read); read.eq.mockReturnValue(read);
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => ({ data: { ...turn, state: args.p_failure_code ? "failed" : "succeeded", result: args.p_result, provider_receipt: args.p_provider_receipt, failure_code: args.p_failure_code, finished_at: "2026-09-10T01:01:00Z" }, error: null }));
  return runProviderApiTurn({ service: { rpc } as unknown as ProviderService, client: { from: () => read } as unknown as ProviderUserClient,
    userId: owner, turn, signal: new AbortController().signal });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.keySource.mockReturnValue("env");
  mocks.count.mockResolvedValue({ count: 0, error: null });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.generate.mockResolvedValue({ finishReason: "stop", output, response: { id: "fixture-api-response", modelId: "fixture-api-model" }, usage: { inputTokens: 1, outputTokens: 1 } });
});

describe("a shared-key Planner Agent API task and the AI usage meter", () => {
  it("records the usage event, then calls the provider", async () => {
    const saved = await run();
    expect(saved.state).toBe("succeeded");
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: workspace, bucket_key: "assistant_chat", event_key: id }));
    expect(mocks.insert.mock.invocationCallOrder[0]).toBeLessThan(mocks.generate.mock.invocationCallOrder[0]);
  });

  it("makes no call when the usage event cannot be recorded", async () => {
    mocks.insert.mockResolvedValue({ error: { message: "insert refused" } });
    const saved = await run();
    expect(saved.failure_code).toBe("provider_api_failed");
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("makes no call when recent usage cannot be counted", async () => {
    mocks.count.mockResolvedValue({ count: null, error: { message: "count failed" } });
    const saved = await run();
    expect(saved.failure_code).toBe("provider_api_failed");
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runProviderApiTurn, withExactProviderApiMode } from "@/lib/assistant/provider-api-turn";
import { retainedProviderTurnSchema, type ProviderService, type ProviderUserClient } from "@/lib/assistant/provider-server";
import { parseProviderProjectAnswer, providerProjectPacketSchema } from "@/lib/assistant/provider-project-task";

const mocks = vi.hoisted(() => ({ generate: vi.fn(), model: vi.fn(), keySource: vi.fn(), metadata: vi.fn(), context: vi.fn(), rate: vi.fn(), usage: vi.fn() }));
vi.mock("ai", () => ({ generateText: mocks.generate, Output: { object: (value: unknown) => value } }));
vi.mock("@/lib/integrations/anthropic-access", () => ({ anthropicModel: mocks.model, anthropicKeySource: mocks.keySource }));
vi.mock("@/lib/integrations/workspace-keys", () => ({ listWorkspaceIntegrationKeyMetadata: mocks.metadata, withWorkspaceIntegrationContext: mocks.context }));
vi.mock("@/lib/runtime/ai-rate-limit", () => ({ checkAiUsageRateLimit: mocks.rate, recordAiUsageEvent: mocks.usage }));

const id = "11111111-1111-4111-8111-111111111111", workspace = "22222222-2222-4222-8222-222222222222", project = "33333333-3333-4333-8333-333333333333", requestId = "44444444-4444-4444-8444-444444444444", attempt = "55555555-5555-4555-8555-555555555555", owner = "66666666-6666-4666-8666-666666666666";
const packet = providerProjectPacketSchema.parse({ version: 1, workspaceId: workspace, project: { id: project, name: "SYNTHETIC project", summary: null, status: "active", planType: "corridor", deliveryPhase: "planning", updatedAt: "2026-09-10T00:00:00Z" }, capturedAt: "2026-09-10T01:00:00Z", source: { id: `project:${project}`, label: "SYNTHETIC project", href: `/projects/${project}` } });
const canonical = JSON.stringify(packet);
const original = retainedProviderTurnSchema.parse({ id, request_id: requestId, workspace_id: workspace, project_id: project, connection_id: null, provider: "anthropic", model_id: "fixture-api-model", auth_mode: "workspace_api_key", question: "What is known?", packet_canonical: canonical, packet_hash: createHash("sha256").update(canonical).digest("hex"), state: "running", attempt_id: attempt, lease_expires_at: "2099-01-01T00:00:00Z", result: null, provider_receipt: null, failure_code: null, created_at: "2026-09-10T01:00:00Z", started_at: "2026-09-10T01:00:00Z", finished_at: null });
const output = { answer: "The cost is not supplied.", citations: [`project:${project}`], submittal: null };
const generated = () => ({ finishReason: "stop", output, response: { id: "fixture-api-response", modelId: original.model_id }, usage: { inputTokens: 100, outputTokens: 50 } });
let rpc: ReturnType<typeof vi.fn>, select: ReturnType<typeof vi.fn>, eq: ReturnType<typeof vi.fn>, read: ReturnType<typeof vi.fn>;
function run(overrides: Partial<Parameters<typeof runProviderApiTurn>[0]> = {}) {
  return runProviderApiTurn({ service: { rpc } as unknown as ProviderService,
    client: { from: () => ({ select, eq, maybeSingle: read }) } as unknown as ProviderUserClient,
    userId: owner, turn: original, signal: new AbortController().signal, ...overrides });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.model.mockReturnValue({ fixture: true }); mocks.keySource.mockReturnValue("workspace");
  mocks.metadata.mockResolvedValue([{ provider: "anthropic" }]); mocks.context.mockImplementation((_workspace, fn) => fn());
  mocks.rate.mockResolvedValue({ allowed: true }); mocks.usage.mockResolvedValue(undefined); mocks.generate.mockResolvedValue(generated());
  const q = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { id, state: "running", attempt_id: attempt }, error: null }) };
  q.select.mockReturnValue(q); q.eq.mockReturnValue(q); select = q.select; eq = q.eq; read = q.maybeSingle;
  rpc = vi.fn(async (_name, args) => ({ data: { ...original, state: args.p_failure_code ? "failed" : "succeeded", result: args.p_result, provider_receipt: args.p_provider_receipt, failure_code: args.p_failure_code, finished_at: "2026-09-10T01:01:00Z" }, error: null }));
});

describe("one-shot direct API project task", () => {
  it("uses the selected model and same project schema, disables retries and retains its result", async () => {
    const saved = await run();
    expect(saved.state).toBe("succeeded"); expect(saved.result).toEqual(parseProviderProjectAnswer(packet, output));
    expect(mocks.model).toHaveBeenCalledWith("fixture-api-model"); expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ maxRetries: 0, maxOutputTokens: 4000 });
    expect(mocks.generate.mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(mocks.generate.mock.calls[0][0].prompt).selectedProjectRecord).toEqual(packet);
    expect(mocks.generate.mock.calls[0][0].output.schema.safeParse({ ...output, citations: ["private:other"] }).success).toBe(false);
    expect(select).toHaveBeenCalledWith("id,state,attempt_id"); expect(eq).toHaveBeenCalledWith("user_id", owner); expect(eq).toHaveBeenCalledWith("id", id);
    expect(mocks.usage).toHaveBeenCalledWith(expect.objectContaining({ eventKey: id, workspaceId: workspace }));
    expect(rpc).toHaveBeenCalledWith("finish_assistant_provider_turn", expect.objectContaining({ p_turn_id: id, p_attempt_id: attempt, p_user_id: owner, p_connection_id: null, p_token_hash: null }));
    expect(saved.provider_receipt).toMatchObject({ provider: "anthropic", model: "fixture-api-model", authMode: "workspace_api_key", inputTokens: 100, outputTokens: 50 });
  });
  it("allows an explicitly selected deployment key only when no workspace key is stored", async () => {
    mocks.metadata.mockResolvedValue([]); mocks.keySource.mockReturnValue("env");
    const saved = await run({ turn: { ...original, auth_mode: "deployment_api_key" } });
    expect(saved.state).toBe("succeeded"); expect(mocks.generate).toHaveBeenCalledOnce();
  });
  it.each(["env", null])("refuses a failed workspace key load instead of falling back to %s", async source => {
    mocks.keySource.mockReturnValue(source);
    const saved = await run(); expect(saved.state).toBe("failed"); expect(mocks.generate).not.toHaveBeenCalled(); expect(saved.result).toBeNull();
  });
  it("refuses a new stored workspace key when the user selected deployment billing", async () => {
    const saved = await run({ turn: { ...original, auth_mode: "deployment_api_key" } });
    expect(saved.failure_code).toBe("provider_auth_mode_changed"); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("refuses deployment fallback when a stored workspace key cannot be loaded", async () => {
    mocks.keySource.mockReturnValue("env");
    const saved = await run({ turn: { ...original, auth_mode: "deployment_api_key" } });
    expect(saved.failure_code).toBe("provider_auth_mode_changed"); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("fails closed on key metadata lookup errors and redacts their contents", async () => {
    mocks.metadata.mockRejectedValue(new Error("PRIVATE_KEY_FAILURE_CANARY"));
    const saved = await run(); expect(saved.state).toBe("failed"); expect(saved.failure_code).toBe("provider_api_failed");
    expect(JSON.stringify(saved)).not.toContain("PRIVATE_KEY_FAILURE_CANARY"); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("refuses a rate limit before generation", async () => {
    mocks.rate.mockResolvedValue({ allowed: false });
    expect((await run()).failure_code).toBe("provider_rate_limited"); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it.each([null, { id, state: "cancelled", attempt_id: attempt }, { id, state: "running", attempt_id: owner }])("aborts when current request access or ownership is lost %j", async data => {
    read.mockResolvedValue({ data, error: null });
    expect((await run()).failure_code).toBe("provider_interrupted"); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("honors caller interruption before generation", async () => {
    const controller = new AbortController(); controller.abort();
    expect((await run({ signal: controller.signal })).failure_code).toBe("provider_interrupted"); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("aborts an in-flight call when another browser cancels the stored request", async () => {
    read.mockResolvedValueOnce({ data: { id, state: "running", attempt_id: attempt }, error: null }).mockResolvedValue({ data: { id, state: "cancelled", attempt_id: attempt }, error: null });
    mocks.generate.mockImplementation(({ abortSignal }) => new Promise((_resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("Cancellation was not observed")), 2000);
      abortSignal.addEventListener("abort", () => { clearTimeout(deadline); reject(new Error("aborted")); }, { once: true });
    }));
    expect((await run()).failure_code).toBe("provider_interrupted"); expect(mocks.generate).toHaveBeenCalledOnce();
  });
  it.each([
    { ...generated(), finishReason: "length" },
    { ...generated(), response: { id: "fixture-api-response", modelId: "substituted-model" } },
    { ...generated(), output: { ...output, citations: ["private:other"] } },
  ])("retains failure instead of an incomplete or wider answer", async value => {
    mocks.generate.mockResolvedValue(value);
    const saved = await run(); expect(saved.state).toBe("failed"); expect(saved.result).toBeNull(); expect(saved.provider_receipt).toBeNull();
    expect(mocks.generate).toHaveBeenCalledOnce();
  });
  it("cannot overwrite a cancellation or lost-access refusal during final delivery", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PT409", message: "PRIVATE_RESULT_CANARY" } });
    await expect(run()).rejects.toThrow("provider_retry_conflict"); expect(rpc).toHaveBeenCalledOnce();
  });
  it("refuses a native or already-finished attempt before generation", async () => {
    await expect(run({ turn: { ...original, state: "succeeded" } })).rejects.toThrow("provider_attempt_mismatch");
    await expect(run({ turn: { ...original, provider: "codex" } })).rejects.toThrow("provider_attempt_mismatch");
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("executes the callback inside the exact workspace credential context", async () => {
    const callback = vi.fn().mockResolvedValue("scoped");
    expect(await withExactProviderApiMode(workspace, "workspace_api_key", callback)).toBe("scoped");
    expect(mocks.context).toHaveBeenCalledWith(workspace, expect.any(Function)); expect(callback).toHaveBeenCalledOnce();
  });
});

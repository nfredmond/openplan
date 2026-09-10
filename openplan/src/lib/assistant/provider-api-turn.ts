import { generateText, Output } from "ai";
import { anthropicKeySource, anthropicModel } from "@/lib/integrations/anthropic-access";
import { listWorkspaceIntegrationKeyMetadata, withWorkspaceIntegrationContext } from "@/lib/integrations/workspace-keys";
import { checkAiUsageRateLimit, recordAiUsageEvent } from "@/lib/runtime/ai-rate-limit";
import { checkedProviderTurn, ProviderRequestError, providerRpcError, type ProviderService, type ProviderUserClient, type RetainedProviderTurn } from "./provider-server";
import { parseProviderProjectAnswer, PROVIDER_PROJECT_INSTRUCTIONS, providerProjectOutputSchema, providerProjectPrompt } from "./provider-project-task";

// A user chooses the credential source before creating this request. Existing
// key-loading fallback behavior cannot silently switch this task's billing mode.
export async function withExactProviderApiMode<T>(workspaceId: string, expectedMode: string, fn: () => Promise<T>) {
  const metadata = await listWorkspaceIntegrationKeyMetadata(workspaceId);
  const expectedSource = metadata.some(row => row.provider === "anthropic") ? "workspace_api_key" : "deployment_api_key";
  if (expectedMode !== expectedSource) throw new ProviderRequestError("provider_auth_mode_changed", 409);
  return withWorkspaceIntegrationContext(workspaceId, async () => {
    const source = anthropicKeySource();
    const actual = source === "workspace" ? "workspace_api_key" : source === "env" ? "deployment_api_key" : null;
    if (actual !== expectedMode) throw new ProviderRequestError(actual ? "provider_auth_mode_changed" : "provider_needs_api_key", 409);
    return fn();
  });
}

// Only a newly inserted API request reaches this function. It has one bounded
// generation, no SDK retries, and a retained attempt before any provider call.
export async function runProviderApiTurn(args: { service: ProviderService; client: ProviderUserClient; userId: string; turn: RetainedProviderTurn; signal: AbortSignal }) {
  const { service, client, userId } = args;
  const { turn, packet } = checkedProviderTurn(args.turn);
  if (turn.provider !== "anthropic" || turn.connection_id !== null || turn.state !== "running" || !turn.attempt_id) throw new ProviderRequestError("provider_attempt_mismatch", 409);
  const cancelled = new AbortController();
  const signal = AbortSignal.any([args.signal, cancelled.signal, AbortSignal.timeout(55_000)]);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function observeCancellation() {
    try {
      const { data, error } = await client.from("assistant_provider_turns").select("id,state,attempt_id")
        .eq("id", turn.id).eq("user_id", userId).maybeSingle();
      if (error || !data || data.id !== turn.id || data.state !== "running" || data.attempt_id !== turn.attempt_id) cancelled.abort();
    } catch { cancelled.abort(); }
    if (!stopped && !signal.aborted) timer = setTimeout(() => { void observeCancellation(); }, 1000);
  }
  let result: ReturnType<typeof parseProviderProjectAnswer> | null = null;
  let receipt: Record<string, unknown> | null = null;
  let failureCode: string | null = null;
  try {
    await observeCancellation();
    await withExactProviderApiMode(turn.workspace_id, turn.auth_mode, async () => {
      signal.throwIfAborted();
      const rate = await checkAiUsageRateLimit(turn.workspace_id);
      if (!rate.allowed) throw new ProviderRequestError("provider_rate_limited", 429);
      await recordAiUsageEvent({ workspaceId: turn.workspace_id, bucketKey: "assistant_chat", eventKey: turn.id,
        sourceRoute: "/api/assistant/providers/turns", metadataJson: { provider: "anthropic", model: turn.model_id, authMode: turn.auth_mode } });
      signal.throwIfAborted();
      const generation = await generateText({ model: anthropicModel(turn.model_id), system: PROVIDER_PROJECT_INSTRUCTIONS,
        prompt: providerProjectPrompt(packet, turn.question), output: Output.object({ schema: providerProjectOutputSchema(packet) }),
        maxOutputTokens: 4000, maxRetries: 0, abortSignal: signal });
      signal.throwIfAborted();
      if (generation.finishReason !== "stop") throw new ProviderRequestError("provider_answer_incomplete");
      if (generation.response.modelId !== turn.model_id) throw new ProviderRequestError("provider_model_changed");
      result = parseProviderProjectAnswer(packet, generation.output);
      receipt = { schemaVersion: 1, provider: "anthropic", model: generation.response.modelId, authMode: turn.auth_mode,
        responseId: generation.response.id, inputTokens: generation.usage.inputTokens ?? null, outputTokens: generation.usage.outputTokens ?? null };
    });
  } catch (error) {
    result = null; receipt = null;
    failureCode = signal.aborted ? "provider_interrupted" : error instanceof ProviderRequestError ? error.code : "provider_api_failed";
  } finally { stopped = true; if (timer) clearTimeout(timer); }
  const finished = await service.rpc("finish_assistant_provider_turn", { p_turn_id: turn.id, p_attempt_id: turn.attempt_id,
    p_user_id: userId, p_connection_id: null, p_token_hash: null, p_result: result, p_provider_receipt: receipt, p_failure_code: failureCode });
  providerRpcError(finished.error);
  return checkedProviderTurn(finished.data).turn;
}

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { jsonSchema, stepCountIs, streamText, tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import { openProviderApiRevisionCredential, providerApiConfigurationSchema } from "@/lib/integrations/provider-api-credentials";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { CHAT_LIMITS, chatToolInputs, canonicalChat, chatDefinitions, chatHash, assertChatGrantBinding, parseChatJson, type AssistantChatAcceptedGrantV1 } from "./provider-chat-task";
import { createChatStepFetch, type ChatWireMessage } from "./provider-chat-transport";

export const CHAT_CREDENTIAL_COLUMNS = "revision_id,connection_id,workspace_id,credential_ciphertext";
const credentialSchema = z.object({ revision_id: z.string().uuid(), connection_id: z.string().uuid(), workspace_id: z.string().uuid(), credential_ciphertext: z.string().nullable() }).strict();
export class ChatModelStepError extends Error {
  constructor(public readonly code: string, public readonly state: "unavailable" | "failed" | "uncertain") { super(code); }
}
function modelMessages(wire: ChatWireMessage[]): ModelMessage[] {
  return wire.map((m): ModelMessage => {
    if (m.role === "system" || m.role === "user") return { role: m.role, content: m.content };
    if (m.role === "tool") return { role: "tool", content: [{ type: "tool-result", toolCallId: m.tool_call_id,
      toolName: wire.flatMap(row => row.role === "assistant" ? row.tool_calls ?? [] : []).find(c => c.id === m.tool_call_id)?.function.name ?? "invalid_missing_call",
      output: { type: "text", value: m.content } }] };
    return { role: "assistant", content: [...(m.content ? [{ type: "text" as const, text: m.content }] : []),
      ...(m.tool_calls ?? []).map(c => ({ type: "tool-call" as const, toolCallId: c.id, toolName: c.function.name, input: parseChatJson(c.function.arguments) }))] };
  });
}

// One worker invocation is one SDK step and one consumed network exchange. It
// has no planner session, source client, business write or approval capability.
// The broker's callback performs final session authorization of actual SDK bytes.
export async function runChatModelStep(args: { grant: AssistantChatAcceptedGrantV1; expectedGrantDigest: string; messages: ChatWireMessage[]; leaseExpiresAt: string;
  signal: AbortSignal; authorize: (body: string) => Promise<void>; onProgress?: (frameSequence: number, text: string) => Promise<void> }) {
  const grant = assertChatGrantBinding(args.grant, args.expectedGrantDigest), selection = grant.selection;
  if (selection.execution.installationId !== process.env.OPENPLAN_INSTALLATION_ID || selection.execution.poolId !== process.env.OPENPLAN_CHAT_POOL_ID ||
    selection.execution.poolConfigurationRevision !== process.env.OPENPLAN_CHAT_POOL_REVISION) throw new Error("chat_actual_pool_mismatch");
  const configuration = providerApiConfigurationSchema.parse(parseChatJson(selection.configurationCanonical));
  if (chatHash(selection.configurationCanonical) !== selection.configurationHash || JSON.stringify(configuration) !== selection.configurationCanonical ||
    configuration.endpoint !== selection.endpoint || configuration.protocol !== selection.protocol || !configuration.modelIds.includes(selection.modelId) ||
    selection.revisionId !== selection.authRevision.revisionId || selection.revisionId !== selection.authRevision.credentialBindingRevision ||
    selection.connectionId !== selection.credentialSource.connectionId || selection.authMode !== (configuration.authMode === "api_key" ? "connection_api_key" : "connection_no_key") ||
    selection.credentialSource.kind !== (configuration.authMode === "api_key" ? "saved_connection_key" : "saved_connection_no_key")) throw new Error("chat_actual_selection_mismatch");
  const timeoutMs = Math.min(Date.parse(args.leaseExpiresAt) - Date.now(), Date.parse(grant.expiresAt) - Date.now());
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 900000) throw new Error("chat_lease_expired");
  const signal = AbortSignal.any([args.signal, AbortSignal.timeout(timeoutMs)]);
  const definitions = chatDefinitions(grant.scope), tools: ToolSet = {};
  for (const definition of definitions.tools) tools[definition.name] = tool({ description: definition.description,
    inputSchema: jsonSchema<Record<string, unknown>>(parseChatJson(canonicalChat(definition.inputSchema)) as Parameters<typeof jsonSchema>[0], {
      validate: value => {
        const parsed = chatToolInputs[definition.name].safeParse(value);
        return parsed.success ? { success: true, value: parsed.data } : { success: false, error: parsed.error };
      },
    }) });
  const wireTools = definitions.tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  const exchange = createChatStepFetch({ endpoint: selection.endpoint, model: selection.modelId, signal, timeoutMs, messages: args.messages, wireTools,
    allowedTools: definitions.tools.map(t => t.name), authorize: args.authorize, onProgress: args.onProgress,
    openCredential: async () => {
      const service = createServiceRoleClient();
      const { data, error } = await service.from("workspace_provider_api_credentials").select(CHAT_CREDENTIAL_COLUMNS)
        .eq("workspace_id", grant.owner.workspaceId).eq("connection_id", selection.connectionId).eq("revision_id", selection.revisionId).maybeSingle();
      if (error) throw new Error("chat_credential_unavailable");
      const row = credentialSchema.parse(data);
      if (row.workspace_id !== grant.owner.workspaceId || row.connection_id !== selection.connectionId || row.revision_id !== selection.revisionId) throw new Error("chat_credential_identity_mismatch");
      return openProviderApiRevisionCredential({ workspaceId: row.workspace_id, revisionId: row.revision_id, configuration,
        configurationHash: selection.configurationHash, credentialCiphertext: row.credential_ciphertext });
    } });
  const provider = createOpenAICompatible({ name: "openplan_chat_saved_api", baseURL: selection.endpoint.replace(/\/$/, ""),
    includeUsage: true, fetch: exchange.fetch });
  try {
  const stream = streamText({ model: provider(selection.modelId), messages: modelMessages(args.messages), tools,
    toolChoice: "auto", stopWhen: stepCountIs(1), maxOutputTokens: CHAT_LIMITS.outputTokensPerStep, maxRetries: 0, abortSignal: signal });
  let text = "";
  const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
  for await (const part of stream.fullStream) {
    if (part.type === "error") throw new Error("chat_sdk_stream_failed");
    if (part.type === "text-delta") text += part.text;
    if (part.type === "tool-call") {
      if (part.invalid) throw new Error("chat_sdk_tool_invalid");
      toolCalls.push({ id: part.toolCallId, name: part.toolName, input: part.input });
    }
  }
  signal.throwIfAborted();
  const receipt = exchange.receipt();
  if (receipt.text !== text || (await stream.finishReason) !== (receipt.reason === "stop" ? "stop" : "tool-calls") ||
    canonicalChat(toolCalls) !== canonicalChat(receipt.calls.map(c => ({ id: c.toolCallId, name: c.name, input: c.input })))) throw new Error("chat_sdk_terminal_mismatch");
  return { receipt, receiptHash: chatHash(canonicalChat(receipt)) };
  } catch {
    const failure = exchange.failure();
    throw new ChatModelStepError(failure?.code ?? (signal.aborted ? "chat_model_interrupted" : "chat_sdk_terminal_invalid"), failure?.state ?? (signal.aborted ? "uncertain" : "failed"));
  }
}

import { createHash } from "node:crypto";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output } from "ai";
import { z } from "zod";
import { openProviderApiRevisionCredential, providerApiConfigurationSchema, type StoredProviderApiRevision } from "@/lib/integrations/provider-api-credentials";
import { createProviderApiFetch, ProviderApiTransportError } from "./provider-api-transport";
import { parseProviderProjectAnswer, PROVIDER_PROJECT_INSTRUCTIONS, providerProjectOutputSchema, providerProjectPacketSchema, providerProjectPacketHash, providerProjectPrompt } from "./provider-project-task";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const bindingSchema = z.object({
  turnId: z.string().uuid(), attemptId: z.string().uuid(), workspaceId: z.string().uuid(), projectId: z.string().uuid(),
  connectionId: z.string().uuid(), revisionId: z.string().uuid(), configurationHash: hashSchema,
  packetHash: hashSchema, modelId: z.string().min(1).max(160),
  authMode: z.enum(["connection_api_key", "connection_no_key"]), chargesAcknowledged: z.literal(true),
  leaseExpiresAt: z.string().datetime({ offset: true }),
}).strict();
export type ProviderApiGenerationBinding = z.infer<typeof bindingSchema>;

export class ProviderApiGenerationError extends Error {
  constructor(public readonly code: string) { super(code); }
}

// Construct only for a durably claimed attempt. This adapter cannot authorize
// access or save results: the worker must observe cancellation/access changes and
// deliver the receipt through the database's common answer/approval validator.
// Capture inputs before awaiting anything, and consume even a failed invocation.
export function createProviderApiGeneration(args: {
  binding: ProviderApiGenerationBinding;
  revision: StoredProviderApiRevision & { connectionId: string };
  packetCanonical: string; question: string; signal: AbortSignal;
}) {
  let binding: ProviderApiGenerationBinding;
  let configuration: z.infer<typeof providerApiConfigurationSchema>;
  let packet: z.infer<typeof providerProjectPacketSchema>;
  let prompt: string;
  let apiKey: string | null;
  try {
    binding = bindingSchema.parse(args.binding);
    configuration = providerApiConfigurationSchema.parse(args.revision.configuration);
    if (args.revision.workspaceId !== binding.workspaceId || args.revision.revisionId !== binding.revisionId ||
      args.revision.connectionId !== binding.connectionId || args.revision.configurationHash !== binding.configurationHash ||
      !configuration.modelIds.includes(binding.modelId) ||
      binding.authMode !== (configuration.authMode === "api_key" ? "connection_api_key" : "connection_no_key")) throw new Error();
    if (typeof args.packetCanonical !== "string" || Buffer.byteLength(args.packetCanonical) > 200_000 ||
      createHash("sha256").update(args.packetCanonical).digest("hex") !== binding.packetHash) throw new Error();
    packet = providerProjectPacketSchema.parse(JSON.parse(args.packetCanonical));
    if (packet.workspaceId !== binding.workspaceId || packet.project.id !== binding.projectId) throw new Error();
    providerProjectPacketHash(packet);
    prompt = providerProjectPrompt(packet, args.question);
    const { connectionId: _connectionId, ...stored } = args.revision;
    apiKey = openProviderApiRevisionCredential(stored);
  } catch { throw new ProviderApiGenerationError("api_attempt_binding_invalid"); }
  const parentSignal = args.signal;
  let consumed = false;
  return async () => {
    if (consumed) throw new ProviderApiGenerationError("api_attempt_already_consumed");
    consumed = true;
    const leaseRemaining = Date.parse(binding.leaseExpiresAt) - Date.now();
    if (leaseRemaining <= 0 || parentSignal.aborted) throw new ProviderApiGenerationError("api_attempt_interrupted");
    const timeoutMs = Math.min(configuration.timeoutSeconds * 1000, leaseRemaining);
    const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(timeoutMs)]);
    try {
      const provider = createOpenAICompatible({ name: "openplan_saved_api", baseURL: configuration.endpoint.replace(/\/$/, ""),
        ...(apiKey === null ? {} : { apiKey }), supportsStructuredOutputs: true,
        fetch: createProviderApiFetch({ endpoint: configuration.endpoint, model: binding.modelId, apiKey, signal, timeoutMs }) });
      const generation = await generateText({ model: provider(binding.modelId), system: PROVIDER_PROJECT_INSTRUCTIONS, prompt,
        output: Output.object({ schema: providerProjectOutputSchema(packet) }), maxOutputTokens: 4000, maxRetries: 0, abortSignal: signal });
      signal.throwIfAborted();
      const result = parseProviderProjectAnswer(packet, generation.output);
      return { result, receipt: {
        schemaVersion: 1, provider: "api_connection", model: binding.modelId, authMode: binding.authMode,
        turnId: binding.turnId, attemptId: binding.attemptId, connectionId: binding.connectionId, revisionId: binding.revisionId,
        configurationHash: binding.configurationHash, packetHash: binding.packetHash,
        endpoint: configuration.endpoint, protocol: configuration.protocol,
        responseId: generation.response.id, inputTokens: generation.usage.inputTokens ?? null, outputTokens: generation.usage.outputTokens ?? null,
      } };
    } catch (error) {
      throw new ProviderApiGenerationError(signal.aborted ? "api_attempt_interrupted" :
        error instanceof ProviderApiTransportError ? error.code : "api_answer_invalid");
    } finally { apiKey = null; }
  };
}

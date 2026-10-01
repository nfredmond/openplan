import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { createProviderApiReceiptRequest, type ProviderApiResponseReceipt } from "@/lib/assistant/provider-api-transport";
import { openProviderApiRevisionCredential, providerApiConfigurationSchema,
  type StoredProviderApiRevision } from "@/lib/integrations/provider-api-credentials";
import { synthesisGenerationSegmentRecipe } from "./synthesis-generation-recipe";
import { synthesisGenerationAttemptBindingSchema, type SynthesisGenerationAttemptBinding } from "./synthesis-generation-results";
import { createSynthesisGenerationApiResult } from "./synthesis-generation-api-result";
import contextRecipe from "./synthesis-generation-context-v1.json";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const retainedDispatchSchema = z.object({ receiptText: z.string().max(16384), receiptSha256: hash }).strict();
const dispatchSchema = retainedDispatchSchema.extend({ schemaVersion: z.literal(1), authorizedNow: z.literal(true) }).strict();
const receiptSchema = z.object({ schemaVersion: z.literal(1), attemptId: id, workerId: id, authorizationId: id,
  binding: synthesisGenerationAttemptBindingSchema,
  maxOutputTokens: z.number().int().min(1).max(65536), responseByteLimit: z.number().int().min(4096).max(4194304),
  expiresAt: z.string().datetime({ offset: true }), authorizedAt: z.string().datetime({ offset: true }),
}).strict();
const taskSchema = z.object({ schemaVersion: z.literal(1), instructions: z.string(),
  input: z.record(z.string(), z.unknown()), outputSchema: z.unknown(),
}).strict();
export type SynthesisGenerationApiObservation = {
  receipt: ProviderApiResponseReceipt; startedAt: string; finishedAt: string; dispatchSha256: string;
};

/** Check retained dispatch identity without renewing it or requiring a current
 * credential. Recovery uses this for byte custody, never for another API call.
 */
export function verifySynthesisGenerationApiDispatchReceipt(args: {
  binding: SynthesisGenerationAttemptBinding; dispatch: unknown; workerId: string; authorizationId: string;
}) {
  const binding = synthesisGenerationAttemptBindingSchema.parse(args.binding);
  const dispatch = retainedDispatchSchema.parse(args.dispatch);
  const receipt = receiptSchema.parse(JSON.parse(dispatch.receiptText));
  if (digest(dispatch.receiptText) !== dispatch.receiptSha256 || binding.provider !== "api_connection" ||
    receipt.attemptId !== binding.attemptId || receipt.workerId !== id.parse(args.workerId) ||
    receipt.authorizationId !== id.parse(args.authorizationId) || !isDeepStrictEqual(receipt.binding, binding) ||
    Date.parse(receipt.expiresAt) <= Date.parse(receipt.authorizedAt)) throw new Error("Synthesis API dispatch differs from its attempt");
  return { binding, dispatch, receipt };
}

/** A fresh dispatch acknowledgement carries execution permission separately
 * from the immutable receipt. Historical readers must not manufacture it.
 */
export function verifySynthesisGenerationApiDispatch(args: Parameters<typeof verifySynthesisGenerationApiDispatchReceipt>[0]) {
  const dispatch = dispatchSchema.parse(args.dispatch);
  const verified = verifySynthesisGenerationApiDispatchReceipt({ ...args,
    dispatch: { receiptText: dispatch.receiptText, receiptSha256: dispatch.receiptSha256 } });
  return { ...verified, dispatch };
}

/** Construct only from the current native dispatch acknowledgement. A saved
 * authorizedNow value cannot renew execution permission on recovery. The worker
 * reconstructs the source plan and monitors current authority during the call.
 * This adapter checks task bytes, frozen recipe, dispatch and credential identity;
 * it does not independently reconstruct the campaign's retained source.
 */
export type SynthesisGenerationApiAttemptArgs = {
  binding: SynthesisGenerationAttemptBinding; taskCanonical: string; dispatch: unknown;
  workerId: string; authorizationId: string; workspaceId: string; connectionId: string;
  credentialSha256: string | null; revision: StoredProviderApiRevision & { connectionId: string };
  retainReceipt: (observation: SynthesisGenerationApiObservation) => Promise<void>;
  signal: AbortSignal;
};

export function createSynthesisGenerationApiAttempt(args: SynthesisGenerationApiAttemptArgs) {
  return createAttempt(args, "segment");
}

/** Use the separately frozen context recipe through the same receipt-preserving
 * transport. Only a new native context dispatch can authorize this call.
 */
export function createSynthesisContextApiAttempt(args: SynthesisGenerationApiAttemptArgs) {
  return createAttempt(args, "context");
}

function createAttempt(args: SynthesisGenerationApiAttemptArgs, stage: "segment" | "context") {
  args.signal.throwIfAborted();
  if (typeof args.retainReceipt !== "function") throw new Error("Synthesis API receipt storage required");
  const { binding, dispatch, receipt } = verifySynthesisGenerationApiDispatch(args);
  if (typeof args.taskCanonical !== "string" || Buffer.byteLength(args.taskCanonical, "utf8") > 1_048_576 ||
    digest(args.taskCanonical) !== binding.taskSha256) throw new Error("Synthesis API task bytes differ");
  const task = taskSchema.parse(JSON.parse(args.taskCanonical));
  const recipe = stage === "context" ? structuredClone(contextRecipe) : synthesisGenerationSegmentRecipe();
  if (JSON.stringify(task) !== args.taskCanonical || task.instructions !== recipe.instructions ||
    !isDeepStrictEqual(task.outputSchema, recipe.outputSchema)) throw new Error("Synthesis API task recipe differs");
  if (stage === "context" && (task.input.purpose !== "private_synthesis_context_continuation" ||
    task.input.requestId !== binding.jobId || task.input.headerSha256 !== binding.planSha256)) {
    throw new Error("Synthesis API context identity differs");
  }
  const configuration = providerApiConfigurationSchema.parse(args.revision.configuration);
  if (args.revision.workspaceId !== id.parse(args.workspaceId) || args.revision.connectionId !== id.parse(args.connectionId) ||
    args.revision.revisionId !== binding.configurationRevisionId || args.revision.configurationHash !== binding.configurationHash ||
    !configuration.modelIds.includes(binding.modelId) || hash.nullable().parse(args.credentialSha256) !==
      (args.revision.credentialCiphertext === null ? null : digest(args.revision.credentialCiphertext))) {
    throw new Error("Synthesis API credential differs from its authorization");
  }
  const { connectionId: _connectionId, ...stored } = args.revision;
  let apiKey = openProviderApiRevisionCredential(stored);
  const body = JSON.stringify({ model: binding.modelId, max_tokens: receipt.maxOutputTokens,
    messages: [{ role: "system", content: task.instructions }, { role: "user", content: args.taskCanonical }],
    response_format: { type: "json_schema", json_schema: { name: stage === "context" ? "synthesis_context_v1" : "synthesis_segment_v1", strict: true, schema: recipe.outputSchema } },
  });
  const parentSignal = args.signal;
  const retainReceipt = args.retainReceipt;
  let consumed = false;
  return async () => {
    if (consumed) throw new Error("Synthesis API attempt already consumed");
    consumed = true;
    try {
      parentSignal.throwIfAborted();
      const remaining = Date.parse(receipt.expiresAt) - Date.now();
      if (remaining <= 0) throw new Error("Synthesis API dispatch expired");
      const startedAt = new Date().toISOString();
      const send = createProviderApiReceiptRequest({ endpoint: configuration.endpoint, model: binding.modelId, apiKey,
        signal: parentSignal, timeoutMs: Math.min(configuration.timeoutSeconds * 1000, remaining),
        maxOutputTokens: receipt.maxOutputTokens, responseByteLimit: receipt.responseByteLimit });
      const transport = await send(body);
      const observation = { receipt: transport, startedAt, finishedAt: new Date().toISOString(), dispatchSha256: dispatch.receiptSha256 };
      // The worker must sync the original receipt before interpretation can fail.
      // Give it detached values so a journal callback cannot rewrite the result.
      await retainReceipt({ ...observation, receipt: { ...transport } });
      return createSynthesisGenerationApiResult(binding, { responseByteLimit: receipt.responseByteLimit, ...observation });
    } finally { apiKey = null; }
  };
}

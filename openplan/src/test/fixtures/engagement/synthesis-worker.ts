import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";
import { prepareProviderApiRevision } from "@/lib/integrations/provider-api-credentials";
import { createSynthesisGenerationPlan } from "@/lib/engagement/synthesis-generation-plan";
import { makeSourceSnapshot, savedSource, sourceScope } from "./synthesis-source";

export const synthesisWorkerHash = (text: string) => createHash("sha256").update(text).digest("hex");
export async function synthesisWorkerFixture(sourceCount = 2) {
  vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "SYNTHETIC-WORKER-SECRET");
  const directory = await mkdtemp(join(tmpdir(), "openplan-synthesis-worker-test-"));
  const providerCalls: Array<{ body: string; auth: string | undefined }> = [];
  const options = { loseClaim: false, loseDispatch: false, loseOutput: false, holdResponse: false,
    providerOutput: "SYNTHETIC\u0000\ud800🌉",
    failPlan: false, failRow: "", failStatus: false, claimPatch: {} as Record<string, unknown>, dispatchPatch: {} as Record<string, unknown>,
    statusPatch: {} as Record<string, unknown>, outputPatch: {} as Record<string, unknown> };
  const arrived = Promise.withResolvers<void>();
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    providerCalls.push({ body: Buffer.concat(chunks).toString(), auth: req.headers.authorization }); arrived.resolve();
    res.setHeader("content-type", "application/json");
    if (options.holdResponse) { res.write("SYNTHETIC observed prefix"); return; }
    res.end(JSON.stringify({ id: "synthetic-worker-response", model: "synthetic", choices: [{ finish_reason: "length",
      message: { role: "assistant", content: options.providerOutput } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`;
  vi.stubEnv("OPENPLAN_AI_LOCAL_ENDPOINTS", JSON.stringify([endpoint]));
  const connectionId = randomUUID(), revision = prepareProviderApiRevision({ workspaceId: sourceScope.workspaceId, revisionId: randomUUID(),
    configuration: { label: "Synthetic worker provider", protocol: "openai_chat_completions", endpoint,
      modelIds: ["synthetic"], structuredOutput: true, authMode: "api_key", timeoutSeconds: 30 }, apiKey: "SYNTHETIC-SAVED-KEY" });
  const saved = savedSource(makeSourceSnapshot(sourceCount)), requestId = randomUUID(), authorizationId = randomUUID(), actorId = randomUUID();
  const requestIntent = { schemaVersion: 1, sourceId: saved.requestId, sourceSha256: saved.snapshotSha256,
    connectionId, configurationRevisionId: revision.revisionId, configurationHash: revision.configurationHash, modelId: "synthetic", taskByteLimit: 4096 };
  const intentText = JSON.stringify(requestIntent), request = { id: requestId, intentText, intentSha256: synthesisWorkerHash(intentText) };
  const plan = createSynthesisGenerationPlan(request, saved, sourceScope), task = plan.entries[0];
  const sealText = JSON.stringify({ schemaVersion: 1, requestId, headerSha256: plan.headerSha256, taskCount: plan.header.taskCount,
    taskBytes: plan.header.taskBytes, tailSha256: plan.header.tailSha256, sealedAt: "2026-09-30T00:00:00Z" });
  const planState = { schemaVersion: 1, requestId, headerText: plan.headerText, headerSha256: plan.headerSha256,
    nextIndex: plan.entries.length, taskBytes: plan.header.taskBytes, tailSha256: plan.header.tailSha256, cancelled: false,
    seal: { receiptText: sealText, receiptSha256: synthesisWorkerHash(sealText) } };
  const authorizationIntent = { schemaVersion: 1, headerSha256: plan.headerSha256, maxAttempts: plan.entries.length,
    maxOutputTokens: 8192, responseByteLimit: 4096, expiresAt: new Date(Date.now() + 60_000).toISOString(),
    chargesAcknowledged: true, retryTaskIndex: null as number | null, retryOfAttemptId: null as string | null };
  const grantText = JSON.stringify(authorizationIntent);
  const rows: Record<string, Record<string, unknown>> = {
    engagement_synthesis_generation_authorizations: { id: authorizationId, request_id: requestId,
      intent_text: grantText, intent_sha256: synthesisWorkerHash(grantText), credential_sha256: synthesisWorkerHash(revision.credentialCiphertext!) },
    engagement_synthesis_generation_requests: { id: requestId, campaign_id: sourceScope.campaignId, workspace_id: sourceScope.workspaceId, actor_id: actorId,
      source_id: saved.requestId, configuration_revision_id: revision.revisionId, intent_text: intentText, intent_sha256: request.intentSha256 },
    engagement_synthesis_sources: { id: saved.requestId, campaign_id: sourceScope.campaignId, workspace_id: sourceScope.workspaceId,
      snapshot_text: saved.snapshotText, snapshot_sha256: saved.snapshotSha256, created_at: saved.createdAt },
    engagement_synthesis_generation_plans: { request_id: requestId, header_text: plan.headerText, header_sha256: plan.headerSha256 },
    engagement_synthesis_generation_plan_seals: { request_id: requestId, receipt_text: sealText, receipt_sha256: synthesisWorkerHash(sealText) },
    engagement_synthesis_generation_plan_tasks: { request_id: requestId, task_index: 0, task_text: task.canonical, task_sha256: task.sha256, task_bytes: task.utf8Bytes },
    workspace_provider_api_revisions: { id: revision.revisionId, connection_id: connectionId, workspace_id: sourceScope.workspaceId,
      configuration: revision.configuration, configuration_canonical: JSON.stringify(revision.configuration), configuration_hash: revision.configurationHash },
    workspace_provider_api_credentials: { revision_id: revision.revisionId, connection_id: connectionId, workspace_id: sourceScope.workspaceId,
      credential_ciphertext: revision.credentialCiphertext },
  };
  const queryTrace: Array<{ table: string; columns: string; filters: Record<string, unknown>; signal?: AbortSignal }> = [];
  const from = vi.fn((table: string) => {
    const trace = { table, columns: "", filters: {} as Record<string, unknown>, signal: undefined as AbortSignal | undefined }; queryTrace.push(trace);
    const query = { select(columns: string) { trace.columns = columns; return query; },
      eq(column: string, value: unknown) { trace.filters[column] = value; return query; },
      abortSignal(signal: AbortSignal) { trace.signal = signal; return query; },
      single: async () => ({ data: rows[table], error: options.failRow === table ? { message: "SYNTHETIC private error" } : null }) };
    return query;
  });
  const journal = async () => JSON.parse(await readFile(join(directory, "pending.json"), "utf8"));
  const rpcTrace: Array<{ name: string; values: Record<string, unknown>; phase?: string }> = [];
  let claim: Record<string, unknown> | null = null, dispatch: Record<string, unknown> | null = null, output: Record<string, unknown> | null = null;
  const rpc = vi.fn((name: string, values: Record<string, unknown>) => {
    const work = (async () => {
      let phase: string | undefined; try { phase = (await journal()).phase; } catch { /* Loader tests do not create a journal. */ }
      rpcTrace.push({ name, values, phase });
      let data: unknown;
      if (name === "read_engagement_synthesis_generation_plan") return { data: planState, error: options.failPlan ? { code: "SYNTHETIC" } : null };
      if (name === "claim_engagement_synthesis_generation_attempt") {
        const binding = { jobId: requestId, planSha256: plan.header.taskManifestSha256, configurationRevisionId: revision.revisionId,
          configurationHash: revision.configurationHash, provider: "api_connection", modelId: "synthetic", taskSha256: task.sha256, attemptId: values.p_attempt };
        claim ??= { schemaVersion: 1, attemptId: values.p_attempt, authorizationId, taskIndex: 0, workerId: values.p_worker,
          claimExpiresAt: authorizationIntent.expiresAt, bindingText: JSON.stringify(binding) };
        if (options.loseClaim) { options.loseClaim = false; return { data: null, error: { code: "SYNTHETIC_UNKNOWN_ACK" } }; }
        data = { ...claim, ...options.claimPatch };
      } else if (name === "dispatch_engagement_synthesis_generation_attempt") {
        const first = dispatch === null;
        const text = JSON.stringify({ schemaVersion: 1, attemptId: claim!.attemptId, workerId: claim!.workerId, authorizationId,
          binding: JSON.parse(String(claim!.bindingText)), maxOutputTokens: authorizationIntent.maxOutputTokens,
          responseByteLimit: authorizationIntent.responseByteLimit, expiresAt: authorizationIntent.expiresAt, authorizedAt: new Date().toISOString() });
        dispatch ??= { schemaVersion: 1, authorizedNow: true, receiptText: text, receiptSha256: synthesisWorkerHash(text) };
        if (options.loseDispatch) { options.loseDispatch = false; return { data: null, error: { code: "SYNTHETIC_UNKNOWN_ACK" } }; }
        data = { ...dispatch, authorizedNow: first, ...options.dispatchPatch };
      } else if (name === "read_engagement_synthesis_generation_execution_status") {
        if (options.failStatus) return { data: null, error: { code: "SYNTHETIC_ACCESS_LOST" } };
        data = { schemaVersion: 1, attemptId: claim!.attemptId, workerId: claim!.workerId, dispatchSha256: dispatch!.receiptSha256,
          outputSha256: null, expiresAt: authorizationIntent.expiresAt, canContinue: true, ...options.statusPatch };
      } else if (name === "retain_engagement_synthesis_generation_output") {
        output ??= { schemaVersion: 1, attemptId: values.p_attempt, captureText: Buffer.from(String(values.p_capture_base64), "base64").toString("utf8"), captureSha256: values.p_capture_sha256 };
        if (options.loseOutput) { options.loseOutput = false; return { data: null, error: { code: "SYNTHETIC_UNKNOWN_ACK" } }; }
        data = { ...output, ...options.outputPatch };
      } else throw new Error(`Unexpected synthetic worker RPC ${name}`);
      return { data, error: null };
    })();
    return Object.assign(work, { abortSignal: vi.fn().mockReturnValue(work) });
  });
  const controller = new AbortController(), service = { from, rpc } as unknown as Pick<SupabaseClient, "from" | "rpc">;
  return { args: { service, target: "http://127.0.0.1:29821", directory, authorizationId, taskIndex: 0, signal: controller.signal, statusIntervalMs: 10 },
    service, rows, plan, task, saved, revision, requestIntent, authorizationIntent, planState, queryTrace, rpcTrace, rpc, from,
    options, controller, providerCalls, arrived: arrived.promise, journal,
    async close() { await new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }); await rm(directory, { recursive: true, force: true }); },
    resealGrant() { const text = JSON.stringify(authorizationIntent); Object.assign(rows.engagement_synthesis_generation_authorizations, { intent_text: text, intent_sha256: synthesisWorkerHash(text) }); },
  };
}

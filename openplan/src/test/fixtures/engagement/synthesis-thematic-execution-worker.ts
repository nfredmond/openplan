import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, vi } from "vitest";
import { prepareProviderApiRevision } from "@/lib/integrations/provider-api-credentials";
import { synthesisThematicJobFixture } from "./synthesis-thematic-job";
import { sourceScope, sourceHash as hash } from "./synthesis-source";

export async function synthesisThematicExecutionWorkerFixture(priorCount: number | "final" = 0) {
  const directory = await mkdtemp(join(tmpdir(), "openplan-thematic-worker-")), calls: string[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8"); calls.push(body);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "synthetic-thematic-worker", model: "synthetic-thematic", choices: [{ finish_reason: "stop",
      message: { role: "assistant", content: "SYNTHETIC original \u0000\ud800🌉" } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`;
  vi.stubEnv("OPENPLAN_AI_LOCAL_ENDPOINTS", JSON.stringify([endpoint]));
  const revision = prepareProviderApiRevision({ workspaceId: sourceScope.workspaceId, revisionId: randomUUID(),
    configuration: { label: "SYNTHETIC thematic worker", protocol: "openai_chat_completions", endpoint,
      modelIds: ["synthetic-thematic"], structuredOutput: true, authMode: "none", timeoutSeconds: 30 }, apiKey: null });
  const connectionId = randomUUID(), f = await synthesisThematicJobFixture(priorCount, { connectionId, revisionId: revision.revisionId,
    configurationHash: revision.configurationHash, modelId: "synthetic-thematic" });
  priorCount=f.args.taskIndex;
  f.rows.set("workspace_provider_api_revisions", [{ id: revision.revisionId, connection_id: connectionId, workspace_id: sourceScope.workspaceId,
    configuration: revision.configuration, configuration_canonical: JSON.stringify(revision.configuration), configuration_hash: revision.configurationHash }]);
  f.rows.set("workspace_provider_api_credentials", [{ revision_id: revision.revisionId, connection_id: connectionId,
    workspace_id: sourceScope.workspaceId, credential_ciphertext: null }]);
  const options = { loseClaim: false, loseDispatch: false, loseOutput: false, failStatus: false };
  const journal = async () => JSON.parse(await readFile(join(directory, "pending.json"), "utf8"));
  const trace: Array<{ name: string; values: Record<string, unknown>; phase: string; thematic: unknown }> = [];
  let claim: Record<string, unknown> | null = null, dispatch: { receiptText: string; receiptSha256: string } | null = null;
  let output: Record<string, unknown> | null = null;
  const rpc = vi.fn((name: string, values: Record<string, unknown>) => {
    if (name.startsWith("read_") && name !== "read_engagement_synthesis_thematic_execution_status") return f.rpc(name, values);
    const work = (async () => {
      const pending = await journal(); trace.push({ name, values, phase: pending.phase, thematic: pending.thematic });
      let data: unknown;
      if (name === "claim_engagement_synthesis_thematic_attempt") {
        expect(values.p_task_text).toBe(f.next.task.canonical);
        const prior = f.history.at(-1);
        expect(values.p_predecessor_attempt).toBe(prior?.attempt.id ?? null);
        expect(values.p_predecessor_selection).toBe(prior?.selection.id ?? null);
        expect(values.p_predecessor_capture_sha256).toBe(prior?.outputRow.capture_sha256 ?? null);
        expect(values.p_previous_result_sha256).toBe(prior?.result.sha256 ?? null);
        const binding = { jobId: f.f.scope.requestId, planSha256: f.plan.continuation.headerSha256, configurationRevisionId: revision.revisionId,
          configurationHash: revision.configurationHash, provider: "api_connection", modelId: "synthetic-thematic", taskSha256: f.next.task.sha256, attemptId: values.p_attempt };
        claim ??= { schemaVersion: 1, attemptId: values.p_attempt, authorizationId: f.args.authorizationId, taskIndex: priorCount,
          workerId: values.p_worker, claimExpiresAt: f.grantIntent.expiresAt, bindingText: JSON.stringify(binding) };
        if (options.loseClaim) { options.loseClaim = false; return { data: null, error: { code: "SYNTHETIC_UNKNOWN" } }; }
        data = claim;
      } else if (name === "dispatch_engagement_synthesis_thematic_attempt") {
        const first = dispatch === null;
        const receiptText = JSON.stringify({ schemaVersion: 1, attemptId: claim!.attemptId, workerId: claim!.workerId,
          authorizationId: f.args.authorizationId, binding: JSON.parse(String(claim!.bindingText)), maxOutputTokens: f.grantIntent.maxOutputTokens,
          responseByteLimit: f.grantIntent.responseByteLimit, expiresAt: f.grantIntent.expiresAt, authorizedAt: new Date().toISOString() });
        dispatch ??= { receiptText, receiptSha256: hash(receiptText) };
        if (options.loseDispatch) { options.loseDispatch = false; return { data: null, error: { code: "SYNTHETIC_UNKNOWN" } }; }
        data = { schemaVersion: 1, ...dispatch, authorizedNow: first };
      } else if (name === "read_engagement_synthesis_thematic_execution_status") {
        if (options.failStatus) return { data: null, error: { code: "42501" } };
        data = { schemaVersion: 1, attemptId: claim!.attemptId, workerId: claim!.workerId,
          dispatchSha256: dispatch!.receiptSha256, outputSha256: null, expiresAt: f.grantIntent.expiresAt, canContinue: true };
      } else if (name === "retain_engagement_synthesis_generation_output") {
        output ??= { schemaVersion: 1, attemptId: values.p_attempt, captureText: Buffer.from(String(values.p_capture_base64), "base64").toString("utf8"), captureSha256: values.p_capture_sha256 };
        if (options.loseOutput) { options.loseOutput = false; return { data: null, error: { code: "SYNTHETIC_UNKNOWN" } }; }
        data = output;
      } else throw new Error(`Unexpected thematic worker command ${name}`);
      return { data, error: null };
    })();
    return Object.assign(work, { abortSignal: () => work });
  });
  const service = { from: f.from, rpc } as unknown as Pick<SupabaseClient, "from" | "rpc">;
  return { f, options, directory, calls, trace, rpc, journal,
    args: { service, directory, target: "http://127.0.0.1:29821", authorizationId: f.args.authorizationId,
      taskIndex: priorCount, signal: f.controller.signal, statusIntervalMs: 10 },
    async close() { await new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }); await rm(directory, { recursive: true, force: true }); } };
}

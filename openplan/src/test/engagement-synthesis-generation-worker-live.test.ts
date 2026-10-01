// @vitest-environment node
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prepareProviderApiRevision } from "@/lib/integrations/provider-api-credentials";
import { createSynthesisGenerationPlan, synthesisGenerationPlanBatch, verifySynthesisGenerationPlanState } from "@/lib/engagement/synthesis-generation-plan";
import { LIVE_RLS, getLocalSupabaseEnv, liveClient, type LocalSupabaseEnv } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { requireContractVerificationStack } from "./helpers/contract-verification-stack";
import { readSynthesisGenerationSelectedResults, loadSynthesisGenerationHistory } from "@/lib/engagement/synthesis-generation-selected-results-server";

import { createSynthesisContextRequest, readSynthesisContextRequest } from "@/lib/engagement/synthesis-context-requests-server";
import { retainSynthesisContextPlan } from "@/lib/engagement/synthesis-context-plan-server";
import { createSynthesisContextContinuation } from "@/lib/engagement/synthesis-context-continuation";
import { verifySynthesisGenerationApiResult } from "@/lib/engagement/synthesis-generation-api-result";
import { createSynthesisGenerationInput } from "@/lib/engagement/synthesis-generation-input";
import { createSynthesisGenerationRecords } from "@/lib/engagement/synthesis-generation-records";
import { createSynthesisGenerationContext } from "@/lib/engagement/synthesis-generation-context";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.unstubAllEnvs(); });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const literal = (text: string) => "'" + text.replaceAll("'", "''") + "'";
function checked<T>(value: { data: T; error: { code?: string } | null }): T {
  if (value.error) throw new Error(`Native synthesis fixture failed: ${value.error.code}`);
  return value.data;
}
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// Real CLI, private files, PostgreSQL, PostgREST and Kong. Only the model is
// synthetic. Committed immutable fixtures keep unique identities in this named
// disposable stack; no history triggers are bypassed for fixture cleanup.
describe.skipIf(!LIVE_RLS)("synthesis worker native HTTP delivery", () => {
  let environment: LocalSupabaseEnv, container: string, service: ReturnType<typeof liveClient>;
  beforeAll(() => {
    environment = getLocalSupabaseEnv(); container = resolveLocalDbContainer(); requireContractVerificationStack(container);
    service = liveClient(environment.API_URL, environment.SERVICE_ROLE_KEY, "synthesis-worker-live");
  });
  function sql(statement: string) {
    return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
      input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000,
    }).trim().split("\n").at(-1)!;
  }
  async function fixture(options: { mode?: "api_key" | "none"; bytes?: number; loss?: "output" | "dispatch"; cancel?: boolean; allTasks?: boolean; validOutputs?: boolean } = {}) {
    const owner = randomUUID(), custodian = randomUUID(), workspace = randomUUID(), campaign = randomUUID(), sourceId = randomUUID();
    const connection = randomUUID(), revision = randomUUID(), requestId = randomUUID(), authorizationId = randomUUID();
    const root = await mkdtemp(join(tmpdir(), "openplan-synthesis-native-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const secret = "SYNTHETIC-SYNTHESIS-WORKER-SECRET", key = "SYNTHETIC-SYNTHESIS-KEY";
    let outputText = "SYNTHETIC exact original\u0000\ud800 é 😀";
    const envelope = { id: "synthetic-response", model: "synthetic", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: outputText } }] };
    if (options.bytes) {
      outputText += "é".repeat(Math.floor((options.bytes - Buffer.byteLength(JSON.stringify(envelope))) / 2));
      envelope.choices[0].message.content = outputText;
    }
    let providerBody = JSON.stringify(envelope);
    if (options.bytes) providerBody += " ".repeat(options.bytes - Buffer.byteLength(providerBody));
    const calls: Array<{ path: string | undefined; authorization: string | undefined; body: Record<string, unknown> }> = [];
    const endpoint = `${await listen(createServer(async (req, res) => {
      const parts: Buffer[] = []; for await (const chunk of req) parts.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(parts).toString());
      calls.push({ path: req.url, authorization: req.headers.authorization, body });
      let responseBody = providerBody;
      if (options.validOutputs) {
        const task = JSON.parse(body.messages.find((message: { role: string }) => message.role === "user").content);
        const previous = task.input.previous ? JSON.parse(task.input.previous.outputText) : { notes: [], uncertainties: [] };
        const content = task.input.purpose === "private_synthesis_context_continuation"
          ? JSON.stringify({ status: "complete", coveredPartIds: task.input.frame.parts.map((part: { id: string }) => part.id),
            notes: previous.notes, uncertainties: [...previous.uncertainties, "SYNTHETIC context coverage only\u0000\ud800 é 😀"] })
          : JSON.stringify({ status: "complete", coveredPartIds: task.input.parts.map((part: { id: string }) => part.id),
            observations: [], uncertainty: "SYNTHETIC coverage only; meaning not interpreted\u0000\ud800 é 😀" });
        responseBody = JSON.stringify({ ...envelope, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }] });
      }
      res.setHeader("content-type", "application/json"); res.end(responseBody);
    }))}/v1/`;
    sql(`BEGIN;
      INSERT INTO auth.users(id,email) VALUES('${owner}','${owner}@synthetic.invalid'),('${custodian}','${custodian}@synthetic.invalid');
      INSERT INTO workspaces(id,name,slug) VALUES('${workspace}','SYNTHETIC synthesis worker','${workspace}');
      INSERT INTO workspace_members(workspace_id,user_id,role) VALUES('${workspace}','${owner}','owner'),('${workspace}','${custodian}','owner');
      INSERT INTO engagement_campaigns(id,workspace_id,title,created_by) VALUES('${campaign}','${workspace}','SYNTHETIC worker question','${owner}');
      INSERT INTO engagement_items(id,campaign_id,body,status,source_type,configuration_version_id)
        SELECT '${randomUUID()}',id,'SYNTHETIC retained source','approved','internal',configuration_version_id FROM engagement_campaigns WHERE id='${campaign}'; COMMIT;`);
    const asOwner = (statement: string) => sql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${owner}',true); SET LOCAL ROLE authenticated; ${statement}; COMMIT;`);
    asOwner(`SELECT capture_engagement_synthesis_sources('${campaign}','${sourceId}','{"statuses":["approved"],"includeItems":true,"includeSurveys":true,"categoryIds":[],"from":null,"to":null}')`);
    const saved = JSON.parse(asOwner(`SELECT read_engagement_synthesis_sources('${campaign}','${sourceId}')`));
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", secret);
    const mode = options.mode ?? "api_key";
    const prepared = prepareProviderApiRevision({ workspaceId: workspace, revisionId: revision,
      configuration: { label: "SYNTHETIC native worker", protocol: "openai_chat_completions", endpoint, modelIds: ["synthetic"], structuredOutput: true, authMode: mode, timeoutSeconds: 30 },
      apiKey: mode === "api_key" ? key : null });
    checked(await service.rpc("save_workspace_provider_api_revision", { p_user_id: owner, p_workspace_id: workspace, p_connection_id: connection,
      p_revision_id: revision, p_expected_revision_id: null, p_configuration_canonical: JSON.stringify(prepared.configuration), p_credential_ciphertext: prepared.credentialCiphertext }));
    const intent = { schemaVersion: 1, sourceId, sourceSha256: saved.snapshotSha256, connectionId: connection, configurationRevisionId: revision,
      configurationHash: prepared.configurationHash, modelId: "synthetic", taskByteLimit: 4096 };
    const request = JSON.parse(asOwner(`SELECT create_engagement_synthesis_generation_request('${campaign}','${requestId}',${literal(JSON.stringify(intent))})`)).request;
    const plan = createSynthesisGenerationPlan({ id: request.id, intentText: request.intentText, intentSha256: request.intentSha256 }, saved, { requestId: sourceId, campaignId: campaign, workspaceId: workspace });
    checked(await service.rpc("prepare_engagement_synthesis_generation_plan", { p_request: requestId, p_header_text: plan.headerText }));
    for (let index = 0; index < plan.entries.length;) {
      const batch = synthesisGenerationPlanBatch(plan, index)!;
      const state = checked(await service.rpc("stage_engagement_synthesis_generation_tasks", { p_request: requestId, p_start: index, p_previous_sha256: batch.previousSha256, p_tasks_text: batch.tasksText }));
      expect(verifySynthesisGenerationPlanState(plan, state).nextIndex).toBe(batch.nextIndex); index = batch.nextIndex;
    }
    const sealed = checked(await service.rpc("seal_engagement_synthesis_generation_plan", { p_request: requestId, p_header_sha256: plan.headerSha256 }));
    expect(verifySynthesisGenerationPlanState(plan, sealed).seal).not.toBeNull();
    const grant = { schemaVersion: 1, headerSha256: plan.headerSha256, maxAttempts: options.allTasks ? plan.entries.length : 1, maxOutputTokens: 8192, responseByteLimit: options.bytes ?? 4096,
      expiresAt: new Date(Date.now() + 3600000).toISOString(), chargesAcknowledged: true, retryTaskIndex: null, retryOfAttemptId: null };
    asOwner(`SELECT authorize_engagement_synthesis_generation('${requestId}','${authorizationId}',${literal(JSON.stringify(grant))})`);
    const proxyErrors: string[] = [];
    const deliveries: Array<{ bytes: number; body: Record<string, string>; status: number }> = [];
    let dropped = false, cancelled = false;
    const target = await listen(createServer(async (req, res) => {
      try {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks), isOutput = req.url?.endsWith("/retain_engagement_synthesis_generation_output");
        if (isOutput && options.cancel && !cancelled) {
          cancelled = true;
          asOwner(`SELECT cancel_engagement_synthesis_generation_request('${campaign}','${requestId}','${randomUUID()}','SYNTHETIC late original')`);
          sql(`UPDATE workspace_members SET role='viewer' WHERE workspace_id='${workspace}' AND user_id='${owner}'`);
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string" && !["host", "connection", "content-length", "transfer-encoding"].includes(name)) headers.set(name, value);
        const forwarded = await fetch(`${environment.API_URL}${req.url}`, { method: req.method, headers, body: body.length ? body : undefined, redirect: "manual" });
        const bytes = Buffer.from(await forwarded.arrayBuffer());
        if (isOutput) deliveries.push({ bytes: body.length, body: JSON.parse(body.toString()), status: forwarded.status });
        if (!dropped && forwarded.ok && ((isOutput && options.loss === "output") || (req.url?.endsWith("/dispatch_engagement_synthesis_generation_attempt") && options.loss === "dispatch"))) {
          dropped = true; res.destroy(); return;
        }
        res.statusCode = forwarded.status;
        for (const [name, value] of forwarded.headers) if (!["connection", "content-length", "transfer-encoding", "content-encoding"].includes(name)) res.setHeader(name, value);
        res.end(bytes);
      } catch (error) { proxyErrors.push(String(error)); res.statusCode = 502; res.end("Synthetic proxy failed"); }
    }));
    const directory = join(root, hash(target), authorizationId, "0");
    async function run(allTasks = false) {
      const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/workers/synthesis-generation.ts", "--authorization", authorizationId,
        ...(allTasks ? ["--all-tasks"] : ["--task-index", "0"])], {
        cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: target,
          SUPABASE_SERVICE_ROLE_KEY: environment.SERVICE_ROLE_KEY, OPENPLAN_SYNTHESIS_GENERATION_WORK_DIR: root,
          OPENPLAN_INTEGRATION_KEY_SECRET: secret, OPENPLAN_AI_LOCAL_ENDPOINTS: JSON.stringify([endpoint]), NODE_DEBUG: "" },
      });
      let stderr = ""; child.stderr.on("data", chunk => { stderr += String(chunk); }); child.stdout.resume();
      const ended = new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
        child.once("error", reject); child.once("close", code => resolve({ code, stderr }));
      });
      cleanup.push(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await ended; });
      return ended;
    }
    const journal = async () => JSON.parse(await readFile(join(directory, "pending.json"), "utf8"));
    const outputs = async () => checked(await service.from("engagement_synthesis_generation_outputs").select("attempt_id,capture_text,capture_sha256").eq("attempt_id", (await journal()).attemptId));
    const selectedResults = () => readSynthesisGenerationSelectedResults(service, {
      request: { id: request.id, intentText: request.intentText, intentSha256: request.intentSha256 }, saved,
      scope: { requestId: sourceId, campaignId: campaign, workspaceId: workspace }, actorId: owner,
    }, new AbortController().signal);
    const revokeRequester = () => sql(`UPDATE workspace_members SET role='viewer' WHERE workspace_id='${workspace}' AND user_id='${owner}'`);
    async function staffHistoryClient() {
      const email = `${randomUUID()}@synthetic.invalid`, password = `SYNTHETIC-${randomUUID()}`;
      const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw new Error("Synthetic history staff could not be created");
      const userId = created.data.user.id;
      sql(`INSERT INTO workspace_members(workspace_id,user_id,role) VALUES('${workspace}','${userId}','member')`);
      const client = liveClient(environment.API_URL, environment.ANON_KEY, "synthesis-history-staff");
      const signedIn = await client.auth.signInWithPassword({ email, password });
      if (signedIn.error || !signedIn.data.session) throw new Error("Synthetic history staff could not sign in");
      return { client, userId, read: (throughSequence?: number) => loadSynthesisGenerationHistory(client, service,
        { campaignId: campaign, workspaceId: workspace, requestId, throughSequence }, new AbortController().signal),
        revoke: () => sql(`UPDATE workspace_members SET role='viewer' WHERE workspace_id='${workspace}' AND user_id='${userId}'`) };
    }
    return { run, journal, outputs, calls, deliveries, proxyErrors, providerBody, outputText, key, plan, authorizationId, selectedResults, revokeRequester, staffHistoryClient, owner, saved, endpoint, root,
      contextArgs: { campaignId: campaign, workspaceId: workspace, parentRequestId: requestId, intentText: request.intentText as string },
      cancelParent: () => asOwner(`SELECT cancel_engagement_synthesis_generation_request('${campaign}','${requestId}','${randomUUID()}','SYNTHETIC context continuation')`) };
  }

  it.each(["output", "dispatch"] as const)("recovers native context CLI custody after %s acknowledgement loss", async loss => {
    const f = await fixture({ allTasks: true, validOutputs: true }), staff = await f.staffHistoryClient(), signal = new AbortController().signal;
    const parentRun = await f.run(true); expect(parentRun.code, parentRun.stderr).toBe(0);
    f.cancelParent(); f.revokeRequester();
    const history = await staff.read(), args = { ...f.contextArgs, requestId: randomUUID(), actorId: staff.userId,
      throughSequence: history.selections.throughSequence, targetRecordId: history.inventory.contributionIds[0], frameByteLimit: 4096,
      intentText: JSON.stringify({ ...JSON.parse(f.contextArgs.intentText), taskByteLimit: 65536 }) };
    const created = await createSynthesisContextRequest(staff.client, service, args, signal);
    const scope = { requestId: args.requestId, campaignId: args.campaignId, workspaceId: args.workspaceId };
    const sourceScope = { requestId: history.inventory.source.requestId, campaignId: args.campaignId, workspaceId: args.workspaceId };
    const input = createSynthesisGenerationInput(f.saved, sourceScope), records = createSynthesisGenerationRecords(input, f.saved, sourceScope);
    const reconstruction = { job: history.inventory.job, selections: history.selections.selections, results: history.inventory.results,
      saved: f.saved, input, records, plan: history.selections.plan.taskPlan, scope: sourceScope, taskByteLimit: history.selections.plan.taskPlan.taskByteLimit };
    const context = createSynthesisGenerationContext(history.inventory, reconstruction, args.throughSequence);
    const stagingArgs: Parameters<typeof retainSynthesisContextPlan>[1] = [created.state, scope,
      [context, history.inventory, reconstruction, args.throughSequence, args.targetRecordId, args.frameByteLimit]];
    const staged = await retainSynthesisContextPlan(service, stagingArgs, signal), authorizationId = randomUUID();
    expect(staged.plan.entries.length).toBeGreaterThan(1);
    const grant = { schemaVersion: 1, headerSha256: staged.plan.headerSha256, maxAttempts: staged.plan.entries.length,
      maxOutputTokens: 8192, responseByteLimit: 65536, expiresAt: new Date(Date.now() + 3600000).toISOString(),
      chargesAcknowledged: true, retryTaskIndex: null, retryOfAttemptId: null };
    checked(await staff.client.rpc("authorize_engagement_synthesis_context", { p_request: args.requestId, p_authorization: authorizationId, p_intent_text: JSON.stringify(grant) }));
    let dropped = false, deliveries = 0;
    const proxyErrors: string[] = [];
    const target = await listen(createServer(async (req, res) => {
      try {
        const parts: Buffer[] = []; for await (const chunk of req) parts.push(Buffer.from(chunk));
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string" && !["host", "connection", "content-length", "transfer-encoding"].includes(name)) headers.set(name, value);
        const body = Buffer.concat(parts), response = await fetch(`${environment.API_URL}${req.url}`, {
          method: req.method, headers, body: body.length ? body : undefined, redirect: "manual" });
        const bytes = Buffer.from(await response.arrayBuffer());
        if (loss === "dispatch" && response.ok && !dropped && req.url?.endsWith("/dispatch_engagement_synthesis_context_attempt")) {
          dropped = true; res.destroy(); return;
        }
        if (req.url?.endsWith("/retain_engagement_synthesis_generation_output")) {
          deliveries++;
          if (loss === "output" && response.ok && !dropped) { dropped = true; res.destroy(); return; }
        }
        res.statusCode = response.status;
        for (const [name, value] of response.headers) if (!["connection", "content-length", "transfer-encoding", "content-encoding"].includes(name)) res.setHeader(name, value);
        res.end(bytes);
      } catch (error) { proxyErrors.push(String(error)); res.statusCode = 502; res.end("SYNTHETIC context execution proxy failed"); }
    }));
    vi.stubEnv("OPENPLAN_AI_LOCAL_ENDPOINTS", JSON.stringify([f.endpoint]));
    const root = join(f.root, "native-context"), directory = join(root, hash(target), authorizationId);
    async function runContext(options = ["--all-tasks"], contextual = true) {
      const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/workers/synthesis-generation.ts",
        "--authorization", authorizationId, ...options, ...(contextual ? ["--context"] : [])], {
        cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: target,
          SUPABASE_SERVICE_ROLE_KEY: environment.SERVICE_ROLE_KEY, OPENPLAN_SYNTHESIS_GENERATION_WORK_DIR: root, NODE_DEBUG: "" },
      });
      let stderr = "", stdout = "";
      child.stderr.on("data", chunk => { stderr += String(chunk); }); child.stdout.on("data", chunk => { stdout += String(chunk); });
      const ended = new Promise<{ code: number | null; stderr: string; stdout: string }>((resolve, reject) => {
        child.once("error", reject); child.once("close", code => resolve({ code, stderr, stdout }));
      });
      cleanup.push(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await ended; });
      return ended;
    }
    expect((await runContext(["--all-tasks"], false)).code).toBe(1);
    expect(f.calls).toHaveLength(f.plan.entries.length);
    expect((await runContext()).code).toBe(1);
    expect(dropped).toBe(true);
    const interrupted = JSON.parse(await readFile(join(directory, "0/pending.json"), "utf8"));
    expect(interrupted.phase).toBe(loss === "dispatch" ? "dispatching" : "observed");
    if (loss === "dispatch") {
      const savedSchedule = await readFile(join(directory, "schedule/pending.json"), "utf8");
      const unknown = await runContext(); expect(unknown.code, unknown.stderr).toBe(2);
      expect(unknown.stdout).toContain(`0 outputs retained; 1 dispatches unobserved; ${staged.plan.entries.length - 1} scheduled tasks not processed`);
      expect(await readFile(join(directory, "schedule/pending.json"), "utf8")).toBe(savedSchedule);
      expect(JSON.parse(await readFile(join(directory, "0/pending.json"), "utf8")).phase).toBe("unobserved");
      const attempts = checked(await service.from("engagement_synthesis_generation_attempts").select("id,task_index").eq("request_id", args.requestId));
      expect(attempts).toEqual([{ id: interrupted.attemptId, task_index: 0 }]);
      expect(f.calls).toHaveLength(f.plan.entries.length); expect(deliveries).toBe(0); expect(dropped).toBe(true); expect(proxyErrors).toEqual([]);
      return;
    }
    const singleRecovery = await runContext(["--task-index", "0"]);
    expect(singleRecovery.code, singleRecovery.stderr).toBe(0);
    const drained = await runContext();
    expect(drained.code, drained.stderr).toBe(0);
    expect(drained.stdout).toContain(`${staged.plan.entries.length} outputs retained; 0 dispatches unobserved; 0 scheduled tasks not processed; 0 tasks outside this schedule`);
    const replay = createSynthesisContextContinuation(...stagingArgs);
    let priorAttempt: string | null = null, priorCapture: string | null = null;
    for (let index = 0; index < staged.plan.entries.length; index++) {
      const task = replay.next(); if (task.status !== "ready") throw new Error("Native context replay has no ready task");
      const journal = JSON.parse(await readFile(join(directory, String(index), "pending.json"), "utf8"));
      expect(journal.phase).toBe("delivered"); expect(journal.context).toBe(true);
      const outcome = { attemptId: journal.attemptId as string };
      const savedInput = checked(await service.from("engagement_synthesis_context_attempt_inputs").select("task_text,task_sha256,predecessor_attempt_id,predecessor_capture_sha256,previous_result_sha256")
        .eq("attempt_id", outcome.attemptId).single());
      expect(savedInput).toEqual({ task_text: task.task.canonical, task_sha256: task.task.sha256,
        predecessor_attempt_id: priorAttempt, predecessor_capture_sha256: priorCapture, previous_result_sha256: task.previousResultSha256 });
      const output = checked(await service.from("engagement_synthesis_generation_outputs").select("capture_text,capture_sha256").eq("attempt_id", outcome.attemptId).single());
      if (!output) throw new Error("Native context original output is absent");
      const capture = verifySynthesisGenerationApiResult(journal.job.binding, { canonical: output.capture_text, sha256: output.capture_sha256 },
        { dispatchSha256: journal.dispatch.receiptSha256, responseByteLimit: grant.responseByteLimit }).capture;
      replay.accept({ taskSha256: task.task.sha256, outputText: capture.outputText, finishReason: capture.finishReason });
      priorAttempt = outcome.attemptId; priorCapture = output.capture_sha256;
    }
    expect(replay.next()).toMatchObject({ status: "frames_complete", interpretation: "machine_unreviewed" });
    expect(dropped).toBe(true); expect(deliveries).toBe(staged.plan.entries.length + 2);
    expect(f.calls).toHaveLength(f.plan.entries.length + staged.plan.entries.length); expect(proxyErrors).toEqual([]);
    checked(await staff.client.rpc("cancel_engagement_synthesis_generation_request", { p_campaign: args.campaignId, p_request: args.requestId,
      p_cancellation: randomUUID(), p_reason: "SYNTHETIC completed context custody" }));
    staff.revoke();
    const recovered = await runContext(); expect(recovered.code, recovered.stderr).toBe(0);
    const last = JSON.parse(await readFile(join(directory, String(staged.plan.entries.length - 1), "pending.json"), "utf8"));
    expect(last.captureSha256).toBe(priorCapture);
    expect(deliveries).toBe(staged.plan.entries.length * 2 + 2);
    expect(f.calls).toHaveLength(f.plan.entries.length + staged.plan.entries.length);
  }, 300000);

  it("retains reconstructed context requests through authenticated HTTP after original requester departure", async () => {
    const f = await fixture({ allTasks: true, validOutputs: true }), staff = await f.staffHistoryClient();
    const signal = new AbortController().signal, initial = await staff.read();
    const args = { ...f.contextArgs, requestId: randomUUID(), actorId: staff.userId, throughSequence: 0,
      targetRecordId: initial.inventory.contributionIds[0], frameByteLimit: 4096 };
    await expect(createSynthesisContextRequest(staff.client, service, args, signal)).rejects.toThrow("complete retained results");
    const run = await f.run(true); expect(run.code, run.stderr).toBe(0);
    f.cancelParent(); f.revokeRequester();
    const history = await staff.read(); expect(history.inventory.status).toBe("ready_for_record_consolidation");
    args.throughSequence = history.selections.throughSequence;
    const created = await createSynthesisContextRequest(staff.client, service, args, signal);
    expect(created.state.replayed).toBe(false); expect(created.state.request.actorId).toBe(staff.userId);
    expect(created.state.request.actorId).not.toBe(f.owner);
    expect(created.binding.segmentResultsManifestSha256).toBe(history.inventory.manifestSha256);
    expect(created.binding.selectionSequence).toBe(f.plan.entries.length);
    const replay = await createSynthesisContextRequest(staff.client, service, args, signal);
    expect(replay.state.replayed).toBe(true); expect(replay.state.request).toEqual(created.state.request);
    expect(replay.state.context).toEqual(created.state.context);
    const scope = { campaignId: args.campaignId, workspaceId: args.workspaceId, requestId: args.requestId };
    const reader = await f.staffHistoryClient();
    expect((await readSynthesisContextRequest(reader.client, scope, signal)).state.context).toEqual(created.state.context);
    await expect(createSynthesisContextRequest(reader.client, service, { ...args, actorId: reader.userId }, signal)).rejects.toThrow("save unconfirmed");
    const preparation = await service.rpc("prepare_engagement_synthesis_generation_plan", { p_request: args.requestId, p_header_text: f.plan.headerText });
    expect(preparation.error?.code).toBe("0A000");
    const sourceScope = { requestId: history.inventory.source.requestId, campaignId: args.campaignId, workspaceId: args.workspaceId };
    const input = createSynthesisGenerationInput(f.saved, sourceScope), records = createSynthesisGenerationRecords(input, f.saved, sourceScope);
    const reconstruction = { job: history.inventory.job, selections: history.selections.selections, results: history.inventory.results,
      saved: f.saved, input, records, plan: history.selections.plan.taskPlan, scope: sourceScope, taskByteLimit: history.selections.plan.taskPlan.taskByteLimit };
    const context = createSynthesisGenerationContext(history.inventory, reconstruction, args.throughSequence);
    const stagingArgs: Parameters<typeof retainSynthesisContextPlan>[1] = [created.state, scope,
      [context, history.inventory, reconstruction, args.throughSequence, args.targetRecordId, args.frameByteLimit]];
    let dropped = false, stageCalls = 0;
    const proxyErrors: string[] = [];
    const target = await listen(createServer(async (req, res) => {
      try {
        const parts: Buffer[] = []; for await (const chunk of req) parts.push(Buffer.from(chunk));
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string" && !["host", "connection", "content-length", "transfer-encoding"].includes(name)) headers.set(name, value);
        const response = await fetch(`${environment.API_URL}${req.url}`, { method: req.method, headers, body: Buffer.concat(parts), redirect: "manual" });
        const body = Buffer.from(await response.arrayBuffer());
        if (req.url?.endsWith("/stage_engagement_synthesis_context_frames")) {
          stageCalls++;
          if (response.ok && !dropped) { dropped = true; res.destroy(); return; }
        }
        res.statusCode = response.status;
        for (const [name, value] of response.headers) if (!["connection", "content-length", "transfer-encoding", "content-encoding"].includes(name)) res.setHeader(name, value);
        res.end(body);
      } catch (error) { proxyErrors.push(String(error)); res.statusCode = 502; res.end("Synthetic context proxy failed"); }
    }));
    const stagingService = liveClient(target, environment.SERVICE_ROLE_KEY, "synthesis-context-staging");
    await expect(retainSynthesisContextPlan(stagingService, stagingArgs, signal)).rejects.toThrow("acknowledgement unavailable");
    expect(dropped).toBe(true); expect(stageCalls).toBe(1);
    const staged = await retainSynthesisContextPlan(stagingService, stagingArgs, signal);
    expect(staged.state.seal).not.toBeNull(); expect(stageCalls).toBe(1); expect(proxyErrors).toEqual([]);
    const frames = checked(await service.from("engagement_synthesis_context_frames").select("frame_index,frame_text,frame_sha256,frame_bytes")
      .eq("request_id", args.requestId).order("frame_index"));
    expect(frames).toEqual(staged.plan.entries.map(frame => ({ frame_index: frame.index, frame_text: frame.canonical, frame_sha256: frame.sha256, frame_bytes: frame.utf8Bytes })));
    expect(frames!.some(frame => frame.frame_text.includes("\\u0000") && frame.frame_text.includes("\\ud800"))).toBe(true);
    checked(await staff.client.rpc("cancel_engagement_synthesis_generation_request", { p_campaign: args.campaignId,
      p_request: args.requestId, p_cancellation: randomUUID(), p_reason: "SYNTHETIC context staging cancellation" }));
    const cancelled = await retainSynthesisContextPlan(stagingService, stagingArgs, signal);
    expect(cancelled.state.cancelled).toBe(true); expect(cancelled.state.seal).toEqual(staged.state.seal); expect(stageCalls).toBe(1);
    const attempts = checked(await service.from("engagement_synthesis_generation_attempts").select("id").eq("request_id", args.requestId));
    expect(attempts).toEqual([]); expect(f.calls).toHaveLength(f.plan.entries.length); expect(f.proxyErrors).toEqual([]);
    reader.revoke(); await expect(readSynthesisContextRequest(reader.client, scope, signal)).rejects.toThrow("unavailable");
    staff.revoke(); await expect(createSynthesisContextRequest(staff.client, service, args, signal)).rejects.toThrow("history access unavailable");
    await expect(retainSynthesisContextPlan(stagingService, stagingArgs, signal)).rejects.toThrow("acknowledgement unavailable");
    expect(f.calls).toHaveLength(f.plan.entries.length);
  }, 60000);

  it("joins native selections to original worker outputs without authorizing another call", async () => {
    const f = await fixture({ allTasks: true });
    const before = await f.selectedResults(); expect(before.inventory.status).toBe("incomplete"); expect(before.inventory.results).toEqual([]);
    const run = await f.run(true); expect(run.code, run.stderr).toBe(0);
    const result = await f.selectedResults(); expect(result.inventory.results).toHaveLength(f.plan.entries.length);
    expect(result.executions).toHaveLength(f.plan.entries.length); expect(result.selections.throughSequence).toBe(f.plan.entries.length);
    for (const output of result.inventory.results) {
      expect(output.sha256).toBe(hash(output.canonical)); expect(JSON.parse(output.canonical).outputText).toBe(f.outputText);
    }
    expect(result.inventory.status).toBe("incomplete");
    expect(result.inventory.entries.every(entry => entry.disposition === "invalid_output")).toBe(true);
    expect(f.calls).toHaveLength(f.plan.entries.length);
    f.revokeRequester(); await expect(f.selectedResults()).rejects.toThrow("inventory unavailable");
    expect(f.calls).toHaveLength(f.plan.entries.length);
  }, 60000);

  it("lets current authenticated staff inspect cancelled output after requester revocation", async () => {
    const f = await fixture({ allTasks: true, loss: "output", cancel: true });
    expect((await f.run(true)).code).toBe(1);
    expect((await f.run(true)).code).toBe(1); expect(f.calls).toHaveLength(1);
    await expect(f.selectedResults()).rejects.toThrow("inventory unavailable");
    const staff = await f.staffHistoryClient(), history = await staff.read();
    expect(history.requesterId).toBe(f.owner); expect(history.inventory.status).toBe("incomplete");
    expect(history.inventory.results).toHaveLength(1);
    expect(JSON.parse(history.inventory.results[0].canonical).outputText).toBe(f.outputText);
    expect(history.inventory.results[0].sha256).toBe((await f.outputs())![0].capture_sha256);
    const beforeChoice = await staff.read(0); expect(beforeChoice.selections.throughSequence).toBe(0);
    expect(beforeChoice.inventory.results).toEqual([]); expect(beforeChoice.inventory.status).toBe("incomplete");
    staff.revoke(); await expect(staff.read()).rejects.toThrow("history access unavailable");
    expect(f.calls).toHaveLength(1);
  }, 60000);

  for (const mode of ["api_key", "none"] as const) it(`delivers the source-bound original with ${mode}`, async () => {
    const f = await fixture({ mode }), result = await f.run();
    expect(result.code, result.stderr).toBe(0); expect((await f.journal()).phase).toBe("delivered");
    expect(f.calls).toHaveLength(1); expect(f.calls[0].authorization).toBe(mode === "api_key" ? `Bearer ${f.key}` : undefined);
    expect(f.calls[0].body.max_tokens).toBe(8192);
    const rows = await f.outputs(); expect(rows).toHaveLength(1);
    const capture = JSON.parse(rows![0].capture_text); expect(capture.outputText).toBe(f.outputText);
    expect(capture.binding.taskSha256).toBe(f.plan.entries[0].sha256);
    expect(rows![0].capture_sha256).toBe(hash(rows![0].capture_text));
  }, 30000);
  it("redelivers the maximum raw response through Kong after a lost acknowledgement and revoked access", async () => {
    const f = await fixture({ bytes: 4194304, loss: "output", cancel: true });
    expect((await f.run()).code).toBe(1); const original = await f.journal(); expect(original.phase).toBe("observed");
    expect(Buffer.from(original.observation.receipt.bodyBase64, "base64").equals(Buffer.from(f.providerBody))).toBe(true);
    expect(f.proxyErrors).toEqual([]); expect(f.deliveries.map(row => row.status)).toEqual([200]);
    const retry = await f.run(); expect(retry.code, retry.stderr).toBe(0); expect(f.calls).toHaveLength(1);
    expect(f.deliveries).toHaveLength(2); expect(f.deliveries[0].bytes).toBeGreaterThan(13_000_000);
    expect(f.deliveries[1].body).toEqual(f.deliveries[0].body); expect(f.deliveries.every(row => row.status === 200)).toBe(true);
    const rows = await f.outputs(); expect(rows).toHaveLength(1);
    expect(rows![0].capture_text).toBe(Buffer.from(f.deliveries[0].body.p_capture_base64, "base64").toString("utf8"));
    expect(rows![0].capture_sha256).toBe(f.deliveries[0].body.p_capture_sha256);
    expect(JSON.parse(rows![0].capture_text).outputText).toBe(f.outputText);
    expect((await f.journal()).observation).toEqual(original.observation);
  }, 60000);
  it("drains a complete grant through native task journals after a lost output acknowledgement", async () => {
    const f = await fixture({ allTasks: true, loss: "output" });
    expect(f.plan.entries.length).toBeGreaterThan(2);
    expect((await f.run(true)).code).toBe(1);
    const original = await f.journal(); expect(original.phase).toBe("observed");
    const resumed = await f.run(true); expect(resumed.code, resumed.stderr).toBe(0);
    expect(f.calls).toHaveLength(f.plan.entries.length);
    const attempts = checked(await service.from("engagement_synthesis_generation_attempts")
      .select("id,task_index,binding_text").eq("authorization_id", f.authorizationId).order("task_index"));
    expect(attempts!.map(row => row.task_index)).toEqual(f.plan.entries.map(task => task.index));
    const outputs = checked(await service.from("engagement_synthesis_generation_outputs")
      .select("attempt_id,capture_text,capture_sha256").in("attempt_id", attempts!.map(row => row.id)).order("attempt_id"));
    expect(outputs).toHaveLength(f.plan.entries.length);
    for (const attempt of attempts!) {
      const output = outputs!.find(row => row.attempt_id === attempt.id)!;
      expect(output.capture_sha256).toBe(hash(output.capture_text));
      expect(JSON.parse(output.capture_text).binding).toEqual(JSON.parse(attempt.binding_text));
      expect(JSON.parse(attempt.binding_text).taskSha256).toBe(f.plan.entries[attempt.task_index].sha256);
    }
    expect((await f.journal()).observation).toEqual(original.observation);
    expect((await f.run(true)).code).toBe(0); expect(f.calls).toHaveLength(f.plan.entries.length);
    expect(checked(await service.from("engagement_synthesis_generation_outputs")
      .select("attempt_id,capture_text,capture_sha256").in("attempt_id", attempts!.map(row => row.id)).order("attempt_id"))).toEqual(outputs);
    expect(f.proxyErrors).toEqual([]);
  }, 60000);
  it("recovers the same single-task directory when continuing with the complete grant", async () => {
    const f = await fixture({ allTasks: true }); expect((await f.run()).code).toBe(0);
    const original = await f.journal(); expect((await f.run(true)).code).toBe(0);
    expect(f.calls).toHaveLength(f.plan.entries.length);
    expect((await f.journal()).attemptId).toBe(original.attemptId);
  }, 60000);
  it("reports a limited grant as partial and makes no call beyond its allowance", async () => {
    const f = await fixture(); expect((await f.run(true)).code).toBe(2);
    expect(f.calls).toHaveLength(1); expect(await f.outputs()).toHaveLength(1);
    expect((await f.run(true)).code).toBe(2); expect(f.calls).toHaveLength(1);
  }, 30000);
  it("recovers the saved first output after cancellation without dispatching later tasks", async () => {
    const f = await fixture({ allTasks: true, loss: "output", cancel: true });
    expect((await f.run(true)).code).toBe(1); const original = await f.journal(); expect(original.phase).toBe("observed");
    expect((await f.run(true)).code).toBe(1); expect(f.calls).toHaveLength(1);
    expect((await f.journal()).phase).toBe("delivered"); expect((await f.journal()).observation).toEqual(original.observation);
    const attempts = checked(await service.from("engagement_synthesis_generation_attempts").select("id").eq("authorization_id", f.authorizationId));
    expect(attempts).toHaveLength(1);
  }, 30000);
  it("keeps an unknown dispatch unresolved while processing the other authorized tasks", async () => {
    const f = await fixture({ allTasks: true, loss: "dispatch" }); expect((await f.run(true)).code).toBe(1);
    expect((await f.journal()).phase).toBe("dispatching");
    expect((await f.run(true)).code).toBe(2); expect((await f.journal()).phase).toBe("unobserved");
    expect(f.calls).toHaveLength(f.plan.entries.length - 1); expect(await f.outputs()).toHaveLength(0);
    const attempts = checked(await service.from("engagement_synthesis_generation_attempts").select("id,task_index").eq("authorization_id", f.authorizationId));
    expect(attempts).toHaveLength(f.plan.entries.length);
    expect(attempts!.filter(row => row.task_index === 0)).toHaveLength(1);
    expect((await f.run(true)).code).toBe(2); expect(f.calls).toHaveLength(f.plan.entries.length - 1);
  }, 60000);
  it("does not call the model or invent output after a lost native dispatch acknowledgement", async () => {
    const f = await fixture({ loss: "dispatch" }); expect((await f.run()).code).toBe(1);
    expect((await f.journal()).phase).toBe("dispatching"); expect((await f.run()).code).toBe(2);
    expect(f.calls).toHaveLength(0); expect(await f.outputs()).toHaveLength(0); expect(f.deliveries).toHaveLength(0);
    const attempts = checked(await service.from("engagement_synthesis_generation_attempts").select("id").eq("authorization_id", f.authorizationId));
    expect(attempts).toHaveLength(1);
  }, 30000);
});

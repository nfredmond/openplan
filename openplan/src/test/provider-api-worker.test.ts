// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireConnectorLock, writeConnectorJournal } from "../../../workers/planner_agent_connector/connector-worker.mjs";
import { runProviderApiWorkerCycle, providerApiWorkerTarget, API_WORKER_CREDENTIAL_COLUMNS } from "@/lib/assistant/provider-api-worker";
import { retainedProviderTurnSchema, type ProviderService } from "@/lib/assistant/provider-server";
import { createProviderApiGeneration, ProviderApiGenerationError } from "@/lib/assistant/provider-api-generation";
import { parseProviderProjectAnswer, providerProjectPacketSchema } from "@/lib/assistant/provider-project-task";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
async function fixture(authMode: "none" | "api_key" = "none") {
  const directory = await mkdtemp(join(tmpdir(), "openplan-api-worker-test-")); directories.push(directory);
  const workspace = randomUUID(), project = randomUUID();
  const packet = providerProjectPacketSchema.parse({ version: 1, workspaceId: workspace, capturedAt: "2026-09-12T00:00:00Z",
    project: { id: project, name: "Synthetic worker project", summary: null, status: "active", planType: "other", deliveryPhase: "planning", updatedAt: "2026-09-12T00:00:00Z" },
    source: { id: `project:${project}`, label: "Synthetic worker project", href: `/projects/${project}` } });
  const canonical = JSON.stringify(packet);
  const configuration = { label: "Synthetic local API", protocol: "openai_chat_completions" as const, endpoint: "https://model.fixture.invalid/v1/", modelIds: ["synthetic-model"], structuredOutput: true, authMode, timeoutSeconds: 60 };
  const configCanonical = JSON.stringify(configuration);
  const job = retainedProviderTurnSchema.options[1].parse({ id: randomUUID(), request_id: randomUUID(), user_id: randomUUID(),
    workspace_id: workspace, project_id: project, provider: "api_connection", connection_id: null, model_id: "synthetic-model", auth_mode: authMode === "none" ? "connection_no_key" : "connection_api_key",
    question: "What is retained?", packet_canonical: canonical, packet_hash: hash(canonical), state: "running", attempt_id: randomUUID(),
    lease_expires_at: new Date(Date.now() + 60_000).toISOString(), result: null, provider_receipt: null, failure_code: null,
    created_at: "2026-09-12T00:00:00Z", started_at: "2026-09-12T00:00:00Z", finished_at: null,
    api_connection_id: randomUUID(), api_revision_id: randomUUID(), api_configuration_canonical: configCanonical,
    api_configuration_hash: hash(configCanonical), api_charge_ack: true });
  const answer = parseProviderProjectAnswer(packet, { answer: "The project record is retained.", citations: [packet.source.id], submittal: null });
  const receipt = { schemaVersion: 1, provider: "api_connection", model: job.model_id, authMode: job.auth_mode, turnId: job.id, attemptId: job.attempt_id!,
    connectionId: job.api_connection_id, revisionId: job.api_revision_id, configurationHash: job.api_configuration_hash, packetHash: job.packet_hash,
    endpoint: configuration.endpoint, protocol: configuration.protocol, responseId: "synthetic-response", inputTokens: 10, outputTokens: 20 };
  const credential = { workspace_id: workspace, connection_id: job.api_connection_id, revision_id: job.api_revision_id, credential_ciphertext: authMode === "none" ? null : "SYNTHETIC_PRIVATE_CREDENTIAL_CANARY" };
  let state = "running", claims = 0;
  const completion = vi.fn(async (args: Record<string, unknown>) => ({ data: { ...job, state: args.p_failure_code ? "failed" : "succeeded",
    result: args.p_result, provider_receipt: args.p_provider_receipt, failure_code: args.p_failure_code }, error: null as { code: string; message: string } | null }));
  const current = vi.fn(async () => ({ data: { id: job.id, attemptId: job.attempt_id, state, leaseExpiresAt: job.lease_expires_at }, error: null }));
  const claim = vi.fn(async () => ({ data: ++claims === 1 ? job : null, error: null as { code: string; message: string } | null }));
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => ({ abortSignal: async (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (name === "claim_assistant_api_turn") return claim();
    if (name === "read_assistant_api_turn_status") return current();
    if (name === "finish_assistant_provider_turn") return completion(args);
    throw new Error(`Unexpected RPC ${name}`);
  } }));
  const lookup = vi.fn(async () => ({ data: credential as unknown, error: null as { code: string; message: string } | null }));
  const query = { select: vi.fn(), eq: vi.fn(), abortSignal: vi.fn(), maybeSingle: lookup };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  query.abortSignal.mockImplementation((signal: AbortSignal) => { signal.throwIfAborted(); return query; });
  const from = vi.fn(() => query);
  const generate = vi.fn<typeof createProviderApiGeneration>(() => async () => {
    expect(JSON.parse(await readFile(join(directory, "pending.json"), "utf8"))).toMatchObject({ phase: "running", job: { id: job.id, attempt_id: job.attempt_id } });
    return { result: answer, receipt };
  });
  const target = "http://127.0.0.1:29821";
  const controller = new AbortController();
  const service = { rpc, from } as unknown as ProviderService;
  const run = (overrides: Partial<Parameters<typeof runProviderApiWorkerCycle>[0]> = {}) => runProviderApiWorkerCycle({ service, target, directory, signal: controller.signal, generate, statusIntervalMs: 5, ...overrides });
  const journal = async () => JSON.parse(await readFile(join(directory, "pending.json"), "utf8"));
  const retainRunning = () => writeConnectorJournal(directory, { version: 1, target, phase: "running", job });
  return { directory, target, controller, job, receipt, answer, credential, generate, rpc, from, query, lookup, current, claim, completion, run, journal, retainRunning, setState: (value: string) => { state = value; } };
}

describe("saved API worker custody", () => {
  it("journals before its single invocation and delivers the exact scoped receipt", async () => {
    const f = await fixture();
    expect(await f.run()).toEqual({ state: "succeeded", turnId: f.job.id });
    expect(f.generate).toHaveBeenCalledOnce();
    expect(f.generate.mock.calls[0][0]).toMatchObject({ binding: { turnId: f.job.id, attemptId: f.job.attempt_id, revisionId: f.job.api_revision_id,
      connectionId: f.job.api_connection_id, workspaceId: f.job.workspace_id, projectId: f.job.project_id, configurationHash: f.job.api_configuration_hash,
      packetHash: f.job.packet_hash, modelId: f.job.model_id, authMode: f.job.auth_mode, chargesAcknowledged: true, leaseExpiresAt: f.job.lease_expires_at },
      revision: { workspaceId: f.job.workspace_id, connectionId: f.job.api_connection_id, revisionId: f.job.api_revision_id,
        configurationHash: f.job.api_configuration_hash, credentialCiphertext: null }, packetCanonical: f.job.packet_canonical, question: f.job.question });
    expect(f.from).toHaveBeenCalledWith("workspace_provider_api_credentials");
    expect(API_WORKER_CREDENTIAL_COLUMNS).toBe("revision_id,connection_id,workspace_id,credential_ciphertext");
    expect(f.query.select).toHaveBeenCalledWith(API_WORKER_CREDENTIAL_COLUMNS);
    for (const [field, value] of [["workspace_id", f.job.workspace_id], ["connection_id", f.job.api_connection_id], ["revision_id", f.job.api_revision_id]]) expect(f.query.eq).toHaveBeenCalledWith(field, value);
    expect(f.completion).toHaveBeenCalledWith(expect.objectContaining({ p_turn_id: f.job.id, p_attempt_id: f.job.attempt_id, p_user_id: f.job.user_id,
      p_connection_id: null, p_token_hash: null, p_result: f.answer, p_provider_receipt: f.receipt, p_failure_code: null }));
    expect(await f.journal()).toMatchObject({ target: f.target, phase: "delivered", acknowledgedState: "succeeded" });
    expect((await stat(join(f.directory, "pending.json"))).mode & 0o777).toBe(0o600);
    expect(await f.run()).toEqual({ state: "idle" }); expect(f.generate).toHaveBeenCalledOnce();
  });
  it("keeps saved encrypted credentials out of the pending journal", async () => {
    const f = await fixture("api_key");
    expect((await f.run()).state).toBe("succeeded");
    expect(f.generate.mock.calls[0][0]).toMatchObject({ binding: { authMode: "connection_api_key" }, revision: { credentialCiphertext: f.credential.credential_ciphertext } });
    expect(JSON.stringify(await f.journal())).not.toContain("SYNTHETIC_PRIVATE_CREDENTIAL_CANARY");
  });
  for (const field of ["attempt_id", "lease_expires_at"]) it(`refuses a claimed job missing ${field}`, async () => {
    const f = await fixture();
    f.claim.mockResolvedValue({ data: { ...f.job, [field]: null }, error: null });
    await expect(f.run()).rejects.toThrow("api_worker_claim_invalid"); expect(f.generate).not.toHaveBeenCalled(); expect(f.lookup).not.toHaveBeenCalled();
  });
  it("refuses a non-date lease in a retained journal", async () => {
    const f = await fixture();
    await writeConnectorJournal(f.directory, { version: 1, target: f.target, phase: "running", job: { ...f.job, lease_expires_at: "not-a-date" } });
    await expect(f.run()).rejects.toThrow("api_worker_claim_invalid"); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("does not dispatch on an empty queue or interrupted caller", async () => {
    const f = await fixture(); f.claim.mockResolvedValue({ data: null, error: null });
    expect(await f.run()).toEqual({ state: "idle" }); expect(f.generate).not.toHaveBeenCalled(); expect(f.lookup).not.toHaveBeenCalled();
    f.controller.abort(); await expect(f.run()).rejects.toThrow(); expect(f.claim).toHaveBeenCalledOnce();
  });
  it("refuses a failed claim even if an unexpected row accompanies the error", async () => {
    const f = await fixture(); f.claim.mockResolvedValue({ data: f.job, error: { code: "DB_ERROR", message: "PRIVATE_CLAIM_CANARY" } });
    await expect(f.run()).rejects.toThrow(); expect(f.lookup).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
  });
  it("turns restart of a running journal into failure without loading credentials or generating", async () => {
    const f = await fixture(); await f.retainRunning();
    expect(await f.run()).toEqual({ state: "failed", turnId: f.job.id });
    expect(f.generate).not.toHaveBeenCalled(); expect(f.lookup).not.toHaveBeenCalled(); expect(f.claim).not.toHaveBeenCalled();
    expect(f.completion.mock.calls[0][0]).toMatchObject({ p_result: null, p_provider_receipt: null, p_failure_code: "api_worker_interrupted" });
  });
  for (const afterCommit of [false, true]) it(`retries only saved delivery after response loss, committed=${afterCommit}`, async () => {
    const f = await fixture(); const finish = f.completion.getMockImplementation()!;
    f.completion.mockImplementationOnce(async args => {
      expect(await f.journal()).toMatchObject({ phase: "completed", delivery: { kind: "answer", result: f.answer, receipt: f.receipt } });
      if (afterCommit) { await finish(args); f.setState("succeeded"); }
      return { data: null as unknown as Awaited<ReturnType<typeof finish>>["data"], error: { code: "FETCH_ERROR", message: "SYNTHETIC_RESPONSE_LOSS" } };
    });
    await expect(f.run()).rejects.toThrow(); expect((await f.journal()).phase).toBe("completed");
    expect(await f.run()).toEqual({ state: "succeeded", turnId: f.job.id });
    expect(f.generate).toHaveBeenCalledOnce(); expect(f.claim).toHaveBeenCalledOnce(); expect(f.lookup).toHaveBeenCalledOnce();
    expect(f.completion.mock.calls[0][0]).toEqual(f.completion.mock.calls[1][0]);
  });
  for (const state of ["cancelled", "interrupted", "access_lost"]) it(`retires ${state} without retrieving credentials or publishing a result`, async () => {
    const f = await fixture(); f.setState(state);
    expect(await f.run()).toEqual({ state, turnId: f.job.id });
    expect(f.lookup).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled(); expect(f.completion).not.toHaveBeenCalled();
    expect((await f.journal()).phase).toBe("delivered");
  });
  it("aborts an in-flight generation when the retained request is cancelled", async () => {
    const f = await fixture(); let observedAbort = false;
    f.generate.mockImplementation(args => async () => new Promise((_resolve, reject) => {
      let settled = false;
      const deadline = setTimeout(() => { settled = true; reject(new Error("Cancellation was not observed")); }, 1000);
      args.signal.addEventListener("abort", () => { if (settled) return; settled = true; observedAbort = true; clearTimeout(deadline); reject(new Error("Interrupted")); }, { once: true });
      f.setState("cancelled");
    }));
    expect(await f.run()).toEqual({ state: "cancelled", turnId: f.job.id });
    expect(observedAbort).toBe(true); expect(f.generate).toHaveBeenCalledOnce(); expect(f.completion).not.toHaveBeenCalled();
  });
  it("discards a response that resolves after cancellation instead of journaling an answer", async () => {
    const f = await fixture(); const originalGenerate = f.generate.getMockImplementation()!;
    let resolvedAfterAbort = false, captured: unknown;
    f.generate.mockImplementation(args => async () => {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const deadline = setTimeout(() => { settled = true; reject(new Error("Cancellation was not observed")); }, 1000);
        args.signal.addEventListener("abort", () => { if (settled) return; settled = true; clearTimeout(deadline); resolvedAfterAbort = true; resolve(); }, { once: true });
        f.setState("cancelled");
      });
      return originalGenerate(args)();
    });
    const current = f.current.getMockImplementation()!;
    f.current.mockImplementation(async () => { const saved = await f.journal(); if (saved.phase === "completed") captured = saved.delivery; return current(); });
    expect((await f.run()).state).toBe("cancelled"); expect(resolvedAfterAbort).toBe(true);
    expect(captured).toEqual({ kind: "failure", code: "api_worker_interrupted" }); expect(f.completion).not.toHaveBeenCalled();
  });
  it("holds its OS lock across generation", async () => {
    const f = await fixture(); const original = f.generate.getMockImplementation()!;
    let lockResult = "not checked";
    f.generate.mockImplementation(args => async () => {
      let competing: Awaited<ReturnType<typeof acquireConnectorLock>> | undefined;
      try { competing = await acquireConnectorLock(f.directory); lockResult = "acquired"; }
      catch (error) { lockResult = error instanceof Error ? error.message : "unknown"; }
      finally { await competing?.release(); }
      return original(args)();
    });
    expect((await f.run()).state).toBe("succeeded");
    expect(lockResult).toBe("connector_already_running");
  });
  it("aborts generation if its own flock process is lost", async () => {
    const f = await fixture();
    const childIds = async () => (await readFile(`/proc/self/task/${process.pid}/children`, "utf8")).trim().split(/\s+/).filter(Boolean);
    const previous = new Set(await childIds());
    f.generate.mockImplementation(args => async () => {
      const matches = (await childIds()).filter(pid => !previous.has(pid)).map(Number);
      expect(matches).toHaveLength(1);
      expect((await readFile(`/proc/${matches[0]}/cmdline`, "utf8")).split("\0")[0]).toBe("/usr/bin/cat");
      const lost = new Promise<never>((_resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error("Lost lock was not observed")), 1000);
        args.signal.addEventListener("abort", () => { clearTimeout(deadline); reject(new Error("Own lock lost")); }, { once: true });
      });
      process.kill(matches[0], "SIGTERM");
      return lost;
    });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(Promise.race([f.run(), new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error("Worker cleanup did not finish after lock loss")), 1500);
      })])).rejects.toThrow("This operation was aborted");
    } finally { if (deadline) clearTimeout(deadline); }
    expect((await f.journal()).delivery).toEqual({ kind: "failure", code: "api_worker_interrupted" });
    expect(f.completion).not.toHaveBeenCalled();
    expect((await f.run()).state).toBe("failed"); expect(f.generate).toHaveBeenCalledOnce();
  });
  for (const field of ["workspace_id", "connection_id", "revision_id"]) it(`rejects a credential row with foreign ${field}`, async () => {
    const f = await fixture(); f.lookup.mockResolvedValue({ data: { ...f.credential, [field]: randomUUID() }, error: null });
    expect((await f.run()).state).toBe("failed"); expect(f.generate).not.toHaveBeenCalled();
    expect(f.completion.mock.calls[0][0]).toMatchObject({ p_result: null, p_provider_receipt: null, p_failure_code: "api_worker_generation_failed" });
  });
  it("redacts lookup failures and nonstandard generation error codes", async () => {
    const f = await fixture(); f.lookup.mockResolvedValueOnce({ data: null, error: { code: "DB_ERROR", message: "PRIVATE_LOOKUP_CANARY" } });
    expect((await f.run()).state).toBe("failed"); expect(JSON.stringify(await f.journal())).not.toContain("PRIVATE_LOOKUP_CANARY");
    const g = await fixture(); g.generate.mockImplementation(() => { throw new ProviderApiGenerationError("PRIVATE_PROVIDER_CANARY"); });
    expect((await g.run()).state).toBe("failed"); expect(JSON.stringify(await g.journal())).not.toContain("PRIVATE_PROVIDER_CANARY");
    expect(g.completion.mock.calls[0][0]).toMatchObject({ p_failure_code: "api_worker_generation_failed" });
    expect(JSON.stringify(g.completion.mock.calls)).not.toContain("PRIVATE_PROVIDER_CANARY");
  });
  for (const field of ["id", "attemptId", "leaseExpiresAt"]) it(`refuses a mismatched current status ${field} before dispatch`, async () => {
    const f = await fixture(); const current = await f.current();
    f.current.mockResolvedValue({ ...current, data: { ...current.data, [field]: field === "leaseExpiresAt" ? "2000-01-01T00:00:00Z" : randomUUID() } });
    if (field === "leaseExpiresAt") expect((await f.run()).state).toBe("failed");
    else await expect(f.run()).rejects.toThrow("api_worker_status_mismatch");
    expect(f.generate).not.toHaveBeenCalled(); expect(f.lookup).not.toHaveBeenCalled();
  });
  it("refuses a changed future lease before dispatch", async () => {
    const f = await fixture(); const current = await f.current();
    f.current.mockResolvedValue({ ...current, data: { ...current.data, leaseExpiresAt: new Date(Date.parse(f.job.lease_expires_at!) + 5000).toISOString() } });
    expect((await f.run()).state).toBe("failed"); expect(f.generate).not.toHaveBeenCalled(); expect(f.lookup).not.toHaveBeenCalled();
  });
  it("refuses an expired claimed lease before dispatch", async () => {
    const f = await fixture(); f.job.lease_expires_at = "2000-01-01T00:00:00Z";
    expect((await f.run()).state).toBe("failed"); expect(f.generate).not.toHaveBeenCalled(); expect(f.lookup).not.toHaveBeenCalled();
  });
  for (const field of ["user_id", "request_id", "api_revision_id", "api_connection_id"]) it(`keeps pending delivery if its returned ${field} is foreign`, async () => {
    const f = await fixture(); const original = f.completion.getMockImplementation()!;
    f.completion.mockImplementationOnce(async args => { const result = await original(args); return { ...result, data: { ...result.data, [field]: randomUUID() } }; });
    await expect(f.run()).rejects.toThrow("api_worker_delivery_mismatch");
    expect((await f.journal()).phase).toBe("completed");
    expect((await f.run()).state).toBe("succeeded"); expect(f.generate).toHaveBeenCalledOnce();
  });
  for (const field of ["result", "provider_receipt", "failure_code", "state"]) it(`refuses a changed completion ${field}`, async () => {
    const f = await fixture(); const original = f.completion.getMockImplementation()!;
    const replacement = field === "state" ? "running" : field === "failure_code" ? "unexpected_failure" : null;
    f.completion.mockImplementationOnce(async args => { const result = await original(args); return { ...result, data: { ...result.data, [field]: replacement } }; });
    await expect(f.run()).rejects.toThrow("api_worker_delivery_mismatch"); expect((await f.journal()).phase).toBe("completed");
  });
  it("accepts cancellation or minimal access loss that wins the final completion race", async () => {
    const f = await fixture(); f.completion.mockImplementation(async args => ({ data: { ...f.job, state: "cancelled", result: args.p_result, provider_receipt: args.p_provider_receipt, failure_code: null }, error: null }));
    expect((await f.run()).state).toBe("cancelled");
    const g = await fixture(); g.completion.mockImplementation(async () => { g.setState("access_lost"); return { data: null as unknown as Awaited<ReturnType<typeof g.completion>>["data"], error: { code: "42501", message: "Access lost" } }; });
    expect((await g.run()).state).toBe("access_lost");
  });
  it("rejects a different deployment or corrupt journal before any service request", async () => {
    const f = await fixture(); await f.retainRunning();
    await expect(f.run({ target: "http://127.0.0.1:29831" })).rejects.toThrow("api_worker_journal_mismatch"); expect(f.rpc).not.toHaveBeenCalled();
    await writeFile(join(f.directory, "pending.json"), "{", { mode: 0o600 });
    await expect(f.run()).rejects.toThrow(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("refuses a readable-by-others journal and a non-running retained attempt", async () => {
    const f = await fixture(); await f.retainRunning(); await chmod(join(f.directory, "pending.json"), 0o644);
    await expect(f.run()).rejects.toThrow("connector_file_not_private"); expect(f.rpc).not.toHaveBeenCalled();
    await chmod(join(f.directory, "pending.json"), 0o600);
    await writeConnectorJournal(f.directory, { version: 1, target: f.target, phase: "running", job: { ...f.job, state: "queued" } });
    await expect(f.run()).rejects.toThrow("api_worker_claim_invalid"); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("canonicalizes the deployment destination without accepting embedded credentials or query overrides", () => {
    expect(providerApiWorkerTarget("http://127.0.0.1:29821/")).toBe("http://127.0.0.1:29821");
    for (const url of ["file:///tmp/worker", "http://key@127.0.0.1:29821", "http://:key@127.0.0.1:29821", "http://127.0.0.1:29821?key=value", "http://127.0.0.1:29821#other"]) expect(() => providerApiWorkerTarget(url)).toThrow("api_worker_target_invalid");
  });
});

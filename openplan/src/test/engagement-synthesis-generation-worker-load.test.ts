// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkedSynthesisWorkerJob, loadSynthesisWorkerAuthorization, loadSynthesisWorkerJob, loadSynthesisWorkerCredential } from "@/lib/engagement/synthesis-generation-worker-load";
import { synthesisWorkerFixture, synthesisWorkerHash } from "./fixtures/engagement/synthesis-worker";

const fixtures: Awaited<ReturnType<typeof synthesisWorkerFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); vi.unstubAllEnvs(); });
async function fixture() { const f = await synthesisWorkerFixture(); fixtures.push(f); return f; }
const selection = (f: Awaited<ReturnType<typeof fixture>>) => ({ authorizationId: f.args.authorizationId, taskIndex: 0, attemptId: randomUUID() });
describe("synthesis worker authoritative loading", () => {
  it("reconstructs the saved source and asserts every query projection and scope", async () => {
    const f = await fixture(), chosen = selection(f), job = await loadSynthesisWorkerJob(f.service, chosen, f.args.signal);
    const revision = await loadSynthesisWorkerCredential(f.service, job, f.args.signal);
    expect(job.binding).toMatchObject({ attemptId: chosen.attemptId, taskSha256: f.task.sha256, planSha256: f.plan.header.taskManifestSha256 });
    expect(job.taskCanonical).toBe(f.task.canonical); expect(revision.credentialCiphertext).toBe(f.revision.credentialCiphertext);
    const rows = f.rows;
    expect(f.queryTrace.map(({ table, columns, filters }) => ({ table, columns, filters }))).toEqual([
      { table: "engagement_synthesis_generation_authorizations", columns: "id,request_id,intent_text,intent_sha256,credential_sha256", filters: { id: chosen.authorizationId } },
      { table: "engagement_synthesis_generation_requests", columns: "id,campaign_id,workspace_id,actor_id,source_id,configuration_revision_id,intent_text,intent_sha256", filters: { id: job.binding.jobId } },
      { table: "engagement_synthesis_sources", columns: "id,campaign_id,workspace_id,snapshot_text,snapshot_sha256,created_at",
        filters: { id: f.saved.requestId, campaign_id: job.campaignId, workspace_id: job.workspaceId } },
      { table: "engagement_synthesis_generation_plans", columns: "request_id,header_text,header_sha256", filters: { request_id: job.binding.jobId } },
      { table: "engagement_synthesis_generation_plan_seals", columns: "request_id,receipt_text,receipt_sha256", filters: { request_id: job.binding.jobId } },
      { table: "engagement_synthesis_generation_plan_tasks", columns: "request_id,task_index,task_text,task_sha256,task_bytes", filters: { request_id: job.binding.jobId, task_index: 0 } },
      { table: "workspace_provider_api_revisions", columns: "id,connection_id,workspace_id,configuration,configuration_canonical,configuration_hash",
        filters: { id: job.binding.configurationRevisionId, connection_id: job.connectionId, workspace_id: job.workspaceId } },
      { table: "workspace_provider_api_credentials", columns: "revision_id,connection_id,workspace_id,credential_ciphertext",
        filters: { revision_id: rows.workspace_provider_api_credentials.revision_id, connection_id: job.connectionId, workspace_id: job.workspaceId } },
    ]);
    expect(f.queryTrace.every(query => query.signal instanceof AbortSignal)).toBe(true);
    expect(f.rpcTrace.map(({ name, values }) => ({ name, values }))).toEqual([
      { name: "read_engagement_synthesis_generation_plan", values: { p_request: job.binding.jobId } },
    ]);
    expect(f.providerCalls).toHaveLength(0);
  });
  it.each([
    ["engagement_synthesis_generation_authorizations", "id"], ["engagement_synthesis_generation_authorizations", "intent_sha256"],
    ["engagement_synthesis_generation_requests", "id"], ["engagement_synthesis_generation_requests", "source_id"],
    ["engagement_synthesis_generation_requests", "configuration_revision_id"],
    ["engagement_synthesis_sources", "id"], ["engagement_synthesis_sources", "campaign_id"], ["engagement_synthesis_sources", "workspace_id"],
    ["engagement_synthesis_generation_plans", "request_id"], ["engagement_synthesis_generation_plans", "header_text"],
    ["engagement_synthesis_generation_plans", "header_sha256"], ["engagement_synthesis_generation_plan_seals", "request_id"],
    ["engagement_synthesis_generation_plan_seals", "receipt_text"], ["engagement_synthesis_generation_plan_seals", "receipt_sha256"],
    ["engagement_synthesis_sources", "snapshot_sha256"], ["engagement_synthesis_generation_plan_tasks", "request_id"],
    ["engagement_synthesis_generation_plan_tasks", "task_index"], ["engagement_synthesis_generation_plan_tasks", "task_text"],
    ["engagement_synthesis_generation_plan_tasks", "task_sha256"], ["engagement_synthesis_generation_plan_tasks", "task_bytes"],
  ])("refuses changed %s.%s before claim", async (table, column) => {
    const f = await fixture(); f.rows[table][column] = column.includes("sha256") ? "0".repeat(64) :
      column === "task_bytes" || column === "task_index" ? 1 : column === "task_text" ? "{}" : randomUUID();
    await expect(loadSynthesisWorkerJob(f.service, selection(f), f.args.signal)).rejects.toThrow();
    if (table === "engagement_synthesis_generation_authorizations") expect(f.queryTrace).toHaveLength(1);
    if (table === "engagement_synthesis_generation_requests") expect(f.queryTrace).toHaveLength(2);
    expect(f.rpcTrace.some(row => row.name.startsWith("claim_"))).toBe(false); expect(f.providerCalls).toHaveLength(0);
  });
  it("refuses task bytes that are internally consistent but differ from the saved source", async () => {
    const f = await fixture(), task = JSON.parse(f.task.canonical); task.input.extra = "SYNTHETIC substituted input";
    const text = JSON.stringify(task);
    Object.assign(f.rows.engagement_synthesis_generation_plan_tasks, { task_text: text, task_sha256: synthesisWorkerHash(text), task_bytes: Buffer.byteLength(text) });
    await expect(loadSynthesisWorkerJob(f.service, selection(f), f.args.signal)).rejects.toThrow("retained identity differs");
  });
  it.each(["cancelled", "unsealed", "out-of-range", "grant-header", "grant-expired", "retry-pair", "retry-task", "retry-allowance"])("refuses %s", async mode => {
    const f = await fixture(), chosen = selection(f);
    if (mode === "cancelled") f.planState.cancelled = true;
    if (mode === "unsealed") Object.assign(f.planState, { seal: null });
    if (mode === "out-of-range") chosen.taskIndex = f.plan.entries.length;
    if (mode === "grant-header") f.authorizationIntent.headerSha256 = "a".repeat(64);
    if (mode === "grant-expired") f.authorizationIntent.expiresAt = "2026-01-01T00:00:00Z";
    if (mode === "retry-pair") f.authorizationIntent.retryOfAttemptId = randomUUID();
    if (mode === "retry-task" || mode === "retry-allowance") Object.assign(f.authorizationIntent, {
      retryOfAttemptId: randomUUID(), retryTaskIndex: mode === "retry-task" ? 1 : 0, maxAttempts: mode === "retry-allowance" ? 2 : 1 });
    f.resealGrant();
    await expect(loadSynthesisWorkerJob(f.service, chosen, f.args.signal)).rejects.toThrow();
    if (mode === "out-of-range") expect(f.queryTrace.some(row => row.table === "engagement_synthesis_generation_plan_tasks")).toBe(false);
  });
  it.each(["oversized-allowance", "retry-outside-plan", "retry-allowance", "header", "retry-pair"])("refuses invalid immutable authorization %s before task loading", async mode => {
    const f = await fixture();
    if (mode === "oversized-allowance") f.authorizationIntent.maxAttempts = f.plan.entries.length + 1;
    if (mode === "retry-outside-plan") Object.assign(f.authorizationIntent, { retryTaskIndex: f.plan.entries.length, retryOfAttemptId: randomUUID(), maxAttempts: 1 });
    if (mode === "retry-allowance") Object.assign(f.authorizationIntent, { retryTaskIndex: 0, retryOfAttemptId: randomUUID(), maxAttempts: 2 });
    if (mode === "header") f.authorizationIntent.headerSha256 = "e".repeat(64);
    if (mode === "retry-pair") Object.assign(f.authorizationIntent, { retryTaskIndex: 0, maxAttempts: 1 });
    f.resealGrant();
    await expect(loadSynthesisWorkerAuthorization(f.service, f.args.authorizationId, f.args.signal)).rejects.toThrow("retained identity differs");
    expect(f.queryTrace.some(row => row.table === "engagement_synthesis_generation_plan_tasks")).toBe(false);
  });
  it("retains an explicit matching retry without choosing another task", async () => {
    const f = await fixture(); Object.assign(f.authorizationIntent, { retryTaskIndex: 0, retryOfAttemptId: randomUUID(), maxAttempts: 1 }); f.resealGrant();
    const job = await loadSynthesisWorkerJob(f.service, selection(f), f.args.signal);
    expect(checkedSynthesisWorkerJob(job).intent.retryOfAttemptId).toBe(f.authorizationIntent.retryOfAttemptId);
  });
  it.each([
    ["workspace_provider_api_revisions", "id"], ["workspace_provider_api_revisions", "connection_id"], ["workspace_provider_api_revisions", "workspace_id"],
    ["workspace_provider_api_revisions", "configuration_hash"], ["workspace_provider_api_revisions", "configuration_canonical"],
    ["workspace_provider_api_credentials", "revision_id"], ["workspace_provider_api_credentials", "connection_id"],
    ["workspace_provider_api_credentials", "workspace_id"], ["workspace_provider_api_credentials", "credential_ciphertext"],
  ])("refuses changed credential row %s.%s", async (table, column) => {
    const f = await fixture(), job = await loadSynthesisWorkerJob(f.service, selection(f), f.args.signal);
    f.rows[table][column] = column === "configuration_hash" ? "a".repeat(64) : column === "configuration_canonical" ? "{}" : column === "credential_ciphertext" ? null : randomUUID();
    if (table === "workspace_provider_api_revisions" && column === "id") f.rows.workspace_provider_api_credentials.revision_id = f.rows[table].id;
    if (column === "configuration_hash" || column === "configuration_canonical") {
      const configuration = { ...f.revision.configuration, label: "SYNTHETIC consistent changed revision" }, text = JSON.stringify(configuration);
      Object.assign(f.rows[table], { configuration, configuration_canonical: text,
        configuration_hash: column === "configuration_hash" ? synthesisWorkerHash(text) : job.binding.configurationHash });
    }
    await expect(loadSynthesisWorkerCredential(f.service, job, f.args.signal)).rejects.toThrow("retained identity differs");
  });
  it("refuses a rehashed revision whose structured configuration differs", async () => {
    const f = await fixture(), job = await loadSynthesisWorkerJob(f.service, selection(f), f.args.signal);
    const text = JSON.stringify({ ...f.revision.configuration, label: "SYNTHETIC changed" }), hash = synthesisWorkerHash(text);
    Object.assign(f.rows.workspace_provider_api_revisions, { configuration_canonical: text, configuration_hash: hash }); job.binding.configurationHash = hash;
    await expect(loadSynthesisWorkerCredential(f.service, job, f.args.signal)).rejects.toThrow("retained identity differs");
  });
  it("keeps failed row and plan reads unavailable", async () => {
    const f = await fixture(); f.options.failRow = "engagement_synthesis_generation_authorizations";
    await expect(loadSynthesisWorkerJob(f.service, selection(f), f.args.signal)).rejects.toThrow("retained row unavailable");
    f.options.failRow = ""; f.options.failPlan = true;
    await expect(loadSynthesisWorkerJob(f.service, selection(f), f.args.signal)).rejects.toThrow("plan unavailable");
  });
  it("stops a pre-aborted load before any query", async () => {
    const f = await fixture(); f.controller.abort();
    await expect(loadSynthesisWorkerJob(f.service, { ...selection(f), authorizationId: "invalid" }, f.args.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(f.from).not.toHaveBeenCalled();
  });
  it("stops between row reads when cancellation arrives", async () => {
    const f = await fixture(), chosen = selection(f);
    Object.defineProperty(f.rows.engagement_synthesis_generation_authorizations, "id", { enumerable: true, get() { f.controller.abort(); return chosen.authorizationId; } });
    await expect(loadSynthesisWorkerJob(f.service, chosen, f.args.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(f.queryTrace).toHaveLength(1);
  });
});

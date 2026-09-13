// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => { throw new Error("Synthetic unavailable service"); } }));
import { prepareTranslationCredential } from "@/lib/integrations/translation-credentials";
import { runTranslationGenerationWorkerCycle, TRANSLATION_WORKER_FIELD_COLUMNS, TRANSLATION_WORKER_REQUEST_COLUMNS } from "@/lib/engagement/translation-generation-worker";
import { createTranslationGeneration } from "@/lib/engagement/translation-generation";
import { writeConnectorJournal } from "../../../workers/planner_agent_connector/connector-worker.mjs";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
beforeEach(() => {
  vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "SYNTHETIC-TRANSLATION-SECRET-0123456789");
  vi.stubEnv("ANTHROPIC_API_KEY", "SYNTHETIC-ENV-KEY");
});
afterEach(() => vi.unstubAllEnvs());
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "openplan-translation-worker-test-"));
  const workspaceId = randomUUID(), requestId = randomUUID(), campaignId = randomUUID(), fieldId = randomUUID();
  const credential = prepareTranslationCredential({ workspaceId, requestId, credentialId: randomUUID(), source: "env", modelId: "synthetic-model", apiKey: "SYNTHETIC-ENV-KEY" });
  const packetCanonical = JSON.stringify({ schemaVersion: 1, workspaceId, campaignId, fieldId, sourceText: "Synthetic source", targetLanguage: "es" });
  const binding = { workspaceId, requestId, campaignId, fieldId, credentialId: credential.credentialId, configurationHash: credential.configurationHash,
    packetHash: hash(packetCanonical), attemptId: randomUUID(), reservationId: randomUUID(), leaseExpiresAt: new Date(Date.now() + 180000).toISOString() };
  const job = { binding, packetCanonical, model: credential.configuration.modelId, credentialSource: credential.source };
  const field = { id: fieldId, request_id: requestId, packet_canonical: packetCanonical, packet_hash: binding.packetHash, state: "queued",
    attempt_id: null as string | null, reservation_id: null as string | null, lease_expires_at: null as string | null };
  const request = { id: requestId, workspace_id: workspaceId, campaign_id: campaignId, credential, selected_key_ciphertext_hash: null };
  const result = { status: "completed" as const, output: " Traducción sintética. ", receipt: { schemaVersion: 1 as const, provider: "anthropic" as const, ...binding,
    model: credential.configuration.modelId, credentialSource: credential.source, recipeVersion: 1 as const, targetLanguage: "es" as const,
    sourceHash: hash("Synthetic source"), outputHash: hash(" Traducción sintética. "), finishReason: "stop" as const,
    responseId: "SYNTHETIC\0ID", reportedModel: "synthetic\ud800", inputTokens: null, outputTokens: 7 } };
  const target = "http://127.0.0.1:29821";
  const journal = async () => JSON.parse(await readFile(join(directory, "pending.json"), "utf8"));
  const lookup = vi.fn(async (table: string): Promise<{ data: unknown; error: unknown }> => ({ data:
    table === "workspace_integration_keys" ? [] : table === "engagement_translation_generation_requests" ? request : field.state === "queued" ? { ...field } : null, error: null }));
  const queries: Array<{ table: string; calls: Array<[string, ...unknown[]]> }> = [];
  const from = vi.fn((table: string) => {
    const trace = { table, calls: [] as Array<[string, ...unknown[]]> }; queries.push(trace);
    const query: Record<string, unknown> = {};
    for (const name of ["select", "eq", "order", "or", "limit", "abortSignal"]) query[name] = (...values: unknown[]) => { trace.calls.push([name, ...values]); return query; };
    query.maybeSingle = query.single = () => lookup(table);
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => lookup(table).then(resolve, reject);
    return query;
  });
  type Reply = { data: unknown; error: { code: string } | null };
  const claim = vi.fn(async (): Promise<Reply> => {
    Object.assign(field, { state: "reserved", attempt_id: binding.attemptId, reservation_id: binding.reservationId, lease_expires_at: binding.leaseExpiresAt });
    return { data: { ...field }, error: null };
  });
  const authorize = vi.fn(async (): Promise<Reply> => {
    expect(await journal()).toMatchObject({ phase: "running", job });
    field.state = "running";
    return { data: { fieldId, attemptId: binding.attemptId, reservationId: binding.reservationId, state: "running", leaseExpiresAt: binding.leaseExpiresAt }, error: null };
  });
  const current = vi.fn(async (): Promise<Reply> => ({ data: { fieldId, attemptId: binding.attemptId, state: field.state, failureCode: null, leaseExpiresAt: binding.leaseExpiresAt }, error: null }));
  const stop = vi.fn(async (a: Record<string, unknown>): Promise<Reply> => {
    field.state = String(a.p_state);
    return { data: { fieldId, attemptId: a.p_attempt, state: a.p_state, failureCode: a.p_code }, error: null };
  });
  const retain = vi.fn(async (a: Record<string, unknown>): Promise<Reply> => {
    expect(await journal()).toMatchObject({ phase: "completed", delivery: { kind: "output", value: { digest: a.p_digest } } });
    if (field.state === "running") field.state = String(a.p_status);
    return { data: { fieldId, attemptId: binding.attemptId, status: a.p_status, state: field.state, digest: a.p_digest }, error: null };
  });
  const rpc = vi.fn((name: string, a: Record<string, unknown>) => ({ abortSignal: async (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (name === "claim_translation_generation_field") return claim();
    if (name === "authorize_translation_generation_dispatch") return authorize();
    if (name === "read_translation_generation_status") return current();
    if (name === "stop_translation_generation_field") return stop(a);
    if (name === "retain_translation_generation_output") return retain(a);
    throw new Error(`Unexpected RPC ${name}`);
  } }));
  const invoke = vi.fn(async () => { expect(await journal()).toMatchObject({ phase: "running", job }); return result; });
  const generate = vi.fn<typeof createTranslationGeneration>(() => invoke);
  const controller = new AbortController();
  const service = { from, rpc } as unknown as Parameters<typeof runTranslationGenerationWorkerCycle>[0]["service"];
  const run = (overrides: Partial<Parameters<typeof runTranslationGenerationWorkerCycle>[0]> = {}) => runTranslationGenerationWorkerCycle({ service,
    directory, target, signal: controller.signal, generate, statusIntervalMs: 5, ...overrides });
  return { field, request, binding, job, result, directory, target, journal, lookup, queries, from, claim, authorize, current, stop, retain, rpc, generate, invoke, controller, run };
}
describe("durable translation worker", () => {
  it("claims with exact projections, journals before dispatch and retains exact output without credentials", async () => {
    const f = await fixture();
    expect(await f.run()).toEqual({ state: "completed", fieldId: f.field.id });
    expect(f.claim).toHaveBeenCalledOnce(); expect(f.authorize).toHaveBeenCalledOnce(); expect(f.invoke).toHaveBeenCalledOnce();
    expect(f.lookup.mock.calls.filter(([t]) => t === "workspace_integration_keys")).toHaveLength(2);
    expect(f.queries[0].calls).toEqual([["select", TRANSLATION_WORKER_FIELD_COLUMNS], ["or", expect.stringMatching(/^state.eq.queued,and\(state.in.\(reserved,running\),lease_expires_at.lte\./)], ["order", "request_id"], ["order", "ordinal"], ["limit", 1], ["abortSignal", expect.any(AbortSignal)]]);
    expect(TRANSLATION_WORKER_FIELD_COLUMNS).toBe("id,request_id,packet_canonical,packet_hash,state,attempt_id,reservation_id,lease_expires_at");
    expect(TRANSLATION_WORKER_REQUEST_COLUMNS).toBe("id,workspace_id,campaign_id,credential,selected_key_ciphertext_hash");
    expect(f.queries[1].calls).toEqual([["select", TRANSLATION_WORKER_REQUEST_COLUMNS], ["eq", "id", f.field.request_id], ["abortSignal", expect.any(AbortSignal)]]);
    const saved = await f.journal();
    expect(saved).toMatchObject({ phase: "delivered", acknowledgedState: "completed", delivery: { kind: "output", value: { outputJson: JSON.stringify(f.result.output) } } });
    expect(JSON.stringify(saved)).not.toContain(f.request.credential.credentialCiphertext);
    expect(JSON.stringify(saved)).not.toContain("SYNTHETIC-ENV-KEY");
    expect((await stat(join(f.directory, "pending.json"))).mode & 0o777).toBe(0o600);
    expect(await f.run()).toEqual({ state: "idle" }); expect(f.invoke).toHaveBeenCalledOnce();
  });
  it("recovers a running journal without reading keys, authorizing or invoking", async () => {
    const f = await fixture(); f.field.state = "running";
    await writeConnectorJournal(f.directory, { version: 1, target: f.target, phase: "running", job: f.job });
    expect(await f.run()).toEqual({ state: "interrupted", fieldId: f.field.id });
    expect(f.from).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled(); expect(f.authorize).not.toHaveBeenCalled();
    expect(f.stop).toHaveBeenCalledWith({ p_field: f.field.id, p_attempt: f.binding.attemptId, p_state: "interrupted", p_code: "translation_worker_interrupted" });
  });
  it.each([false, true])("replays only saved bytes after output acknowledgement loss, committed=%s", async committed => {
    const f = await fixture(); const finish = f.retain.getMockImplementation()!;
    f.retain.mockImplementationOnce(async a => { if (committed) await finish(a); return { data: null, error: { code: "FETCH_ERROR" } }; });
    await expect(f.run()).rejects.toThrow("translation_worker_database_failed");
    expect((await f.journal()).phase).toBe("completed");
    vi.stubEnv("ANTHROPIC_API_KEY", "SYNTHETIC-ROTATED-KEY");
    if (!committed) f.field.state = "cancelled";
    expect((await f.run()).state).toBe(committed ? "completed" : "cancelled");
    expect(f.retain.mock.calls[0][0]).toEqual(f.retain.mock.calls[1][0]);
    expect(f.invoke).toHaveBeenCalledOnce(); expect(f.claim).toHaveBeenCalledOnce();
    expect(f.lookup.mock.calls.filter(([t]) => t === "workspace_integration_keys")).toHaveLength(2);
  });
  it("does not invoke after dispatch acknowledgement loss", async () => {
    const f = await fixture(); f.authorize.mockImplementationOnce(async () => { f.field.state = "running"; return { data: null, error: { code: "FETCH_ERROR" } }; });
    expect((await f.run()).state).toBe("interrupted"); expect(f.invoke).not.toHaveBeenCalled();
  });
  it.each(["fieldId", "attemptId", "reservationId", "leaseExpiresAt", "state"])("does not invoke after a changed dispatch %s", async key => {
    const f = await fixture(); const authorize = f.authorize.getMockImplementation()!;
    f.authorize.mockImplementationOnce(async () => { const r = await authorize(); return { ...r, data: { ...r.data as object, [key]: key === "state" ? "reserved" : key === "leaseExpiresAt" ? new Date(Date.now() + 90000).toISOString() : randomUUID() } }; });
    expect((await f.run()).state).toBe("interrupted"); expect(f.invoke).not.toHaveBeenCalled();
  });
  it.each(["fieldId", "attemptId", "status", "digest"])("preserves output after a changed delivery acknowledgement %s", async key => {
    const f = await fixture(); const retain = f.retain.getMockImplementation()!;
    f.retain.mockImplementationOnce(async a => { const r = await retain(a); return { ...r, data: { ...r.data as object, [key]: key === "status" ? "incomplete" : key === "digest" ? "a".repeat(64) : randomUUID() } }; });
    await expect(f.run()).rejects.toThrow("translation_worker_identity_mismatch");
    expect((await f.journal()).phase).toBe("completed"); expect((await f.run()).state).toBe("completed"); expect(f.invoke).toHaveBeenCalledOnce();
  });
  it.each(["before_claim", "after_claim"])("refuses an environment-key change %s without invoking", async when => {
    const f = await fixture();
    if (when === "before_claim") vi.stubEnv("ANTHROPIC_API_KEY", "SYNTHETIC-NEW-KEY");
    else { const claim = f.claim.getMockImplementation()!; f.claim.mockImplementationOnce(async () => { const r = await claim(); vi.stubEnv("ANTHROPIC_API_KEY", "SYNTHETIC-NEW-KEY"); return r; }); }
    expect((await f.run()).state).toBe(when === "before_claim" ? "failed" : "interrupted");
    expect(f.authorize).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
    expect(f.claim).toHaveBeenCalledTimes(when === "before_claim" ? 0 : 1);
  });
  it.each(["cancelled", "read_failure", "lease_changed"])("aborts the provider when status becomes %s", async kind => {
    const f = await fixture(); let observedAbort = false;
    f.generate.mockImplementation(args => async () => new Promise((_resolve, reject) => {
      let settled = false;
      const deadline = setTimeout(() => { settled = true; reject(new Error("Abort not observed")); }, 1000);
      args.signal.addEventListener("abort", () => { if (settled) return; settled = true; observedAbort = true; clearTimeout(deadline); reject(new Error("Stopped")); }, { once: true });
      if (kind === "cancelled") f.field.state = "cancelled";
      else if (kind === "read_failure") f.current.mockResolvedValueOnce({ data: null, error: { code: "FETCH_ERROR" } });
      else { const current = f.current.getMockImplementation()!; f.current.mockImplementationOnce(async () => { const r = await current(); return { ...r, data: { ...r.data as object, leaseExpiresAt: new Date(Date.now() + 90000).toISOString() } }; }); }
    }));
    expect((await f.run()).state).toBe(kind === "cancelled" ? "cancelled" : "interrupted"); expect(observedAbort).toBe(true);
  });
  it("refuses moving a pending journal to another database before any query", async () => {
    const f = await fixture(); await writeConnectorJournal(f.directory, { version: 1, target: f.target, phase: "running", job: f.job });
    await expect(f.run({ target: "http://127.0.0.1:9999" })).rejects.toThrow("translation_worker_identity_mismatch");
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.from).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
  });
  it("expires an orphaned attempt through status without claiming another attempt", async () => {
    const f = await fixture();
    f.lookup.mockResolvedValueOnce({ data: { ...f.field, state: "running", attempt_id: f.binding.attemptId, reservation_id: f.binding.reservationId,
      lease_expires_at: new Date(Date.now() - 1000).toISOString() }, error: null });
    f.current.mockResolvedValueOnce({ data: { fieldId: f.field.id, attemptId: f.binding.attemptId, state: "interrupted", failureCode: "translation_attempt_expired", leaseExpiresAt: f.binding.leaseExpiresAt }, error: null });
    expect((await f.run()).state).toBe("interrupted"); expect(f.claim).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
  });
  it.each(["id", "request_id", "packet_canonical", "packet_hash", "attempt_id", "reservation_id", "lease_expires_at", "state"])("refuses a changed claimed %s before journaling or dispatch", async key => {
    const f = await fixture(); const claim = f.claim.getMockImplementation()!;
    f.claim.mockImplementationOnce(async () => { const r = await claim(); return { ...r, data: { ...r.data as object,
      [key]: key === "id" || key === "request_id" ? randomUUID() : key === "packet_canonical" ? f.job.packetCanonical.replace("Synthetic source", "Changed source") : key === "packet_hash" ? "b".repeat(64) : key === "state" ? "running" : null } }; });
    await expect(f.run()).rejects.toThrow("translation_worker_identity_mismatch");
    expect(f.generate).not.toHaveBeenCalled(); expect(f.authorize).not.toHaveBeenCalled();
  });
  it.each(["sourceHash", "targetLanguage", "model", "attemptId"])("refuses generated output with changed receipt %s", async key => {
    const f = await fixture();
    f.invoke.mockImplementationOnce(async () => ({ ...f.result, receipt: { ...f.result.receipt,
      [key]: key === "sourceHash" ? "b".repeat(64) : key === "targetLanguage" ? "fr" : key === "model" ? "other-model" : randomUUID() } }));
    expect((await f.run()).state).toBe("interrupted"); expect(f.retain).not.toHaveBeenCalled();
  });
  it("refuses a changed pending packet before any query", async () => {
    const f = await fixture();
    await writeConnectorJournal(f.directory, { version: 1, target: f.target, phase: "running", job: { ...f.job, packetCanonical: f.job.packetCanonical.replace("Synthetic source", "Changed source") } });
    await expect(f.run()).rejects.toThrow("translation_worker_identity_mismatch"); expect(f.rpc).not.toHaveBeenCalled(); expect(f.from).not.toHaveBeenCalled();
  });
  it.each(["PT409", "42501"])("terminates an unclaimed stale field on %s without spending", async code => {
    const f = await fixture(); f.claim.mockResolvedValueOnce({ data: null, error: { code } });
    expect((await f.run()).state).toBe("failed"); expect(f.authorize).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
    expect(f.stop).toHaveBeenCalledWith({ p_field: f.field.id, p_attempt: null, p_state: "failed", p_code: "translation_scope_changed" });
  });
  it("keeps a quota-limited field queued for later without spending", async () => {
    const f = await fixture(); f.claim.mockResolvedValueOnce({ data: null, error: { code: "PT429" } });
    await expect(f.run()).rejects.toThrow("translation_worker_database_failed"); expect(f.field.state).toBe("queued");
    expect(f.stop).not.toHaveBeenCalled(); expect(f.authorize).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
  });

});

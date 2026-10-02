// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareProviderApiRevision } from "@/lib/integrations/provider-api-credentials";
import { createSynthesisGenerationPlan } from "@/lib/engagement/synthesis-generation-plan";
import { createSynthesisGenerationApiAttempt, createSynthesisContextApiAttempt, createSynthesisThematicApiAttempt, type SynthesisGenerationApiObservation } from "@/lib/engagement/synthesis-generation-api";
import { createSynthesisContextContinuation } from "@/lib/engagement/synthesis-context-continuation";
import { thematicContinuationFixture, thematicSyntheticResponse } from "./fixtures/engagement/synthesis-thematic-continuation";
import { contextInputFixture } from "./fixtures/engagement/synthesis-context";
import { verifySynthesisGenerationApiResult } from "@/lib/engagement/synthesis-generation-api-result";
import { type SynthesisGenerationAttemptBinding } from "@/lib/engagement/synthesis-generation-results";
import { makeSourceSnapshot, savedSource, sourceScope } from "./fixtures/engagement/synthesis-source";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.unstubAllEnvs(); });
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
async function fixture(authMode: "api_key" | "none" = "api_key", reply?: (res: ServerResponse) => void) {
  vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "SYNTHETIC-SYNTHESIS-TEST-SECRET");
  vi.stubEnv("OPENAI_API_KEY", "MUST-NOT-USE-AMBIENT");
  const calls: Array<{ auth: string | undefined; path: string | undefined; body: string }> = [];
  const arrived = Promise.withResolvers<void>();
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    calls.push({ auth: req.headers.authorization, path: req.url, body: Buffer.concat(chunks).toString() });
    arrived.resolve(); res.setHeader("content-type", "application/json");
    if (reply) reply(res);
    else res.end(JSON.stringify({ model: "synthetic-model", id: "synthetic-response", choices: [{ finish_reason: "length",
      message: { role: "assistant", content: "SYNTHETIC\n\u0000\ud800🌉" } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections(); server.close(error => error ? reject(error) : resolve());
  }));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`;
  vi.stubEnv("OPENPLAN_AI_LOCAL_ENDPOINTS", JSON.stringify([endpoint]));
  const revision = { ...prepareProviderApiRevision({ workspaceId: sourceScope.workspaceId, revisionId: randomUUID(), configuration: {
    label: "Synthetic source provider", protocol: "openai_chat_completions", endpoint, modelIds: ["synthetic-model"],
    structuredOutput: true, authMode, timeoutSeconds: 30 }, apiKey: authMode === "none" ? null : "SYNTHETIC-EXACT-KEY" }), connectionId: randomUUID() };
  const saved = savedSource(makeSourceSnapshot(2));
  const intentText = JSON.stringify({ schemaVersion: 1, sourceId: sourceScope.requestId, sourceSha256: saved.snapshotSha256,
    connectionId: revision.connectionId, configurationRevisionId: revision.revisionId, configurationHash: revision.configurationHash,
    modelId: "synthetic-model", taskByteLimit: 4096 });
  const request = { id: randomUUID(), intentText, intentSha256: sha(intentText) };
  const plan = createSynthesisGenerationPlan(request, saved, sourceScope), task = plan.entries[0];
  const binding: SynthesisGenerationAttemptBinding = { jobId: request.id, planSha256: plan.header.taskManifestSha256,
    configurationRevisionId: revision.revisionId, configurationHash: revision.configurationHash, provider: "api_connection",
    modelId: "synthetic-model", taskSha256: task.sha256, attemptId: randomUUID() };
  const workerId = randomUUID(), authorizationId = randomUUID();
  const receipt = { schemaVersion: 1, attemptId: binding.attemptId, workerId, authorizationId, binding,
    maxOutputTokens: 8192, responseByteLimit: 4096,
    expiresAt: new Date(Date.now() + 60_000).toISOString(), authorizedAt: new Date(Date.now() - 1000).toISOString() };
  const dispatch = { schemaVersion: 1, authorizedNow: true, receiptText: JSON.stringify(receipt), receiptSha256: sha(JSON.stringify(receipt)) };
  const controller = new AbortController();
  const observations: SynthesisGenerationApiObservation[] = [];
  const retainReceipt = vi.fn(async (observation: SynthesisGenerationApiObservation) => { observations.push(structuredClone(observation)); });
  const args = { binding, taskCanonical: task.canonical, dispatch, workerId, authorizationId,
    workspaceId: sourceScope.workspaceId, connectionId: revision.connectionId,
    credentialSha256: revision.credentialCiphertext === null ? null : sha(revision.credentialCiphertext), revision, retainReceipt, signal: controller.signal };
  return { args, calls, task, plan, receipt, controller, observations, arrived: arrived.promise,
    reseal: () => { dispatch.receiptText = JSON.stringify(receipt); dispatch.receiptSha256 = sha(dispatch.receiptText); } };
}
describe("one native-dispatched synthesis API attempt", () => {
  async function thematicFixture(stage: "frame" | "proposal" = "frame") {
    const f=await fixture(), thematic=thematicContinuationFixture(),processor=thematic.create();let next=processor.next();
    while(stage==="proposal"&&next.status==="ready"&&next.stage==="frame"){
      processor.accept({taskSha256:next.task.sha256,outputText:JSON.stringify(thematicSyntheticResponse(next)),finishReason:"stop"});next=processor.next();
    }
    if(next.status!=="ready")throw new Error("SYNTHETIC thematic task unavailable");
    f.args.taskCanonical=next.task.canonical;const input=JSON.parse(next.task.canonical).input;
    Object.assign(f.args.binding,{jobId:input.requestId,planSha256:input.headerSha256,taskSha256:next.task.sha256});f.reseal();return f;
  }
  it.each(["frame","proposal"] as const)("sends the separately frozen thematic %s task once",async stage=>{
    const f=await thematicFixture(stage),invoke=createSynthesisThematicApiAttempt(f.args),result=await invoke(),task=JSON.parse(f.args.taskCanonical);
    expect(JSON.parse(f.calls[0].body)).toEqual({model:f.args.binding.modelId,max_tokens:f.receipt.maxOutputTokens,
      messages:[{role:"system",content:task.instructions},{role:"user",content:f.args.taskCanonical}],
      response_format:{type:"json_schema",json_schema:{name:`synthesis_thematic_${stage}_v1`,strict:true,schema:task.outputSchema}}});
    expect(f.observations).toHaveLength(1);expect(verifySynthesisGenerationApiResult(f.args.binding,result,{dispatchSha256:f.args.dispatch.receiptSha256,responseByteLimit:f.receipt.responseByteLimit}).capture.outputText).toBe("SYNTHETIC\n\u0000\ud800🌉");
    await expect(invoke()).rejects.toThrow("already consumed");expect(f.calls).toHaveLength(1);
  });
  it.each(["purpose","requestId","headerSha256","stage"])("refuses rehashed thematic identity %s",async field=>{
    const f=await thematicFixture(),task=JSON.parse(f.args.taskCanonical);task.input[field]="wrong";f.args.taskCanonical=JSON.stringify(task);f.args.binding.taskSha256=sha(f.args.taskCanonical);f.reseal();
    expect(()=>createSynthesisThematicApiAttempt(f.args)).toThrow(/thematic (identity|stage) differs/);expect(f.calls).toHaveLength(0);
  });
  it.each(["instructions","outputSchema"])("refuses rehashed thematic recipe %s",async field=>{
    const f=await thematicFixture("proposal"),task=JSON.parse(f.args.taskCanonical);task[field]=field==="instructions"?"wrong":{type:"string"};f.args.taskCanonical=JSON.stringify(task);f.args.binding.taskSha256=sha(f.args.taskCanonical);f.reseal();
    expect(()=>createSynthesisThematicApiAttempt(f.args)).toThrow("recipe differs");expect(f.calls).toHaveLength(0);
  });
  it("keeps thematic tasks separate from segment and context dispatch",async()=>{
    const thematic=await thematicFixture(),segment=await fixture(),context=await contextFixture();
    expect(()=>createSynthesisGenerationApiAttempt(thematic.args)).toThrow();expect(()=>createSynthesisContextApiAttempt(thematic.args)).toThrow();
    expect(()=>createSynthesisThematicApiAttempt(segment.args)).toThrow();expect(()=>createSynthesisThematicApiAttempt(context.args)).toThrow();
    thematic.args.dispatch.authorizedNow=false;expect(()=>createSynthesisThematicApiAttempt(thematic.args)).toThrow();
    expect([...thematic.calls,...segment.calls,...context.calls]).toHaveLength(0);
  });
  async function contextFixture() {
    const f = await fixture(), context = contextInputFixture();
    const continuation = createSynthesisContextContinuation(context.request, context.scope, context.args), next = continuation.next();
    if (next.status !== "ready") throw new Error("SYNTHETIC context task unavailable");
    f.args.taskCanonical = next.task.canonical;
    Object.assign(f.args.binding, { jobId: context.scope.requestId, planSha256: continuation.headerSha256, taskSha256: next.task.sha256 });
    f.reseal(); return f;
  }
  it("sends the frozen context task once and retains its original response", async () => {
    const f = await contextFixture(), invoke = createSynthesisContextApiAttempt(f.args), result = await invoke();
    const task = JSON.parse(f.args.taskCanonical);
    expect(f.calls).toHaveLength(1);
    expect(JSON.parse(f.calls[0].body)).toEqual({ model: f.args.binding.modelId, max_tokens: f.receipt.maxOutputTokens,
      messages: [{ role: "system", content: task.instructions }, { role: "user", content: f.args.taskCanonical }],
      response_format: { type: "json_schema", json_schema: { name: "synthesis_context_v1", strict: true, schema: task.outputSchema } } });
    expect(f.observations).toHaveLength(1);
    expect(verifySynthesisGenerationApiResult(f.args.binding, result, { dispatchSha256: f.args.dispatch.receiptSha256,
      responseByteLimit: f.receipt.responseByteLimit }).capture.outputText).toBe("SYNTHETIC\n\u0000\ud800🌉");
    await expect(invoke()).rejects.toThrow("already consumed"); expect(f.calls).toHaveLength(1);
  });
  it("keeps segment and context recipes separate", async () => {
    const segment = await fixture(), context = await contextFixture();
    expect(() => createSynthesisContextApiAttempt(segment.args)).toThrow("recipe differs");
    expect(() => createSynthesisGenerationApiAttempt(context.args)).toThrow("recipe differs");
    expect(segment.calls).toHaveLength(0); expect(context.calls).toHaveLength(0);
  });
  it.each(["purpose", "requestId", "headerSha256"])("refuses rehashed context input identity %s", async field => {
    const f = await contextFixture(), task = JSON.parse(f.args.taskCanonical);
    task.input[field] = "SYNTHETIC different identity"; f.args.taskCanonical = JSON.stringify(task);
    f.args.binding.taskSha256 = sha(f.args.taskCanonical); f.reseal();
    expect(() => createSynthesisContextApiAttempt(f.args)).toThrow("context identity differs"); expect(f.calls).toHaveLength(0);
  });
  it.each(["instructions", "outputSchema"])("refuses a rehashed context recipe change %s", async field => {
    const f = await contextFixture(), task = JSON.parse(f.args.taskCanonical);
    task[field] = field === "instructions" ? "SYNTHETIC different recipe" : { type: "string" };
    f.args.taskCanonical = JSON.stringify(task); f.args.binding.taskSha256 = sha(f.args.taskCanonical); f.reseal();
    expect(() => createSynthesisContextApiAttempt(f.args)).toThrow("recipe differs"); expect(f.calls).toHaveLength(0);
  });
  it("refuses a recovered context dispatch as new call permission", async () => {
    const f = await contextFixture(); f.args.dispatch.authorizedNow = false;
    expect(() => createSynthesisContextApiAttempt(f.args)).toThrow(); expect(f.calls).toHaveLength(0);
  });
  for (const authMode of ["api_key", "none"] as const) it(`sends exact retained task bytes with ${authMode} credentials`, async () => {
    const f = await fixture(authMode), invoke = createSynthesisGenerationApiAttempt(f.args);
    const result = await invoke();
    const capture = verifySynthesisGenerationApiResult(f.args.binding, result, {
      dispatchSha256: f.args.dispatch.receiptSha256, responseByteLimit: f.receipt.responseByteLimit }).capture;
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ path: "/v1/chat/completions", auth: authMode === "none" ? undefined : "Bearer SYNTHETIC-EXACT-KEY" });
    expect(JSON.parse(f.calls[0].body)).toEqual({ model: f.args.binding.modelId, max_tokens: 8192,
      messages: [{ role: "system", content: JSON.parse(f.task.canonical).instructions }, { role: "user", content: f.task.canonical }],
      response_format: { type: "json_schema", json_schema: { name: "synthesis_segment_v1", strict: true, schema: JSON.parse(f.task.canonical).outputSchema } } });
    expect(capture).toMatchObject({ outcome: "returned", outputText: "SYNTHETIC\n\u0000\ud800🌉", finishReason: "length", inputTokens: null, outputTokens: null });
    expect(result.canonical).not.toContain("SYNTHETIC-EXACT-KEY");
    expect(f.observations).toHaveLength(1);
    expect(f.observations[0]).toMatchObject({ startedAt: capture.startedAt, finishedAt: capture.finishedAt,
      dispatchSha256: f.args.dispatch.receiptSha256, receipt: JSON.parse(capture.providerReceiptText!).transport });
    await expect(invoke()).rejects.toThrow("already consumed"); expect(f.calls).toHaveLength(1);
  });
  it.each(["checksum", "attempt", "worker", "authorization", "binding", "provider", "chronology"])("refuses changed dispatch %s", async mode => {
    const f = await fixture();
    if (mode === "attempt") f.receipt.attemptId = randomUUID();
    if (mode === "worker") f.receipt.workerId = randomUUID();
    if (mode === "authorization") f.receipt.authorizationId = randomUUID();
    if (mode === "binding") f.receipt.binding = { ...f.args.binding, planSha256: "a".repeat(64) };
    if (mode === "provider") f.args.binding.provider = "codex";
    if (mode === "chronology") f.receipt.expiresAt = f.receipt.authorizedAt;
    f.reseal(); if (mode === "checksum") f.args.dispatch.receiptSha256 = "a".repeat(64);
    expect(() => createSynthesisGenerationApiAttempt(f.args)).toThrow("dispatch differs"); expect(f.calls).toHaveLength(0);
  });
  it("refuses a replayed dispatch acknowledgement", async () => {
    const f = await fixture(); f.args.dispatch.authorizedNow = false;
    expect(() => createSynthesisGenerationApiAttempt(f.args)).toThrow(); expect(f.calls).toHaveLength(0);
  });
  it.each(["workspaceId", "connectionId", "revisionId", "configurationHash", "modelId", "credentialSha256"])("refuses changed credential identity %s", async field => {
    const f = await fixture();
    if (field === "workspaceId" || field === "connectionId" || field === "revisionId") f.args.revision[field] = randomUUID();
    if (field === "configurationHash") f.args.revision.configurationHash = "a".repeat(64);
    if (field === "modelId") { f.args.binding.modelId = "other"; f.reseal(); }
    if (field === "credentialSha256") f.args.credentialSha256 = "a".repeat(64);
    expect(() => createSynthesisGenerationApiAttempt(f.args)).toThrow("credential differs"); expect(f.calls).toHaveLength(0);
  });
  it("does not substitute a replaced valid encrypted credential", async () => {
    const f = await fixture(), old = f.args.revision;
    const replacement = prepareProviderApiRevision({ workspaceId: old.workspaceId, revisionId: old.revisionId, configuration: old.configuration, apiKey: "SYNTHETIC-REPLACED" });
    f.args.revision.credentialCiphertext = replacement.credentialCiphertext;
    expect(() => createSynthesisGenerationApiAttempt(f.args)).toThrow("credential differs"); expect(f.calls).toHaveLength(0);
  });
  it("rechecks the encrypted configuration envelope", async () => {
    const f = await fixture(); f.args.revision.configuration.label = "Changed";
    expect(() => createSynthesisGenerationApiAttempt(f.args)).toThrow("api_connection_credential_unavailable"); expect(f.calls).toHaveLength(0);
  });
  it.each(["bytes", "limit", "canonical", "instructions", "output-schema"])("refuses changed task %s", async mode => {
    const f = await fixture(), task = JSON.parse(f.args.taskCanonical);
    if (mode === "instructions") task.instructions = "changed";
    if (mode === "output-schema") task.outputSchema = { type: "string" };
    if (mode === "limit") task.input.extra = "é".repeat(530000);
    if (mode === "bytes") task.input.extra = "SYNTHETIC changed source part";
    f.args.taskCanonical = JSON.stringify(task) + (mode === "canonical" ? " " : "");
    if (mode !== "bytes") { f.args.binding.taskSha256 = sha(f.args.taskCanonical); f.reseal(); }
    expect(() => createSynthesisGenerationApiAttempt(f.args)).toThrow(["bytes", "limit"].includes(mode) ? "task bytes differ" : "task recipe differs");
    expect(f.calls).toHaveLength(0);
  });
  it("snapshots inputs before the caller changes them", async () => {
    const f = await fixture(), original = structuredClone({ binding: f.args.binding, dispatch: f.args.dispatch }), invoke = createSynthesisGenerationApiAttempt(f.args);
    f.args.binding.modelId = "changed"; f.args.taskCanonical = "changed";
    f.args.revision.configuration.endpoint = "https://changed.invalid/"; f.args.revision.credentialCiphertext = null;
    f.receipt.maxOutputTokens = 1; f.reseal();
    const result = await invoke();
    expect(verifySynthesisGenerationApiResult(original.binding, result, { dispatchSha256: original.dispatch.receiptSha256, responseByteLimit: 4096 }).capture.outcome).toBe("returned");
    expect(JSON.parse(f.calls[0].body).max_tokens).toBe(8192); expect(f.calls).toHaveLength(1);
  });
  it("checks expiry at invocation and consumes an expired invocation", async () => {
    const f = await fixture(); f.receipt.authorizedAt = new Date(Date.now() - 2000).toISOString(); f.receipt.expiresAt = new Date(Date.now() - 1000).toISOString(); f.reseal();
    const invoke = createSynthesisGenerationApiAttempt(f.args);
    await expect(invoke()).rejects.toThrow("dispatch expired"); await expect(invoke()).rejects.toThrow("already consumed"); expect(f.calls).toHaveLength(0);
  });
  it("honors abort before construction and between construction and invocation", async () => {
    const f = await fixture(), invoke = createSynthesisGenerationApiAttempt(f.args); f.controller.abort();
    expect(() => createSynthesisGenerationApiAttempt(f.args)).toThrow(); await expect(invoke()).rejects.toThrow(); expect(f.calls).toHaveLength(0);
  });
  it("retains a genuine in-flight interruption and never repeats it", async () => {
    const f = await fixture("none", () => {}), invoke = createSynthesisGenerationApiAttempt(f.args);
    const pending = invoke(); await f.arrived; f.controller.abort();
    const result = await pending;
    expect(verifySynthesisGenerationApiResult(f.args.binding, result, { dispatchSha256: f.args.dispatch.receiptSha256, responseByteLimit: 4096 }).capture)
      .toMatchObject({ outcome: "interrupted", outputText: null });
    await expect(invoke()).rejects.toThrow("already consumed"); expect(f.calls).toHaveLength(1);
  });
  it("uses the earlier native deadline and retains the observed prefix", async () => {
    const f = await fixture("none", res => res.write("SYNTHETIC prefix"));
    f.receipt.expiresAt = new Date(Date.now() + 150).toISOString(); f.reseal();
    const result = await createSynthesisGenerationApiAttempt(f.args)();
    const captured = verifySynthesisGenerationApiResult(f.args.binding, result, { dispatchSha256: f.args.dispatch.receiptSha256, responseByteLimit: 4096 }).capture;
    expect(captured.outcome).toBe("interrupted");
    expect(JSON.parse(captured.providerReceiptText!).transport.bodyBase64).toBe(Buffer.from("SYNTHETIC prefix").toString("base64"));
    expect(f.calls).toHaveLength(1);
  });
  it("waits for receipt custody before returning interpreted output", async () => {
    const f = await fixture(), entered = Promise.withResolvers<void>(), saved = Promise.withResolvers<void>();
    f.args.retainReceipt.mockImplementation(async observation => {
      f.observations.push(structuredClone(observation)); entered.resolve(); await saved.promise;
      observation.receipt.bodyBase64 = "changed";
    });
    const pending = createSynthesisGenerationApiAttempt(f.args)(); let finished = false;
    void pending.then(() => { finished = true; }, () => { finished = true; });
    await entered.promise; await new Promise(resolve => setImmediate(resolve));
    expect(finished).toBe(false); saved.resolve();
    const result = await pending;
    expect(verifySynthesisGenerationApiResult(f.args.binding, result, { dispatchSha256: f.args.dispatch.receiptSha256, responseByteLimit: 4096 }).capture.outputText)
      .toBe("SYNTHETIC\n\u0000\ud800🌉");
  });
  it("does not reinterpret or retry when receipt custody fails", async () => {
    const f = await fixture(); f.args.retainReceipt.mockRejectedValue(new Error("SYNTHETIC journal write failed"));
    const invoke = createSynthesisGenerationApiAttempt(f.args);
    await expect(invoke()).rejects.toThrow("SYNTHETIC journal write failed");
    await expect(invoke()).rejects.toThrow("already consumed"); expect(f.calls).toHaveLength(1);
  });
  it("requires a receipt storage callback before constructing an invocation", async () => {
    const f = await fixture();
    expect(() => createSynthesisGenerationApiAttempt({ ...f.args, retainReceipt: undefined as unknown as typeof f.args.retainReceipt }))
      .toThrow("receipt storage required");
    expect(f.calls).toHaveLength(0);
  });
});

// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProviderApiGeneration, type ProviderApiGenerationBinding } from "@/lib/assistant/provider-api-generation";
import { prepareProviderApiRevision, type StoredProviderApiRevision } from "@/lib/integrations/provider-api-credentials";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.unstubAllEnvs(); });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

async function beforeDeadline<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Generation did not settle within five seconds")), 5000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function fixture(authMode: "api_key" | "none" = "api_key", reply?: (res: ServerResponse, body: Record<string, unknown>) => void) {
  vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "SYNTHETIC-OPERATOR-GENERATION-TEST-SECRET");
  vi.stubEnv("OPENAI_API_KEY", "SYNTHETIC-AMBIENT-KEY-MUST-NOT-BE-USED");
  const workspaceId = randomUUID(), projectId = randomUUID(), revisionId = randomUUID(), connectionId = randomUUID();
  const packet = { version: 1, workspaceId, project: { id: projectId, name: "SYNTHETIC selected project", summary: "SYNTHETIC frozen baseline",
    status: "active", planType: "other", deliveryPhase: "planning", updatedAt: "2026-09-12T00:00:00Z" },
    capturedAt: "2026-09-12T00:00:00Z", source: { id: `project:${projectId}`, label: "SYNTHETIC selected project", href: `/projects/${projectId}` } };
  const output = { answer: "SYNTHETIC grounded answer", citations: [packet.source.id], submittal: {
    projectId, title: "SYNTHETIC draft", submittalType: "progress_report", notes: "SYNTHETIC pending review",
  } };
  const calls: Array<{ path: string | undefined; auth: string | undefined; body: Record<string, unknown> }> = [];
  const arrived = Promise.withResolvers<void>();
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    calls.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) });
    arrived.resolve();
    res.setHeader("content-type", "application/json");
    const body = { id: "SYNTHETIC-response", model: "synthetic-model", choices: [{ index: 0, finish_reason: "stop",
      message: { role: "assistant", content: JSON.stringify(output) } }], usage: { prompt_tokens: 12, completion_tokens: 20, total_tokens: 32 } };
    if (reply) reply(res, body); else res.end(JSON.stringify(body));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/custom/v1/`;
  vi.stubEnv("OPENPLAN_AI_LOCAL_ENDPOINTS", JSON.stringify([endpoint]));
  const revision: StoredProviderApiRevision & { connectionId: string } = { ...prepareProviderApiRevision({ workspaceId, revisionId, configuration: {
    label: "Synthetic provider", protocol: "openai_chat_completions", endpoint, modelIds: ["synthetic-model"], structuredOutput: true,
    authMode, timeoutSeconds: 30 }, apiKey: authMode === "none" ? null : "SYNTHETIC-SAVED-KEY" }), connectionId };
  const packetCanonical = JSON.stringify(packet);
  const binding: ProviderApiGenerationBinding = { turnId: randomUUID(), attemptId: randomUUID(), workspaceId, projectId, connectionId, revisionId,
    configurationHash: revision.configurationHash, packetHash: hash(packetCanonical), modelId: "synthetic-model",
    authMode: authMode === "none" ? "connection_no_key" : "connection_api_key", chargesAcknowledged: true,
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() };
  const controller = new AbortController();
  return { args: { binding, revision, packetCanonical, question: "SYNTHETIC draft request", signal: controller.signal },
    calls, packet, output, endpoint, controller, arrived: arrived.promise };
}

describe("saved API project generation", () => {
  for (const auth of ["api_key", "none"] as const) {
    it(`uses the exact frozen project and ${auth} configuration with the real SDK`, async () => {
      const f = await fixture(auth);
      const run = createProviderApiGeneration(f.args);
      const completed = await run();
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0]).toMatchObject({ path: "/custom/v1/chat/completions", auth: auth === "none" ? undefined : "Bearer SYNTHETIC-SAVED-KEY",
        body: { model: "synthetic-model", max_tokens: 4000, response_format: { type: "json_schema" } } });
      expect(f.calls[0].body.messages).toEqual([{ role: "system", content: expect.stringContaining("A proposal changes nothing") },
        { role: "user", content: JSON.stringify({ question: f.args.question, selectedProjectRecord: f.packet }) }]);
      expect(f.calls[0].body.tools).toBeUndefined();
      expect(completed.result).toMatchObject({ answer: f.output.answer, citations: [f.packet.source],
        proposal: { status: "proposed", kind: "create_project_record", payload: { projectId: f.packet.project.id, recordType: "submittal" } } });
      expect(completed.result.proposal?.payload).toEqual({ kind: "create_project_record", projectId: f.packet.project.id,
        recordType: "submittal", title: f.output.submittal.title, submittalType: "progress_report", notes: f.output.submittal.notes });
      expect(completed.receipt).toEqual({ schemaVersion: 1, provider: "api_connection", model: "synthetic-model", authMode: f.args.binding.authMode,
        turnId: f.args.binding.turnId, attemptId: f.args.binding.attemptId, connectionId: f.args.binding.connectionId,
        revisionId: f.args.binding.revisionId, configurationHash: f.args.binding.configurationHash, packetHash: f.args.binding.packetHash,
        endpoint: f.endpoint, protocol: "openai_chat_completions", responseId: "SYNTHETIC-response", inputTokens: 12, outputTokens: 20 });
      expect(JSON.stringify(completed)).not.toContain("SYNTHETIC-SAVED-KEY");
      await expect(run()).rejects.toMatchObject({ code: "api_attempt_already_consumed" });
      expect(f.calls).toHaveLength(1);
    });
  }

  for (const field of ["workspaceId", "revisionId", "connectionId", "configurationHash", "modelId", "authMode", "projectId", "packetHash", "chargesAcknowledged"] as const) {
    it(`rejects a changed ${field} before a network request`, async () => {
      const f = await fixture();
      const wrong = field === "configurationHash" || field === "packetHash" ? "a".repeat(64) : field === "modelId" ? "another-model" :
        field === "authMode" ? "connection_no_key" : field === "chargesAcknowledged" ? false : randomUUID();
      const changed = { ...f.args, binding: { ...f.args.binding, [field]: wrong } };
      expect(() => createProviderApiGeneration(changed as typeof f.args)).toThrow("api_attempt_binding_invalid");
      expect(f.calls).toHaveLength(0);
    });
  }

  it("rejects a packet edited without a new hash, or a forged source with a new hash", async () => {
    const f = await fixture();
    const packet = structuredClone(f.packet); packet.project.summary = "SYNTHETIC tampered baseline";
    expect(() => createProviderApiGeneration({ ...f.args, packetCanonical: JSON.stringify(packet) })).toThrow("api_attempt_binding_invalid");
    packet.source.href = "/projects/another-project";
    const packetCanonical = JSON.stringify(packet);
    expect(() => createProviderApiGeneration({ ...f.args, packetCanonical, binding: { ...f.args.binding, packetHash: hash(packetCanonical) } }))
      .toThrow("api_attempt_binding_invalid");
    expect(f.calls).toHaveLength(0);
  });

  it("refuses undecryptable saved credentials without an ambient key fallback", async () => {
    const f = await fixture(); vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "SYNTHETIC-OTHER-SECRET");
    expect(() => createProviderApiGeneration(f.args)).toThrow("api_attempt_binding_invalid");
    expect(f.calls).toHaveLength(0);
  });

  it("refuses a validly encrypted revision from another workspace even when the packet matches", async () => {
    const f = await fixture();
    const foreign = prepareProviderApiRevision({ workspaceId: randomUUID(), revisionId: f.args.binding.revisionId,
      configuration: f.args.revision.configuration, apiKey: "SYNTHETIC-SAVED-KEY" });
    f.args.revision = { ...foreign, connectionId: f.args.binding.connectionId };
    expect(() => createProviderApiGeneration(f.args)).toThrow("api_attempt_binding_invalid");
    expect(f.calls).toHaveLength(0);
  });

  it("refuses a correctly hashed foreign-workspace packet even when the revision matches", async () => {
    const f = await fixture();
    f.packet.workspaceId = randomUUID(); f.args.packetCanonical = JSON.stringify(f.packet);
    f.args.binding.packetHash = hash(f.args.packetCanonical);
    expect(() => createProviderApiGeneration(f.args)).toThrow("api_attempt_binding_invalid");
    expect(f.calls).toHaveLength(0);
  });

  it("refuses an oversized canonical packet even if JSON, source and hash are valid", async () => {
    const f = await fixture();
    f.args.packetCanonical = " ".repeat(200_000) + f.args.packetCanonical;
    f.args.binding.packetHash = hash(f.args.packetCanonical);
    expect(() => createProviderApiGeneration(f.args)).toThrow("api_attempt_binding_invalid");
    expect(f.calls).toHaveLength(0);
  });

  it("captures all routing, receipt and prompt inputs before the caller can edit them", async () => {
    const f = await fixture(); const original = structuredClone(f.args.binding);
    const run = createProviderApiGeneration(f.args);
    f.args.binding.modelId = "changed-model"; f.args.binding.revisionId = randomUUID();
    f.args.revision.configuration.endpoint = "https://changed.invalid/v1/";
    f.args.revision.configuration.modelIds.push("changed-model");
    f.args.question = "changed question"; f.args.packetCanonical = "{}";
    const completed = await run();
    expect(completed.receipt).toMatchObject({ model: original.modelId, revisionId: original.revisionId, endpoint: f.endpoint });
    expect(f.calls[0].body.messages).toContainEqual({ role: "user", content: JSON.stringify({ question: "SYNTHETIC draft request", selectedProjectRecord: f.packet }) });
  });

  for (const kind of ["expired", "cancelled"] as const) {
    it(`does not dispatch an ${kind} attempt and consumes the invocation`, async () => {
      const f = await fixture();
      if (kind === "expired") f.args.binding.leaseExpiresAt = "2020-01-01T00:00:00Z";
      const run = createProviderApiGeneration(f.args);
      if (kind === "cancelled") f.controller.abort();
      await expect(run()).rejects.toMatchObject({ code: "api_attempt_interrupted" });
      await expect(run()).rejects.toMatchObject({ code: "api_attempt_already_consumed" });
      expect(f.calls).toHaveLength(0);
    });
  }

  for (const kind of ["cancel", "timeout", "lease"] as const) {
    it(`stops in-flight work on ${kind} without regeneration`, async () => {
      const f = await fixture("api_key", () => {});
      if (kind === "timeout") {
        const revision = prepareProviderApiRevision({ workspaceId: f.args.binding.workspaceId, revisionId: f.args.binding.revisionId,
          configuration: { ...f.args.revision.configuration, timeoutSeconds: 1 }, apiKey: "SYNTHETIC-SAVED-KEY" });
        f.args.revision = { ...revision, connectionId: f.args.binding.connectionId }; f.args.binding.configurationHash = revision.configurationHash;
      }
      if (kind === "lease") f.args.binding.leaseExpiresAt = new Date(Date.now() + 1000).toISOString();
      const run = createProviderApiGeneration(f.args);
      const completion = expect(beforeDeadline(run())).rejects.toMatchObject({ code: "api_attempt_interrupted" });
      await f.arrived;
      const repeated = expect(beforeDeadline(run())).rejects.toMatchObject({ code: "api_attempt_already_consumed" });
      if (kind === "cancel") f.controller.abort();
      await Promise.all([completion, repeated]);
      await expect(run()).rejects.toMatchObject({ code: "api_attempt_already_consumed" });
      expect(f.calls).toHaveLength(1);
    });
  }

  for (const kind of ["wrong-model", "incomplete", "wrong-citation", "foreign-proposal", "extra-action", "provider-error"] as const) {
    it(`rejects ${kind} with no saved answer, raw error disclosure or retry`, async () => {
      const f = await fixture("api_key", (res, body) => {
        if (kind === "provider-error") { res.statusCode = 500; res.end("SYNTHETIC-PRIVATE-PROVIDER-ERROR"); return; }
        if (kind === "wrong-model") body.model = "wrong-model";
        const choices = body.choices as Array<{ finish_reason: string; message: { content: string } }>;
        if (kind === "incomplete") choices[0].finish_reason = "length";
        const output = JSON.parse(choices[0].message.content);
        if (kind === "wrong-citation") output.citations = ["project:foreign"];
        if (kind === "foreign-proposal") output.submittal.projectId = randomUUID();
        if (kind === "extra-action") output.execute = { approved: true };
        choices[0].message.content = JSON.stringify(output); res.end(JSON.stringify(body));
      });
      const run = createProviderApiGeneration(f.args);
      const code = kind === "wrong-model" ? "api_response_identity_invalid" : kind === "incomplete" ? "api_response_incomplete" :
        kind === "provider-error" ? "api_response_failed" : "api_answer_invalid";
      await expect(run()).rejects.toMatchObject({ code, message: code });
      await expect(run()).rejects.toMatchObject({ code: "api_attempt_already_consumed" });
      expect(f.calls).toHaveLength(1);
    });
  }
});

// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LIVE_RLS, getLocalSupabaseEnv, liveClient, type LocalSupabaseEnv } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { prepareProviderApiRevision } from "@/lib/integrations/provider-api-credentials";
import { checkedProviderTurn } from "@/lib/assistant/provider-server";

const live = LIVE_RLS ? describe : describe.skip;
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.unstubAllEnvs(); });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const secret = "SYNTHETIC-WORKER-PROCESS-OPERATOR-SECRET";
const key = "SYNTHETIC-SAVED-WORKER-KEY";
async function bounded<T>(work: Promise<T>, label: string, milliseconds = 12_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
}
function checked<T>(response: { data: T; error: { code?: string } | null }, label: string): T {
  if (response.error) throw new Error(`${label}: ${response.error.code ?? "request_failed"}`);
  return response.data;
}
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

live("saved API worker real process", () => {
  let environment: LocalSupabaseEnv, container: string;
  let service: ReturnType<typeof liveClient>;
  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) throw new Error("Name the disposable stack before live worker fixtures.");
    environment = getLocalSupabaseEnv(); container = resolveLocalDbContainer();
    service = liveClient(environment.API_URL, environment.SERVICE_ROLE_KEY, "synthetic-api-worker");
  });
  function sql(statement: string) {
    return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
      input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  }
  async function fixture(mode: "api_key" | "none" = "api_key", hold = false, loss: "none" | "before" | "after" = "none") {
    const active = await service.from("assistant_provider_turns").select("id", { count: "exact", head: true }).eq("provider", "api_connection").in("state", ["queued", "running"]);
    checked(active, "queue preflight"); expect(active.count, "Do not consume another session's API jobs").toBe(0);
    const directory = await mkdtemp(join(tmpdir(), "openplan-api-worker-live-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const owner = randomUUID(), custodian = randomUUID(), workspace = randomUUID(), project = randomUUID(), connection = randomUUID(), revision = randomUUID();
    sql(`INSERT INTO auth.users(id,email) VALUES('${owner}','${owner}@synthetic.example.test'),('${custodian}','${custodian}@synthetic.example.test');
      INSERT INTO public.workspaces(id,name,slug) VALUES('${workspace}','SYNTHETIC API worker process','${workspace}');
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('${workspace}','${owner}','owner'),('${workspace}','${custodian}','owner');
      INSERT INTO public.projects(id,workspace_id,name) VALUES('${project}','${workspace}','SYNTHETIC worker project');`);
    const packet = { version: 1, workspaceId: workspace, project: { id: project, name: "SYNTHETIC worker project", summary: "SYNTHETIC frozen baseline",
      status: "active", planType: "other", deliveryPhase: "planning", updatedAt: "2026-09-12T00:00:00Z" }, capturedAt: "2026-09-12T00:00:00Z",
      source: { id: `project:${project}`, label: "SYNTHETIC worker project", href: `/projects/${project}` } };
    const packetCanonical = JSON.stringify(packet);
    const output = { answer: "SYNTHETIC retained answer", citations: [packet.source.id], submittal: {
      projectId: project, title: "SYNTHETIC proposed review", submittalType: "progress_report", notes: "SYNTHETIC not executed",
    } };
    const calls: Array<{ path: string | undefined; auth: string | undefined; body: Record<string, unknown>; phaseAtDispatch: string }> = [];
    const arrival = Promise.withResolvers<void>();
    let held: ServerResponse | undefined;
    const journal = async (): Promise<Record<string, unknown>> => JSON.parse(await readFile(join(directory, "pending.json"), "utf8"));
    const model = createServer(async (request, response) => {
      try {
        const bytes: Buffer[] = []; for await (const chunk of request) bytes.push(Buffer.from(chunk));
        let phase = "missing";
        try { phase = String((await journal()).phase); } catch { /* A missing running journal is retained as a failed assertion below. */ }
        calls.push({ path: request.url, auth: request.headers.authorization, body: JSON.parse(Buffer.concat(bytes).toString()), phaseAtDispatch: phase });
        arrival.resolve(); held = response;
        response.setHeader("content-type", "application/json");
        if (!hold) response.end(JSON.stringify({ id: "SYNTHETIC-worker-response", model: "synthetic-model", choices: [{ index: 0, finish_reason: "stop",
          message: { role: "assistant", content: JSON.stringify(output) } }], usage: { prompt_tokens: 12, completion_tokens: 20, total_tokens: 32 } }));
      } catch { response.statusCode = 500; response.end("Synthetic fixture failed"); }
    });
    const endpoint = `${await listen(model)}/custom/v1/`;
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", secret);
    const configuration = { label: "SYNTHETIC process API", protocol: "openai_chat_completions", endpoint, modelIds: ["synthetic-model"], structuredOutput: true, authMode: mode, timeoutSeconds: 30 };
    const prepared = prepareProviderApiRevision({ workspaceId: workspace, revisionId: revision, configuration, apiKey: mode === "api_key" ? key : null });
    checked(await service.rpc("save_workspace_provider_api_revision", { p_user_id: owner, p_workspace_id: workspace, p_connection_id: connection,
      p_revision_id: revision, p_expected_revision_id: null, p_configuration_canonical: JSON.stringify(prepared.configuration), p_credential_ciphertext: prepared.credentialCiphertext }), "save fixture revision");
    const requestId = randomUUID();
    const created = checked(await service.rpc("create_assistant_api_turn", { p_request_id: requestId, p_user_id: owner, p_workspace_id: workspace, p_project_id: project,
      p_connection_id: connection, p_revision_id: revision, p_configuration_hash: prepared.configurationHash, p_model_id: "synthetic-model",
      p_auth_mode: mode === "api_key" ? "connection_api_key" : "connection_no_key", p_charge_ack: true,
      p_question: "SYNTHETIC draft request", p_packet_canonical: packetCanonical }), "queue fixture attempt");
    const original = checkedProviderTurn(created.turn).turn;
    cleanup.push(async () => {
      // Only this fixture's job is retired/deleted; other workspaces and jobs are untouched.
      checked(await service.from("assistant_provider_turns").delete().eq("id", original.id).eq("workspace_id", workspace), "remove own fixture job");
      checked(await service.from("usage_events").delete().eq("workspace_id", workspace).eq("idempotency_key", `assistant_api_dispatch:${original.id}`), "remove own fixture reservation");
      checked(await service.from("project_submittals").delete().eq("project_id", project), "remove own synthetic fault artifacts");
    });
    const finishes: Array<{ body: unknown; committed: boolean }> = [];
    let dropped = false;
    const proxy = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks);
        const isFinish = request.url === "/rest/v1/rpc/finish_assistant_provider_turn";
        const finish = isFinish ? { body: JSON.parse(body.toString()) as unknown, committed: false } : null;
        if (finish) finishes.push(finish);
        if (isFinish && loss === "before" && !dropped) { dropped = true; response.destroy(); return; }
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) if (typeof value === "string" && !["host", "connection", "content-length", "transfer-encoding"].includes(name)) headers.set(name, value);
        const forwarded = await fetch(`${environment.API_URL}${request.url}`, { method: request.method, headers, body: body.length ? body : undefined, redirect: "manual" });
        const bytes = Buffer.from(await forwarded.arrayBuffer());
        if (finish) finish.committed = forwarded.ok;
        if (isFinish && loss === "after" && !dropped && forwarded.ok) { dropped = true; response.destroy(); return; }
        response.statusCode = forwarded.status;
        for (const [name, value] of forwarded.headers) if (!["connection", "content-length", "transfer-encoding", "content-encoding"].includes(name)) response.setHeader(name, value);
        response.end(bytes);
      } catch { response.statusCode = 502; response.end("Synthetic proxy unavailable"); }
    });
    const target = await listen(proxy);
    const children: Array<{ child: ChildProcess; finished: Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> }> = [];
    cleanup.push(async () => {
      for (const item of children) {
        if (item.child.exitCode === null && item.child.signalCode === null) item.child.kill("SIGKILL");
        await bounded(item.finished, "Owned worker child did not exit during cleanup");
      }
    });
    function start(url = target) {
      const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/workers/provider-api.ts", "--once"], {
        cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: environment.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: environment.SERVICE_ROLE_KEY,
          OPENPLAN_INTEGRATION_KEY_SECRET: secret, OPENPLAN_PROVIDER_API_WORK_DIR: directory, OPENPLAN_AI_LOCAL_ENDPOINTS: JSON.stringify([endpoint]),
          OPENAI_API_KEY: "SYNTHETIC-AMBIENT-MUST-NOT-BE-USED", ANTHROPIC_API_KEY: "SYNTHETIC-AMBIENT-MUST-NOT-BE-USED", NODE_DEBUG: "",
        },
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", data => { stdout += data.toString(); }); child.stderr.on("data", data => { stderr += data.toString(); });
      const finished = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve, reject) => {
        child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
      });
      const entry = { child, finished }; children.push(entry); return entry;
    }
    const row = async () => checkedProviderTurn(checked(await service.from("assistant_provider_turns").select("*").eq("id", original.id).single(), "read own retained attempt")).turn;
    async function custody() {
      const saved = await row();
      expect(saved.packet_canonical).toBe(packetCanonical); expect(saved.packet_hash).toBe(hash(packetCanonical));
      expect(saved).toMatchObject({ user_id: owner, workspace_id: workspace, project_id: project, api_connection_id: connection, api_revision_id: revision, api_configuration_hash: prepared.configurationHash });
      const usage = await service.from("usage_events").select("id", { count: "exact", head: true }).eq("workspace_id", workspace).eq("idempotency_key", `assistant_api_dispatch:${original.id}`);
      checked(usage, "read reservation"); expect(usage.count).toBe(1);
      const actions = await service.from("project_submittals").select("id", { count: "exact", head: true }).eq("project_id", project);
      checked(actions, "read proposed business records"); expect(actions.count, "Generation must not execute its proposed business record").toBe(0);
      return saved;
    }
    return { owner, workspace, project, connection, revision, configuration, prepared, original, target, directory, calls, finishes,
      packet, packetCanonical, journal, start, row, custody, arrived: arrival.promise, held: () => held };
  }

  for (const mode of ["api_key", "none"] as const) it(`dispatches through the real SDK and PostgREST with ${mode}`, async () => {
    const f = await fixture(mode); const child = f.start(`${f.target}/`);
    expect(await bounded(child.finished, "Worker did not finish generation")).toMatchObject({ code: 0, signal: null, stdout: "API worker cycle: succeeded\n", stderr: "" });
    expect(f.calls).toHaveLength(1); expect(f.calls[0].phaseAtDispatch, "Running journal must exist before model dispatch").toBe("running");
    expect(f.calls[0]).toMatchObject({ path: "/custom/v1/chat/completions", auth: mode === "api_key" ? `Bearer ${key}` : undefined,
      body: { model: "synthetic-model", max_tokens: 4000, response_format: { type: "json_schema" } } });
    expect(f.calls[0].body.messages).toEqual([{ role: "system", content: expect.stringContaining("A proposal changes nothing") },
      { role: "user", content: JSON.stringify({ question: "SYNTHETIC draft request", selectedProjectRecord: f.packet }) }]);
    const saved = await f.custody(); expect(saved.state).toBe("succeeded");
    expect(saved.result).toMatchObject({ answer: "SYNTHETIC retained answer", citations: [f.packet.source], proposal: { status: "proposed", approval: "approval_required" } });
    expect(saved.provider_receipt).toMatchObject({ provider: "api_connection", turnId: saved.id, attemptId: saved.attempt_id,
      revisionId: f.revision, connectionId: f.connection, configurationHash: f.prepared.configurationHash, packetHash: saved.packet_hash, inputTokens: 12, outputTokens: 20 });
    expect((await f.journal()).phase).toBe("delivered");
  });
  for (const loss of ["before", "after"] as const) it(`recovers an exact completion after response loss ${loss} database commit`, async () => {
    const f = await fixture("api_key", false, loss);
    expect((await bounded(f.start().finished, "Worker did not observe lost completion response")).code).toBe(1);
    expect((await f.journal()).phase, "Completed result must survive response loss").toBe("completed");
    const before = await f.row(); expect(before.state).toBe(loss === "after" ? "succeeded" : "running");
    expect(f.finishes).toHaveLength(1); expect(f.finishes[0].committed).toBe(loss === "after");
    expect((await bounded(f.start().finished, "Worker did not recover saved completion")).code).toBe(0);
    expect(f.calls).toHaveLength(1); expect(f.finishes).toHaveLength(2); expect(f.finishes[0].body).toEqual(f.finishes[1].body);
    const after = await f.custody(); expect(after.state).toBe("succeeded");
    if (loss === "after") expect(after).toEqual(before);
  });
  it("recovers a killed generating process without a second model request", async () => {
    const f = await fixture("api_key", true); const worker = f.start();
    await bounded(f.arrived, "Model request never arrived"); expect((await f.journal()).phase).toBe("running");
    worker.child.kill("SIGKILL"); expect((await bounded(worker.finished, "Owned killed worker did not exit")).signal).toBe("SIGKILL");
    expect((await f.journal()).phase).toBe("running");
    expect((await bounded(f.start().finished, "Worker did not recover interrupted generation")).code).toBe(0);
    const saved = await f.custody(); expect(saved).toMatchObject({ state: "failed", failure_code: "api_worker_interrupted", result: null, provider_receipt: null });
    expect(f.calls).toHaveLength(1);
  });
  for (const change of ["cancel", "edit", "revoke", "access"] as const) it(`interrupts real generation after ${change}`, async () => {
    const f = await fixture("api_key", true); const worker = f.start();
    await bounded(f.arrived, "Model request never arrived");
    if (change === "cancel") checked(await service.rpc("cancel_assistant_provider_turn", { p_turn_id: f.original.id, p_user_id: f.owner }), "cancel own request");
    if (change === "revoke") checked(await service.rpc("revoke_workspace_provider_api_connection", { p_user_id: f.owner, p_workspace_id: f.workspace,
      p_connection_id: f.connection, p_expected_revision_id: f.revision }), "revoke own connection");
    if (change === "access") checked(await service.from("workspace_members").delete().eq("workspace_id", f.workspace).eq("user_id", f.owner), "remove own fixture membership");
    if (change === "edit") {
      const next = prepareProviderApiRevision({ workspaceId: f.workspace, revisionId: randomUUID(), configuration: { ...f.configuration, label: "SYNTHETIC corrected revision" }, apiKey: key });
      checked(await service.rpc("save_workspace_provider_api_revision", { p_user_id: f.owner, p_workspace_id: f.workspace, p_connection_id: f.connection,
        p_revision_id: next.revisionId, p_expected_revision_id: f.revision, p_configuration_canonical: JSON.stringify(next.configuration), p_credential_ciphertext: next.credentialCiphertext }), "correct own configuration");
    }
    expect((await bounded(worker.finished, "Worker did not observe cancellation within twelve seconds")).code).toBe(0);
    const saved = await f.custody(); expect(saved.state).toBe(change === "cancel" ? "cancelled" : "interrupted");
    expect(saved.result).toBeNull(); expect(saved.provider_receipt).toBeNull(); expect(f.finishes).toHaveLength(0); expect(f.calls).toHaveLength(1);
    expect(f.held()?.destroyed, "Provider response must be aborted before its timeout").toBe(true);
    expect((await f.journal()).acknowledgedState).toBe(change === "access" ? "access_lost" : saved.state);
    expect((await bounded(f.start().finished, "Worker did not observe drained queue")).stdout).toBe("API worker cycle: idle\n"); expect(f.calls).toHaveLength(1);
  });
  it("refuses a corrupt journal before claiming or contacting the model", async () => {
    const f = await fixture(); await writeFile(join(f.directory, "pending.json"), "{", { mode: 0o600 });
    expect((await bounded(f.start().finished, "Worker did not refuse corrupt journal")).code).toBe(1);
    expect((await f.row()).state).toBe("queued"); expect(f.calls).toHaveLength(0); expect(f.finishes).toHaveLength(0);
  });
  it("refuses a saved journal against a changed deployment destination", async () => {
    const f = await fixture("api_key", false, "after");
    expect((await bounded(f.start().finished, "Worker did not retain lost response")).code).toBe(1);
    const before = await f.row(); const pending = await f.journal();
    expect((await bounded(f.start(environment.API_URL).finished, "Worker did not refuse changed target")).code).toBe(1);
    expect(await f.journal()).toEqual(pending); expect(await f.row()).toEqual(before); expect(f.calls).toHaveLength(1);
    expect((await bounded(f.start().finished, "Worker did not resume original target")).code).toBe(0); expect(f.calls).toHaveLength(1);
  });
});

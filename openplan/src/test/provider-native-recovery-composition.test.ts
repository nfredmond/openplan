// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connectorCycle } from "../../../workers/planner_agent_connector/connector-worker.mjs";
import { ConnectorError } from "../../../workers/planner_agent_connector/connector-client.mjs";
const h = vi.hoisted(() => ({ service: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => h.service }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info() {}, warn() {}, error() {} }) }));
import { POST } from "@/app/api/assistant/providers/native/route";
import { PROVIDER_TURN_COLUMNS } from "@/lib/assistant/provider-server";

const id = "11111111-1111-4111-8111-111111111111", workspace = "22222222-2222-4222-8222-222222222222", project = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444", attempt = "55555555-5555-4555-8555-555555555555", connection = "66666666-6666-4666-8666-666666666666";
const setup = { version: 1, appUrl: "http://127.0.0.1:3219", connectionId: connection, workspaceId: workspace, projectId: project, expectedAuthMode: "chatgpt", token: `op_pc_${connection}.${"s".repeat(43)}` };
const packet = { version: 1, workspaceId: workspace, project: { id: project, name: "Synthetic project", summary: null, status: "active", planType: "corridor", deliveryPhase: "planning", updatedAt: "2026-09-10T00:00:00Z" }, capturedAt: "2026-09-10T01:00:00Z", source: { id: `project:${project}`, label: "Synthetic project", href: `/projects/${project}` } };
const packetCanonical = JSON.stringify(packet);
const validAnswer = JSON.stringify({ answer: "The project is retained.", citations: [packet.source.id], submittal: null });

async function fixture(answer: string, invalidReceipt = false) {
  const directory = await mkdtemp(join(tmpdir(), "openplan-native-recovery-"));
  let state = "running", claims = 0, generates = 0, finishes = 0;
  let retained: Record<string, unknown> | null = null;
  const turn = () => ({ id, request_id: requestId, workspace_id: workspace, project_id: project, connection_id: connection, provider: "codex", model_id: "fixture-model", auth_mode: "chatgpt", question: "What is known?", packet_canonical: packetCanonical, packet_hash: createHash("sha256").update(packetCanonical).digest("hex"), state, attempt_id: attempt, lease_expires_at: "2099-01-01T00:00:00Z", result: retained?.p_result ?? null, provider_receipt: retained?.p_provider_receipt ?? null, failure_code: retained?.p_failure_code ?? null, created_at: "2026-09-10T01:00:00Z", started_at: "2026-09-10T01:00:00Z", finished_at: state === "running" ? null : "2026-09-10T01:01:00Z" });
  h.service = { from(table: string) {
    expect(table).toBe("assistant_provider_turns");
    const q = { select: (columns: string) => { expect(columns).toBe(PROVIDER_TURN_COLUMNS); return q; }, eq: () => q, maybeSingle: async () => ({ data: turn(), error: null }) }; return q;
  }, rpc: async (name: string, args: Record<string, unknown>) => {
    if (name === "claim_assistant_provider_turn") { claims++; return { data: { status: "connected", turn: state === "running" ? turn() : null }, error: null }; }
    if (name === "read_assistant_provider_turn_status") return { data: { id, state, attemptId: attempt, leaseExpiresAt: "2099-01-01T00:00:00Z" }, error: null };
    if (name === "finish_assistant_provider_turn") {
      finishes++;
      expect(args.p_turn_id).toBe(id); expect(args.p_attempt_id).toBe(attempt); expect(args.p_connection_id).toBe(connection);
      if (["cancelled", "interrupted"].includes(state)) return { data: null, error: { code: "PT409", message: "terminal" } };
      if (retained) expect(args).toEqual(retained);
      retained = args; state = args.p_failure_code ? "failed" : "succeeded";
      return { data: turn(), error: null };
    }
    throw new Error(name);
  } };
  const deliveries: Record<string, unknown>[] = [];
  const request = async (_setup: unknown, body: Record<string, unknown>) => {
    if (body.operation === "finish") deliveries.push(structuredClone(body));
    const response = await POST(new NextRequest(`${setup.appUrl}/api/assistant/providers/native`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${setup.token}` }, body: JSON.stringify(body) }));
    if (!response.ok) throw Object.assign(new ConnectorError("connector_request_refused"), { status: response.status });
    return response.json();
  };
  const options = { request, inspect: async () => ({ status: "connected", authMode: "chatgpt" }), generate: async () => {
    generates++; return { provider: "codex", model: "fixture-model", authMode: "chatgpt", planType: null, threadId: invalidReceipt ? "" : "thread", turnId: "turn", answer };
  } };
  const config = { setup, binaryPath: "/synthetic/bin/codex", providerHome: "/synthetic/profile" };
  return { directory, options, config, request, deliveries, get counts() { return { claims, generates, finishes }; }, get retained() { return retained; },
    cancel() { state = "cancelled"; }, journal: async () => JSON.parse(await readFile(join(directory, "pending.json"), "utf8")),
    cleanup: () => rm(directory, { recursive: true, force: true }) };
}

describe("real connector and native handler recovery", () => {
  it("delivers a valid synthetic answer and preserves the actual receipt", async () => {
    const f = await fixture(validAnswer);
    try {
      expect(await connectorCycle(f.config, f.directory, f.options)).toEqual({ state: "succeeded", turnId: id });
      expect(f.counts).toEqual({ claims: 1, generates: 1, finishes: 1 });
      expect(f.retained).toMatchObject({ p_result: { answer: "The project is retained." }, p_provider_receipt: { threadId: "thread" }, p_failure_code: null });
    } finally { await f.cleanup(); }
  });
  it.each(["not JSON", JSON.stringify({ answer: "   ", citations: [packet.source.id], submittal: null })])("finishes invalid answer %s without another provider call", async answer => {
    const f = await fixture(answer);
    try {
      expect(await connectorCycle(f.config, f.directory, f.options)).toEqual({ state: "failed", turnId: id });
      expect(f.retained).toMatchObject({ p_result: null, p_provider_receipt: null, p_failure_code: "native_invalid_output" });
      expect((await f.journal()).phase).toBe("delivered");
      expect(await connectorCycle(f.config, f.directory, f.options)).toEqual({ state: "idle", connectionStatus: "connected" });
      expect(f.counts).toEqual({ claims: 2, generates: 1, finishes: 1 });
    } finally { await f.cleanup(); }
  });
  it("replays an invalid answer after lost acknowledgement as the identical failure", async () => {
    const f = await fixture("not JSON"); let lose = true;
    f.options.request = async (scope, body) => { const result = await f.request(scope, body); if (body.operation === "finish" && lose) { lose = false; throw new Error("lost_acknowledgement"); } return result; };
    try {
      await expect(connectorCycle(f.config, f.directory, f.options)).rejects.toThrow("lost_acknowledgement");
      expect((await f.journal()).phase).toBe("completed");
      expect((await connectorCycle(f.config, f.directory, f.options)).state).toBe("failed");
      expect(f.deliveries[0]).toEqual(f.deliveries[1]);
      expect(f.counts).toEqual({ claims: 1, generates: 1, finishes: 2 });
    } finally { await f.cleanup(); }
  });
  it("reconciles cancellation of a retained invalid answer without dispatch", async () => {
    const f = await fixture("not JSON");
    f.options.request = async (scope, body) => { if (body.operation === "finish") throw new Error("offline"); return f.request(scope, body); };
    try {
      await expect(connectorCycle(f.config, f.directory, f.options)).rejects.toThrow("offline");
      f.cancel(); f.options.request = f.request;
      expect((await connectorCycle(f.config, f.directory, f.options)).state).toBe("cancelled");
      expect((await f.journal()).acknowledgedState).toBe("cancelled");
      expect(f.counts.generates).toBe(1); expect(f.counts.claims).toBe(1);
    } finally { await f.cleanup(); }
  });
  it("journals a failure for a rejected receipt and replays that failure after response loss", async () => {
    const f = await fixture(validAnswer, true); let lose = true;
    f.options.request = async (scope, body) => {
      if (body.failureCode === "native_result_rejected") {
        const pending = await f.journal();
        expect(pending.delivery).toEqual(body); expect(pending.rejectedDelivery.receipt.threadId).toBe("");
      }
      const result = await f.request(scope, body);
      if (body.failureCode === "native_result_rejected" && lose) { lose = false; throw new Error("lost_failure_acknowledgement"); }
      return result;
    };
    try {
      await expect(connectorCycle(f.config, f.directory, f.options)).rejects.toThrow("lost_failure_acknowledgement");
      expect((await f.journal()).phase).toBe("completed");
      expect((await connectorCycle(f.config, f.directory, f.options)).state).toBe("failed");
      expect(f.retained).toMatchObject({ p_result: null, p_provider_receipt: null, p_failure_code: "native_result_rejected" });
      expect(f.deliveries[1]).toEqual(f.deliveries[2]);
      expect(f.counts).toEqual({ claims: 1, generates: 1, finishes: 2 });
    } finally { await f.cleanup(); }
  });
  it("can reconcile cancellation even when the retained envelope is rejected before the RPC", async () => {
    const f = await fixture(validAnswer, true);
    f.options.request = async (scope, body) => { if (body.operation === "finish") throw new Error("offline"); return f.request(scope, body); };
    try {
      await expect(connectorCycle(f.config, f.directory, f.options)).rejects.toThrow("offline");
      f.cancel(); f.options.request = f.request;
      expect((await connectorCycle(f.config, f.directory, f.options)).state).toBe("cancelled");
      expect(f.counts).toEqual({ claims: 1, generates: 1, finishes: 0 });
    } finally { await f.cleanup(); }
  });
});

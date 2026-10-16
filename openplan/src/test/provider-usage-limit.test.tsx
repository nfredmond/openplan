import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { checkedNativeUsageLimit, providerUsageLimitReceiptSchema } from "@/lib/assistant/provider-usage-limit";
import { checkedProviderTurn, PROVIDER_TURN_COLUMNS } from "@/lib/assistant/provider-server";
import { POST } from "@/app/api/assistant/providers/native/route";
import { ProjectProviderPanel } from "@/components/assistant/project-provider-panel";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => mocks, createClient: vi.fn() }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }));
const uid = (n: number) => `${n}`.repeat(8)+"-1111-4111-8111-111111111111";
const packet = { version: 1, workspaceId: uid(2), project: { id: uid(3), name: "SYNTHETIC", summary: null, status: "active", planType: "corridor", deliveryPhase: "planning", updatedAt: "2026-10-16T00:00:00Z" }, source: { id: `project:${uid(3)}`, label: "SYNTHETIC", href: `/projects/${uid(3)}` }, capturedAt: "2026-10-16T00:00:00Z" };
const canonical = JSON.stringify(packet);
const row = () => ({ id: uid(4), request_id: uid(5), user_id: uid(6), workspace_id: uid(2), project_id: uid(3), connection_id: uid(1),
  provider: "codex", model_id: "synthetic", auth_mode: "chatgpt", question: "Stored facts?", packet_canonical: canonical,
  packet_hash: createHash("sha256").update(canonical).digest("hex"), state: "running", attempt_id: uid(7), lease_expires_at: "2099-01-01T00:00:00Z",
  result: null, provider_receipt: null as unknown, failure_code: null as string | null, created_at: "2026-10-16T00:00:00Z", started_at: "2026-10-16T00:00:00Z", finished_at: null });
const receipt = (reset: number | null = 1800000000) => ({ schemaVersion: 2, outcome: "limited", provider: "codex", model: "synthetic", authMode: "chatgpt",
  userId: uid(6), requestId: uid(5), workspaceId: uid(2), projectId: uid(3), connectionId: uid(1), turnId: uid(4), attemptId: uid(7), packetHash: row().packet_hash,
  nativeThreadId: "synthetic-thread", nativeTurnId: "synthetic-turn", signal: { code: "usageLimitExceeded", resetAtUnixSeconds: reset, resetSource: reset === null ? null : "account_rate_limits" } });
const limited = (reset: number | null = 1800000000) => ({ ...row(), state: "failed", failure_code: "native_usage_limit", provider_receipt: receipt(reset) });
const delivery = () => ({ operation: "finish", turnId: uid(4), attemptId: uid(7), answer: null, failureCode: "native_usage_limit", receipt: receipt() });
const request = (body: unknown) => new NextRequest("http://localhost/api/assistant/providers/native", { method: "POST", headers: { authorization: `Bearer op_pc_${uid(1)}.${"s".repeat(43)}`, "content-type": "application/json" }, body: JSON.stringify(body) });
let query: { select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; maybeSingle: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.resetAllMocks();
  query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data: row(), error: null })) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); mocks.from.mockReturnValue(query);
  mocks.rpc.mockImplementation(async (name, args) => ({ data: name === "finish_assistant_provider_turn"
    ? { ...row(), state: "failed", failure_code: args.p_failure_code, provider_receipt: args.p_provider_receipt } : { id: uid(4), state: "running", attemptId: uid(7) }, error: null }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("native delivery keeps exact limited receipt with no answer and checks the stored projection", async () => {
  const body = delivery();
  expect((await POST(request(body))).status).toBe(200);
  expect(query.select).toHaveBeenCalledWith(PROVIDER_TURN_COLUMNS);
  expect(PROVIDER_TURN_COLUMNS.split(",")).toEqual(expect.arrayContaining(["user_id", "request_id", "connection_id", "attempt_id", "packet_hash", "provider_receipt"]));
  expect(mocks.rpc).toHaveBeenCalledWith("finish_assistant_provider_turn", expect.objectContaining({ p_result: null, p_provider_receipt: body.receipt, p_failure_code: "native_usage_limit", p_user_id: null }));
});

it("native delivery rejects every changed custody field before finishing", async () => {
  for (const field of ["userId", "requestId", "workspaceId", "projectId", "connectionId", "turnId", "attemptId", "packetHash", "model", "authMode"]) {
    mocks.rpc.mockClear();
    const body = delivery();
    const changed = { ...body, receipt: { ...body.receipt, [field]: field === "packetHash" ? "b".repeat(64) : field === "model" ? "other" : field === "authMode" ? "apiKey" : uid(9) } };
    expect((await POST(request(changed))).status, field).toBe(409);
    expect(mocks.rpc.mock.calls.some(([name]) => name === "finish_assistant_provider_turn"), field).toBe(false);
  }
});

it("native delivery refuses arbitrary failure receipts, extra data, invented resets and success reuse", async () => {
  const body = delivery();
  for (const change of [
    { failureCode: "native_other_failure" }, { failureCode: null }, { answer: "invented answer" },
    { receipt: { ...body.receipt, email: "SYNTHETIC_PRIVATE" } },
    { receipt: { ...body.receipt, signal: { ...body.receipt.signal, message: "reset tomorrow" } } },
    ...[-1, 1.5, 253402300800, "1800000000"].map(reset => ({ receipt: { ...body.receipt, signal: { ...body.receipt.signal, resetAtUnixSeconds: reset } } })),
  ]) {
    mocks.rpc.mockClear();
    expect((await POST(request({ ...body, ...change }))).status).toBe(400);
    expect(mocks.rpc.mock.calls.some(([name]) => name === "finish_assistant_provider_turn")).toBe(false);
  }
});

it("typed retained reader accepts exact reports and refuses transplanted or nonterminal receipts", () => {
  expect(checkedProviderTurn(limited()).turn.provider_receipt).toEqual(receipt());
  for (const change of [{ user_id: uid(9) }, { state: "cancelled" }, { state: "running" }, { failure_code: "native_other_failure" }, { result: {} }]) {
    expect(() => checkedProviderTurn({ ...limited(), ...change })).toThrow("provider_receipt_mismatch");
  }
  expect(checkedNativeUsageLimit({ ...row(), state: "failed", failure_code: "native_usage_limit" })).toBeNull();
  expect(providerUsageLimitReceiptSchema.safeParse({ ...receipt(), signal: { ...receipt().signal, code: "sessionBudgetExceeded" } }).success).toBe(false);
});

it("panel discloses reported reset and separate unreported tokens and cost without retrying", async () => {
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => Response.json(url.includes("connections") ? { connections: [] } : { turns: [limited()] }));
  vi.stubGlobal("fetch", fetcher);
  render(<ProjectProviderPanel workspaceId={uid(2)} projectId={uid(3)} busy={false} onReview={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Project task · choose provider" }));
  await screen.findByText("Status: limited");
  expect(screen.getByText("Provider-reported reset: 2027-01-15T08:00:00.000Z")).toBeInTheDocument();
  expect(screen.getByText("Tokens not reported. Cost not reported.")).toBeInTheDocument();
  expect(screen.getByText(/does not confirm restored access/)).toBeInTheDocument();
  expect(fetcher.mock.calls.every(call => call.length === 1 || !(call[1] as RequestInit | undefined)?.method)).toBe(true);
  expect(screen.queryByRole("button", { name: "Retry same request" })).not.toBeInTheDocument();
});

it("panel keeps unreported reset distinct and weak failure codes stay failed", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("connections") ? { connections: [] } : { turns: [limited(null), { ...row(), id: uid(8), state: "failed", failure_code: "native_usage_limit" }] })));
  render(<ProjectProviderPanel workspaceId={uid(2)} projectId={uid(3)} busy={false} onReview={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Project task · choose provider" }));
  await screen.findByText("Reset not reported");
  expect(screen.getByText("Status: limited")).toBeInTheDocument();
  expect(screen.getByText("Status: failed")).toBeInTheDocument();
  expect(screen.queryByText(/Provider-reported reset:/)).not.toBeInTheDocument();
});

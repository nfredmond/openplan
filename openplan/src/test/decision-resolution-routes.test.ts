import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import native from "./fixtures/decision-resolution-native.json";
import { DECISION_RESOLUTION_BODY_LIMIT, decisionResolutionIntentSchema } from "@/lib/engagement/decision-request-resolution";
import { resolveDecisionRequest } from "@/lib/engagement/decision-resolution-server";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), access: vi.fn(), audit: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc, auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: mocks.access }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => mocks.audit }));
import { POST } from "@/app/api/engagement/campaigns/[campaignId]/decision-links/resolutions/route";
const payload = JSON.parse(native.cancelled.payloadText) as Record<string, unknown>;
const body = decisionResolutionIntentSchema.parse({ requestId: payload.requestId, resolutionId: payload.resolutionId, copyJson: payload.copyJson, reason: payload.reason });
const params = () => ({ params: Promise.resolve({ campaignId: native.scope.campaignId }) });
const url = `http://openplan.test/api/engagement/campaigns/${native.scope.campaignId}/decision-links/resolutions`;
function request(data: unknown = body, headers: Record<string, string> = {}) {
  return new NextRequest(url, { method: "POST", headers: { origin: "http://openplan.test", "content-type": "application/json",
    "x-openplan-expected-user": native.scope.actorId, "x-openplan-expected-workspace": native.scope.workspaceId, ...headers }, body: JSON.stringify(data) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: native.scope.actorId } }, error: null });
  mocks.access.mockResolvedValue({ campaign: { id: native.scope.campaignId, workspace_id: native.scope.workspaceId }, allowed: true, error: null });
  mocks.rpc.mockResolvedValue({ data: native.cancelled, error: null });
});

describe("private decision recovery HTTP", () => {
  it("returns one verified receipt with exact native parameters and private caching", async () => {
    const response = await POST(request(), params());
    expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(native.cancelled);
    expect(mocks.access).toHaveBeenCalledWith(expect.anything(), native.scope.campaignId, native.scope.actorId, "engagement.write");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("resolve_engagement_decision_request", {
      p_campaign: native.scope.campaignId, p_request: body.requestId, p_resolution: body.resolutionId, p_copy_json: body.copyJson, p_reason: body.reason,
    });
    expect(JSON.stringify(mocks.audit.info.mock.calls)).not.toContain("copyJson");
    expect(mocks.audit.info).toHaveBeenCalledWith("decision_request_resolved", expect.objectContaining({ resolutionId: body.resolutionId, requestId: body.requestId }));
  });
  it("returns exact retry metadata without changing original bytes", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...native.cancelled, replayed: true }, error: null });
    const response = await POST(request(), params()); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...native.cancelled, replayed: true });
  });
  it.each(["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"])("refuses even empty agent header %s", async header => {
    const response = await POST(request(body, { [header]: "" }), params());
    expect(response.status).toBe(403); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "cross-site" },
    { "x-openplan-expected-user": "different" }, { "x-openplan-expected-workspace": "different" }])("refuses changed browser origin or scope %j", async headers => {
    expect((await POST(request(body, headers as Record<string, string>), params())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires current staff including when retrying old identity", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(request(), params())).status).toBe(401);
    mocks.getUser.mockResolvedValue({ data: { user: { id: native.scope.actorId } }, error: null });
    mocks.access.mockResolvedValue({ campaign: { workspace_id: native.scope.workspaceId }, allowed: false, error: null });
    expect((await POST(request(), params())).status).toBe(403);
    mocks.access.mockResolvedValue({ campaign: null, allowed: false, error: { message: "SYNTHETIC private lookup failure" } });
    expect((await POST(request(), params())).status).toBe(503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses invalid addresses and intents before the native write", async () => {
    expect((await POST(request(), { params: Promise.resolve({ campaignId: "bad" }) })).status).toBe(400);
    for (const invalid of [{ ...body, requestId: "bad" }, { ...body, unexpected: true }, { ...body, copyJson: "{}" }]) {
      expect((await POST(request(invalid), params())).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("bounds streamed JSON bodies without trusting content length", async () => {
    const response = await POST(request({ ...body, copyJson: "x".repeat(DECISION_RESOLUTION_BODY_LIMIT + 1) }, { "content-length": "1" }), params());
    expect(response.status).toBe(413); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("stops oversized uploads before reading the remaining stream", async () => {
    let pulls = 0, cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; if (pulls === 1) controller.enqueue(new Uint8Array(DECISION_RESOLUTION_BODY_LIMIT + 1)); else controller.close(); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const streamed = new NextRequest(url, { method: "POST", headers: request().headers, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    expect((await POST(streamed, params())).status).toBe(413);
    expect(cancelled).toBe(true); expect(pulls).toBe(1); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses malformed UTF-8 before interpreting a recovery intent", async () => {
    const bytes = Buffer.from(JSON.stringify({ ...body, reason: "placeholder-invalid-byte" }));
    bytes[bytes.indexOf("placeholder-invalid-byte")] = 255;
    const invalid = new NextRequest(url, { method: "POST", headers: request().headers, body: bytes });
    expect((await POST(invalid, params())).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["42501",403],["22023",400],["PT409",409],["23505",409],["PT503",503]] as const)("retains %s refusal without private diagnostics", async (code,status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "SYNTHETIC private diagnostic" } });
    const response = await POST(request(), params()); expect(response.status).toBe(status); expect(await response.text()).not.toContain("private diagnostic");
  });
  it("does not acknowledge a damaged or foreign successful native receipt", async () => {
    for (const receipt of [{ ...native.cancelled, resultText: native.cancelled.resultText + " " }, native.saved]) {
      mocks.rpc.mockResolvedValue({ data: receipt, error: null });
      expect((await POST(request(), params())).status).toBe(503);
    }
  });
  it("keeps native timeout unconfirmed and does not log private bodies", async () => {
    mocks.rpc.mockRejectedValue(new Error("SYNTHETIC private failure"));
    const response = await POST(request(), params()); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private failure");
    expect(JSON.stringify(mocks.audit.warn.mock.calls)).not.toContain("copyJson");
  });
  it("validates server-helper callers before sending an RPC", async () => {
    const result = await resolveDecisionRequest({ rpc: mocks.rpc }, native.scope, { ...body, copyJson: "{}" });
    expect(result.error?.status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

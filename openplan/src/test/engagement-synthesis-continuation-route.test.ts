import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), user: vi.fn(), access: vi.fn(), read: vi.fn(), write: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client, createServiceRoleClient: mocks.service }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: mocks.access }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: mocks.info, warn: mocks.warn }) }));
vi.mock("@/lib/engagement/synthesis-continuation-server", () => ({ readSynthesisContinuationPage: mocks.read, createSynthesisContinuation: mocks.write }));
import { GET, POST } from "@/app/api/engagement/campaigns/[campaignId]/synthesis/continuation/route";
import { SynthesisGenerationRequestError } from "@/lib/engagement/synthesis-generation-requests-server";

const id = (n: number) => `c7710000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const campaignId = id(1), workspaceId = id(2), userId = id(3);
const parent = { parentRequestId: id(4), parentActorId: id(5), parentIntentSha256: "a".repeat(64),
  sourceId: id(6), sourceSha256: "b".repeat(64), throughSequence: 4, segmentResultsManifestSha256: "c".repeat(64) };
const intentText = JSON.stringify({ schemaVersion: 1, sourceId: parent.sourceId, sourceSha256: parent.sourceSha256,
  connectionId: id(7), configurationRevisionId: id(8), configurationHash: "d".repeat(64), modelId: "PRIVATE-model", taskByteLimit: 65536 });
const command = { stage: "context", requestId: id(9), parent, frameByteLimit: 4096, intentText, targetRecordId: `item:${id(20)}` };
const path = `http://localhost/api/engagement/campaigns/${campaignId}/synthesis/continuation`;
const context = { params: Promise.resolve({ campaignId }) };
const headers = { origin: "http://localhost", "content-type": "application/json",
  "x-openplan-expected-user": userId, "x-openplan-expected-workspace": workspaceId };
const query = new URLSearchParams(Object.entries({ ...parent, offset: 0 }).map(([key, value]) => [key, String(value)])).toString();
const get = (suffix = query, override: Record<string, string> = {}) => new NextRequest(`${path}?${suffix}`, { headers: { ...headers, ...override } });
const post = (body: unknown = command, override: Record<string, string> = {}) => new NextRequest(path,
  { method: "POST", headers: { ...headers, ...override }, body: JSON.stringify(body) });
const client = { auth: { getUser: mocks.user } }, service = { private: true };
beforeEach(() => {
  vi.resetAllMocks(); mocks.client.mockResolvedValue(client); mocks.service.mockReturnValue(service);
  mocks.user.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mocks.access.mockResolvedValue({ campaign: { workspace_id: workspaceId }, allowed: true, error: null });
  mocks.read.mockResolvedValue({ entries: [{ PRIVATE: true }] }); mocks.write.mockResolvedValue({ replayed: false, PRIVATE: true });
});

describe("staff continuation HTTP boundary", () => {
  it("reads a pinned parent through current staff access, without a write or private audit text", async () => {
    const response = await GET(get(), context);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith(client, campaignId, userId, "engagement.write");
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(client, service, { campaignId, workspaceId }, parent, 0, expect.any(AbortSignal));
    expect(mocks.service.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.access.mock.invocationCallOrder[0]);
    expect(mocks.write).not.toHaveBeenCalled(); expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("PRIVATE");
  });
  it.each(["context", "thematic"])("retains an explicit %s command under the signed-in actor", async stage => {
    const { targetRecordId: _target, ...base } = command;
    const value = stage === "context" ? command : { ...base, stage };
    const response = await POST(post(value), context);
    expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith(client, service, { campaignId, workspaceId }, userId, value, expect.any(AbortSignal));
    expect(mocks.read).not.toHaveBeenCalled(); expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("PRIVATE");
    mocks.write.mockResolvedValueOnce({ replayed: true }); expect((await POST(post(value), context)).status).toBe(200);
  });
  it.each(["anonymous", "auth-error", "access-error", "missing-campaign", "denied", "changed-user", "changed-workspace", "missing-user", "missing-workspace"])("refuses %s before creating a service client", async kind => {
    const override: Record<string, string> = {};
    if (kind === "anonymous") mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    if (kind === "auth-error") mocks.user.mockResolvedValue({ data: { user: { id: userId } }, error: new Error("PRIVATE") });
    if (kind === "access-error") mocks.access.mockResolvedValue({ campaign: { workspace_id: workspaceId }, allowed: true, error: new Error("PRIVATE") });
    if (kind === "missing-campaign") mocks.access.mockResolvedValue({ campaign: null, allowed: true, error: null });
    if (kind === "denied") mocks.access.mockResolvedValue({ campaign: { workspace_id: workspaceId }, allowed: false, error: null });
    if (kind.endsWith("user")) override["x-openplan-expected-user"] = kind.startsWith("missing") ? "" : id(99);
    if (kind.endsWith("workspace")) override["x-openplan-expected-workspace"] = kind.startsWith("missing") ? "" : id(99);
    for (const response of [await GET(get(query, override), context), await POST(post(command, override), context)]) {
      expect(response.status).toBe(["anonymous", "auth-error"].includes(kind) ? 401 : kind === "access-error" ? 503 : 403);
      expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
    }
    expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"])("refuses unregistered agent write marker %s", async header => {
    expect((await POST(post(command, { [header]: "" }), context)).status).toBe(403); expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "cross-site" }])("refuses a foreign browser origin %j", async override => {
    expect((await POST(post(command, override), context)).status).toBe(403); expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(["", `${query}&offset=1`, `${query}&execute=true`, query.replace("offset=0", "offset=-1"),
    query.replace("offset=0", "offset=01"), query.replace("offset=0", "offset=9007199254740992"), query.replace("throughSequence=4", "throughSequence=4.5")])("refuses ambiguous or invalid read query %s", async suffix => {
    expect((await GET(get(suffix), context)).status).toBe(400); expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([{ ...command, actorId: userId }, { ...command, execute: true }, { ...command, stage: "segment" },
    { ...command, intentText: "{" }, { ...command, parent: { ...parent, workspaceId } }, { ...command, requestId: parent.parentRequestId },
    { ...command, targetRecordId: `session:${id(20)}` }, { ...command, frameByteLimit: 1 }])("refuses forged or incomplete child command %j", async value => {
    expect((await POST(post(value), context)).status).toBe(400); expect(mocks.client).not.toHaveBeenCalled();
  });
  it("bounds raw bytes and rejects malformed UTF-8 before identity or private reads", async () => {
    for (const [body, status] of [["x".repeat(24 * 1024 + 1), 413], [new Uint8Array([0xff]), 400], ["{", 400]] as const) {
      const response = await POST(new NextRequest(path, { method: "POST", headers, body }), context);
      expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("refuses a malformed campaign on read and write", async () => {
    const invalid = { params: Promise.resolve({ campaignId: "bad" }) };
    expect((await GET(get(), invalid)).status).toBe(400); expect((await POST(post(), invalid)).status).toBe(400);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([new Error("PRIVATE bytes"), new SyntaxError("PRIVATE retained JSON"), new SynthesisGenerationRequestError("forbidden", 403),
    new SynthesisGenerationRequestError("conflict", 409)])("preserves denial/conflict and keeps internal corruption unavailable: %s", async cause => {
    mocks.read.mockRejectedValue(cause); mocks.write.mockRejectedValue(cause);
    for (const response of [await GET(get(), context), await POST(post(), context)]) {
      expect(response.status).toBe(cause instanceof SynthesisGenerationRequestError ? cause.status : 503);
      expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
    }
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("PRIVATE");
  });
  it("refuses an aborted request before reconstruction or creation", async () => {
    const controller = new AbortController(); controller.abort();
    expect((await GET(new NextRequest(`${path}?${query}`, { headers, signal: controller.signal }), context)).status).toBe(503);
    expect((await POST(new NextRequest(path, { method: "POST", headers, body: JSON.stringify(command), signal: controller.signal }), context)).status).toBe(503);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
});

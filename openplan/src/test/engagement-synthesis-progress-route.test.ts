import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), user: vi.fn(), access: vi.fn(), read: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client, createServiceRoleClient: mocks.service }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: mocks.access }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: mocks.info, warn: mocks.warn }) }));
vi.mock("@/lib/engagement/synthesis-progress-server", () => ({ readSynthesisProgress: mocks.read }));
import { GET } from "@/app/api/engagement/campaigns/[campaignId]/synthesis/progress/route";
import { SynthesisGenerationRequestError } from "@/lib/engagement/synthesis-generation-requests-server";

const id = (n: number) => `c7620000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const campaignId = id(1), workspaceId = id(2), requestId = id(3), userId = id(4);
const path = `http://localhost/api/engagement/campaigns/${campaignId}/synthesis/progress`;
const context = { params: Promise.resolve({ campaignId }) };
const client = { auth: { getUser: mocks.user } }, service = { private: true };
const headers = { "x-openplan-expected-user": userId, "x-openplan-expected-workspace": workspaceId };
const get = (query = `requestId=${requestId}&stage=segment`, override: Record<string, string> = {}) =>
  new NextRequest(`${path}?${query}`, { headers: { ...headers, ...override } });
beforeEach(() => {
  vi.resetAllMocks(); mocks.client.mockResolvedValue(client); mocks.service.mockReturnValue(service);
  mocks.user.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mocks.access.mockResolvedValue({ campaign: { workspace_id: workspaceId }, allowed: true, error: null });
  mocks.read.mockResolvedValue({ status: "incomplete", PRIVATE_TEST_MARKER: true });
});

describe("saved analysis results HTTP boundary", () => {
  it.each(["segment", "context", "thematic"])("loads %s with current principal and no-store response", async stage => {
    const response = await GET(get(`requestId=${requestId}&stage=${stage}`), context);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith(client, campaignId, userId, "engagement.write");
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(client, service, { campaignId, workspaceId, requestId, stage }, expect.any(AbortSignal));
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("PRIVATE_TEST_MARKER");
  });
  it.each(["", `requestId=${requestId}`, "requestId=bad&stage=segment", `requestId=${requestId}&stage=wrong`,
    `requestId=${requestId}&stage=segment&stage=context`, `requestId=${requestId}&stage=segment&workspaceId=${workspaceId}`])("rejects ambiguous query %s", async query => {
    expect((await GET(get(query), context)).status).toBe(400); expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each(["anonymous", "auth-error", "access-error", "missing-campaign", "denied", "changed-user", "changed-workspace", "missing-user", "missing-workspace"])("refuses %s before private reads", async kind => {
    const override: Record<string, string> = {};
    if (kind === "anonymous") mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    if (kind === "auth-error") mocks.user.mockResolvedValue({ data: { user: { id: userId } }, error: new Error("PRIVATE") });
    if (kind === "access-error") mocks.access.mockResolvedValue({ campaign: { workspace_id: workspaceId }, allowed: true, error: new Error("PRIVATE") });
    if (kind === "missing-campaign") mocks.access.mockResolvedValue({ campaign: null, allowed: true, error: null });
    if (kind === "denied") mocks.access.mockResolvedValue({ campaign: { workspace_id: workspaceId }, allowed: false, error: null });
    if (kind.endsWith("user")) override["x-openplan-expected-user"] = kind.startsWith("missing") ? "" : id(99);
    if (kind.endsWith("workspace")) override["x-openplan-expected-workspace"] = kind.startsWith("missing") ? "" : id(99);
    const response = await GET(get(undefined, override), context);
    expect(response.status).toBe(["anonymous", "auth-error"].includes(kind) ? 401 : kind === "access-error" ? 503 : 403);
    expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
  });
  it.each([new Error("PRIVATE source bytes"), new SyntaxError("PRIVATE malformed output"), new SynthesisGenerationRequestError("forbidden", 403)])("keeps failed reconstruction unavailable or denied: %s", async cause => {
    mocks.read.mockRejectedValue(cause); const response = await GET(get(), context);
    expect(response.status).toBe(cause instanceof SynthesisGenerationRequestError ? 403 : 503);
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("refuses an aborted request before reconstructing private history", async () => {
    const controller = new AbortController(); controller.abort();
    const response = await GET(new NextRequest(`${path}?requestId=${requestId}&stage=segment`, { headers, signal: controller.signal }), context);
    expect(response.status).toBe(503); expect(mocks.read).not.toHaveBeenCalled();
  });
});

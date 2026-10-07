import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), user: vi.fn(), access: vi.fn(), prepare: vi.fn(), read: vi.fn(), write: vi.fn(), info: vi.fn(), warn: vi.fn(), contributions: vi.fn(), contexts: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client, createServiceRoleClient: mocks.service }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: mocks.access }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: mocks.info, warn: mocks.warn }) }));
vi.mock("@/lib/engagement/synthesis-thematic-choices-server", () => ({ prepareSynthesisThematicChoice: mocks.prepare,
  readSynthesisThematicChoice: mocks.read, retainSynthesisThematicChoice: mocks.write }));
vi.mock("@/lib/engagement/synthesis-thematic-choice-discovery-server", () => ({ readThematicContributionPage: mocks.contributions, readThematicContextPage: mocks.contexts }));
import { GET, POST } from "@/app/api/engagement/campaigns/[campaignId]/synthesis/thematic-choices/route";

const id = (n: number) => `c7730000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const campaignId = id(1), workspaceId = id(2), userId = id(3);
const selection = { requestId: id(4), contextRequestId: id(5), throughSequence: 7, targetRecordId: `item:${id(6)}` };
const choiceText = JSON.stringify({ schemaVersion: 1, targetRecordId: selection.targetRecordId, contextRequestId: selection.contextRequestId,
  selectionSequence: 7, historyManifestSha256: hash("history"), finalCaptureSha256: hash("capture"), finalResultSha256: hash("result") });
const command = { ...selection, expected: { requestIntentSha256: hash("intent"), thematicSha256: hash("thematic"), choiceText } };
const receipt = { schemaVersion: 1, campaignId, workspaceId, requestId: selection.requestId, targetRecordId: selection.targetRecordId,
  choiceText, choiceSha256: hash(choiceText), createdBy: userId, createdAt: "2026-10-07T08:00:00Z", replayed: false };
const prepared = { choiceText, outputText: "PRIVATE synthetic context",
  request: { state: { request: { intentSha256: command.expected.requestIntentSha256 }, thematic: { thematicSha256: command.expected.thematicSha256 }, cancellation: null } } };
const path = `http://localhost/api/engagement/campaigns/${campaignId}/synthesis/thematic-choices`;
const context = { params: Promise.resolve({ campaignId }) };
const headers = { origin: "http://localhost", "content-type": "application/json", "x-openplan-expected-user": userId, "x-openplan-expected-workspace": workspaceId };
const query = new URLSearchParams(Object.entries({ mode: "inspect", ...selection }).map(([k, v]) => [k, String(v)])).toString();
const savedQuery = new URLSearchParams({ mode: "saved", requestId: selection.requestId, targetRecordId: selection.targetRecordId }).toString();
const contributionsQuery = new URLSearchParams({ mode: "contributions", requestId: selection.requestId, offset: "0" }).toString();
const contextsQuery = new URLSearchParams({ mode: "contexts", requestId: selection.requestId, targetRecordId: selection.targetRecordId }).toString();
const get = (suffix = query, override: Record<string, string> = {}) => new NextRequest(`${path}?${suffix}`, { headers: { ...headers, ...override } });
const post = (body: unknown = command, override: Record<string, string> = {}) => new NextRequest(path,
  { method: "POST", headers: { ...headers, ...override }, body: JSON.stringify(body) });
const client = { auth: { getUser: mocks.user } }, service = { private: true };
beforeEach(() => {
  vi.resetAllMocks(); mocks.client.mockResolvedValue(client); mocks.service.mockReturnValue(service);
  mocks.user.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mocks.access.mockResolvedValue({ campaign: { workspace_id: workspaceId }, allowed: true, error: null });
  mocks.prepare.mockResolvedValue(prepared); mocks.read.mockResolvedValue(null); mocks.write.mockResolvedValue({ record: receipt });
  mocks.contributions.mockResolvedValue({ page: { entries: [] } }); mocks.contexts.mockResolvedValue({ eligibleRequestIds: [], history: { nextCursor: null } });
});

describe("staff thematic input HTTP boundary", () => {
  it("passes contribution discovery to the current requester under explicit scope", async () => {
    const response = await GET(get(contributionsQuery), context);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.contributions).toHaveBeenCalledExactlyOnceWith(client, service, { campaignId, workspaceId, actorId: userId, requestId: selection.requestId }, 0, expect.any(AbortSignal));
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("discovers eligible contexts with the exact cursor and no service-role client", async () => {
    const before = { id: id(90), createdAt: "2026-10-07T08:00:00.123456Z" };
    const response = await GET(get(contextsQuery + "&" + new URLSearchParams({ beforeId: before.id, beforeCreatedAt: before.createdAt })), context);
    expect(response.status).toBe(200);
    expect(mocks.contexts).toHaveBeenCalledExactlyOnceWith(client, { campaignId, workspaceId, actorId: userId, requestId: selection.requestId }, selection.targetRecordId, before, expect.any(AbortSignal));
    expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it("returns a bounded preview with exact choice custody under current author scope", async () => {
    const outputText = "PRIVATE".repeat(1000); mocks.prepare.mockResolvedValue({ ...prepared, outputText });
    const response = await GET(get(), context), body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toMatchObject({ campaignId, workspaceId, actorId: userId, command, choiceSha256: hash(choiceText), interpretation: "machine_unreviewed",
      outputExcerptTruncated: true, outputBytes: Buffer.byteLength(outputText), outputSha256: hash(outputText) });
    expect(body.outputExcerpt).toBe(outputText.slice(0, 1600));
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(client, service, { campaignId, workspaceId, actorId: userId, ...selection }, expect.any(AbortSignal));
    expect(mocks.service.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.access.mock.invocationCallOrder[0]);
    expect(mocks.write).not.toHaveBeenCalled(); expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("PRIVATE");
  });
  it("reads saved custody without privileged context reconstruction, including absent choices", async () => {
    for (const value of [null, { record: receipt }]) {
      mocks.read.mockResolvedValueOnce(value); const response = await GET(get(savedQuery), context);
      expect(response.status).toBe(200); expect((await response.json()).choice).toEqual(value?.record ?? null);
    }
    expect(mocks.read).toHaveBeenCalledWith(client, { campaignId, workspaceId, requestId: selection.requestId }, selection.targetRecordId, expect.any(AbortSignal));
    expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it("passes the exact inspected command and signed-in actor to native retention", async () => {
    for (const replayed of [false, true]) {
      mocks.write.mockResolvedValueOnce({ record: { ...receipt, replayed } });
      const response = await POST(post(), context);
      expect(response.status).toBe(replayed ? 200 : 201); expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ ...receipt, replayed });
    }
    expect(mocks.write).toHaveBeenCalledWith(client, service, { campaignId, workspaceId, actorId: userId, ...command }, expect.any(AbortSignal));
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(JSON.stringify(mocks.info.mock.calls)).not.toContain(choiceText);
  });
  it.each(["anonymous", "auth-error", "access-error", "missing-campaign", "denied", "changed-user", "changed-workspace", "missing-user", "missing-workspace"])("refuses %s before privileged reconstruction", async kind => {
    const override: Record<string, string> = {};
    if (kind === "anonymous") mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    if (kind === "auth-error") mocks.user.mockResolvedValue({ data: { user: { id: userId } }, error: new Error("PRIVATE") });
    if (kind === "access-error") mocks.access.mockResolvedValue({ campaign: { workspace_id: workspaceId }, allowed: true, error: new Error("PRIVATE") });
    if (kind === "missing-campaign") mocks.access.mockResolvedValue({ campaign: null, allowed: true, error: null });
    if (kind === "denied") mocks.access.mockResolvedValue({ campaign: { workspace_id: workspaceId }, allowed: false, error: null });
    if (kind.endsWith("user")) override["x-openplan-expected-user"] = kind.startsWith("missing") ? "" : id(99);
    if (kind.endsWith("workspace")) override["x-openplan-expected-workspace"] = kind.startsWith("missing") ? "" : id(99);
    for (const response of [await GET(get(query, override), context), await GET(get(savedQuery, override), context),
      await GET(get(contributionsQuery, override), context), await GET(get(contextsQuery, override), context), await POST(post(command, override), context)]) {
      expect(response.status).toBe(["anonymous", "auth-error"].includes(kind) ? 401 : kind === "access-error" ? 503 : 403);
      expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
    }
    expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.contributions).not.toHaveBeenCalled(); expect(mocks.contexts).not.toHaveBeenCalled();
  });
  it.each(["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"])("refuses unregistered agent marker %s", async header => {
    expect((await POST(post(command, { [header]: "" }), context)).status).toBe(403); expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "cross-site" }])("refuses foreign browser origin %j", async override => {
    expect((await POST(post(command, override), context)).status).toBe(403); expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(["", `${query}&throughSequence=7`, `${query}&execute=true`, query.replace("throughSequence=7", "throughSequence=-1"),
    query.replace("throughSequence=7", "throughSequence=07"), query.replace("throughSequence=7", "throughSequence=9007199254740992"),
    `${savedQuery}&contextRequestId=${selection.contextRequestId}`, `${contextsQuery}&beforeId=${id(90)}`, `${contextsQuery}&beforeCreatedAt=2026-10-07T08%3A00%3A00Z`,
    contributionsQuery.replace("offset=0", "offset=00"), contributionsQuery.replace("offset=0", "offset=-1"), `${contextsQuery}&beforeId=${id(90)}&beforeCreatedAt=2026-10-07T08%3A00%3A00.1234567Z`])("rejects ambiguous query %s", async suffix => {
    expect((await GET(get(suffix), context)).status).toBe(400); expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([{ ...command, actorId: userId }, { ...command, execute: true }, { ...command, expected: undefined },
    { ...command, expected: { ...command.expected, choiceText: "{" } }, { ...command, targetRecordId: `session:${id(6)}` },
    { ...command, throughSequence: 8 }, { ...command, requestId: command.contextRequestId }])("rejects incomplete or substituted command %j", async value => {
    expect((await POST(post(value), context)).status).toBe(400); expect(mocks.client).not.toHaveBeenCalled();
  });
  it("bounds raw bytes and rejects malformed UTF-8 before authentication", async () => {
    for (const [body, status] of [["x".repeat(8 * 1024 + 1), 413], [new Uint8Array([0xff]), 400], ["{", 400]] as const) {
      const response = await POST(new NextRequest(path, { method: "POST", headers, body }), context);
      expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("keeps internal failures unavailable and private", async () => {
    for (const mock of [mocks.read, mocks.prepare, mocks.write]) mock.mockRejectedValue(new Error("PRIVATE original bytes"));
    for (const response of [await GET(get(), context), await GET(get(savedQuery), context), await POST(post(), context)]) {
      expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
    }
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("PRIVATE");
  });
  it("refuses aborted work before any private read or write", async () => {
    const controller = new AbortController(); controller.abort();
    expect((await GET(new NextRequest(`${path}?${query}`, { headers, signal: controller.signal }), context)).status).toBe(503);
    expect((await POST(new NextRequest(path, { method: "POST", headers, body: JSON.stringify(command), signal: controller.signal }), context)).status).toBe(503);
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
});

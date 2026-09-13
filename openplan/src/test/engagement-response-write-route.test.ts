import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/engagement/campaigns/[campaignId]/closeloop/route";
import { PATCH, DELETE } from "@/app/api/engagement/campaigns/[campaignId]/closeloop/[entryId]/route";
const handlers = { create: POST, update: PATCH, remove: DELETE };
import { GET as readBroadcast } from "@/app/api/engagement/campaigns/[campaignId]/closeloop/broadcasts/[requestId]/route";
import { loadResponseBroadcast } from "@/lib/engagement/response-broadcast";
import type { ResponseWriteIntent } from "@/lib/engagement/response-write";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(), info: vi.fn(), warn: vi.fn(), auditError: vi.fn(), rpc: vi.fn(), from: vi.fn(), getUser: vi.fn(), access: vi.fn(), createClient: vi.fn(), serviceClient: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient, createServiceRoleClient: mocks.serviceClient }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: mocks.access }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: mocks.audit }));

const campaignId = "11111111-1111-4111-8111-111111111111";
const entryId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const otherId = "44444444-4444-4444-8444-444444444444";
const userId = "55555555-5555-4555-8555-555555555555";
const version = "2026-09-13T09:02:03.123456+00:00";
const context = { params: Promise.resolve({ campaignId, entryId }) };
const readContext = { params: Promise.resolve({ campaignId, requestId }) };
const client = { auth: { getUser: mocks.getUser }, rpc: mocks.rpc, from: mocks.from };
const entry = {
  id: entryId, campaign_id: campaignId, category_id: null, theme_title: "Crossings",
  you_said: "Provide a safer crossing.", we_did: "Added to the work program.", status: "draft",
  ai_assisted: true, source_item_ids: [otherId], sort_order: 0, published_at: null,
  created_at: version, updated_at: version,
};
const receipt = { entry, entryId, requestId, removed: false, replayed: false, becamePublished: false };
const report = { campaignId, requestId, state: "queued", preparedCount: null, counts: {} };
const review = { requestId, expectedUpdatedAt: version, reason: "Correct the adopted action reference." };
const bodies = {
  create: { requestId, themeTitle: "Crossings", categoryId: null, aiAssisted: true, sourceItemIds: [otherId] },
  update: { ...review, weDid: "Retain these exact words.", categoryId: null, sourceItemIds: [otherId] },
  remove: review,
};
const methods = { create: "POST", update: "PATCH", remove: "DELETE" };
function request(operation: ResponseWriteIntent["operation"], body: unknown = bodies[operation]) {
  return new NextRequest("http://localhost/api/engagement/test", {
    method: methods[operation], headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
function publishReceipt(extra = {}) {
  return { ...receipt, entry: { ...entry, status: "published", published_at: version }, becamePublished: true, ...extra };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.audit.mockReturnValue({ info: mocks.info, warn: mocks.warn, error: mocks.auditError });
  mocks.createClient.mockResolvedValue(client);
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
  mocks.access.mockResolvedValue({ campaign: { id: campaignId }, allowed: true, error: null });
  mocks.from.mockImplementation(() => { throw new Error("Direct response writes are forbidden"); });
  mocks.rpc.mockImplementation(async (name, args) => {
    if (name === "write_engagement_response") return { data: { ...receipt, removed: args.p_operation === "remove" }, error: null };
    if (name === "read_engagement_response_broadcast") return { data: report, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });
});

describe.each(["create", "update", "remove"] as const)("%s response route boundary", operation => {
  const handle = handlers[operation];
  it("passes the caller's exact identity, version, reason and fields to the transaction", async () => {
    const response = await handle(request(operation), context);
    expect(response.status).toBe(operation === "create" ? 201 : 200);
    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(`engagement.response.${operation}`, expect.any(NextRequest));
    expect(mocks.info).toHaveBeenCalledWith("response_write_confirmed", expect.objectContaining({ campaignId, userId, requestId, entryId }));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ...receipt, removed: operation === "remove", broadcast: null, broadcastStatus: "not_required" });
    expect(mocks.access).toHaveBeenCalledWith(client, campaignId, userId, "engagement.write");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("write_engagement_response", {
      p_campaign: campaignId, p_request: requestId, p_operation: operation,
      p_response: operation === "create" ? null : entryId,
      p_expected_updated_at: operation === "create" ? null : version,
      p_reason: operation === "create" ? null : review.reason,
      p_changes: operation === "create"
        ? { theme_title: "Crossings", category_id: null, ai_assisted: true, source_item_ids: [otherId] }
        : operation === "update" ? { we_did: "Retain these exact words.", category_id: null, source_item_ids: [otherId] } : {},
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.serviceClient).not.toHaveBeenCalled();
  });
  it("rejects missing retry identity before any database access", async () => {
    const { requestId: omitted, ...body } = bodies[operation];
    expect(omitted).toBe(requestId);
    const response = await handle(request(operation, body), context);
    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("rejects malformed route identifiers before any database access", async () => {
    const response = await handle(request(operation), { params: Promise.resolve({ campaignId: "bad", entryId }) });
    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("rejects oversize JSON before database access", async () => {
    const response = await handle(request(operation, { ...bodies[operation], weDid: "x".repeat(200_000) }), context);
    expect(response.status).toBe(413);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it.each([
    ["unauthenticated", 401], ["denied", 403], ["missing", 404], ["unreadable", 503],
  ] as const)("refuses %s campaign access without a write", async (state, status) => {
    if (state === "unauthenticated") mocks.getUser.mockResolvedValue({ data: { user: null } });
    else mocks.access.mockResolvedValue({
      campaign: state === "missing" ? null : { id: campaignId },
      allowed: state !== "denied", error: state === "unreadable" ? { message: "PRIVATE failure" } : null,
    });
    const response = await handle(request(operation), context);
    expect(response.status).toBe(status);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
  });
  it.each([
    ["PT409", 409, "conflict"], ["PT503", 503, "unavailable"], ["40001", 409, "conflict"], ["23505", 409, "conflict"], ["42501", 403, "forbidden"],
    ["P0002", 404, "missing"], ["22023", 400, "invalid"], ["42P01", 503, "unavailable"],
  ])("preserves transaction refusal %s without pretending to save", async (code, status, kind) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE database detail" } });
    const response = await handle(request(operation), context);
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.kind).toBe(kind);
    expect(body).not.toHaveProperty("entry");
    expect(JSON.stringify(body)).not.toContain("PRIVATE");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("reports a connection loss as unconfirmed and retries with the same payload", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("PRIVATE disconnect"));
    const first = await handle(request(operation), context);
    expect(first.status).toBe(503);
    expect((await first.json()).error).toMatch(/retry the same request/);
    const second = await handle(request(operation), context);
    expect(second.status).toBe(operation === "create" ? 201 : 200);
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
  });
  it("does not acknowledge a receipt belonging to another request", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...receipt, requestId: otherId, removed: operation === "remove" }, error: null });
    const response = await handle(request(operation), context);
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("entry");
  });
  it("preserves a confirmed replay as the original save, including removal", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...receipt, replayed: true, removed: operation === "remove" }, error: null });
    const response = await handle(request(operation), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ requestId, replayed: true, removed: operation === "remove" });
  });
});

it.each(["update", "remove"] as const)("%s requires both version and review reason, and a valid entry id", async operation => {
  for (const field of ["expectedUpdatedAt", "reason"] as const) {
    const body = { ...bodies[operation], [field]: "" };
    expect((await handlers[operation](request(operation, body), context)).status).toBe(400);
  }
  expect((await handlers[operation](request(operation), { params: Promise.resolve({ campaignId }) })).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it.each(["create", "update"] as const)("%s publication reports durable status without inline email or a second write", async operation => {
  mocks.rpc.mockResolvedValueOnce({ data: publishReceipt(), error: null });
  const response = await handlers[operation](request(operation, { ...bodies[operation], status: "published" }), context);
  expect(response.status).toBe(operation === "create" ? 201 : 200);
  expect(await response.json()).toMatchObject({ becamePublished: true, broadcast: report, broadcastStatus: "available" });
  expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(["write_engagement_response", "read_engagement_response_broadcast"]);
  expect(mocks.rpc.mock.calls[1][1]).toEqual({ p_campaign: campaignId, p_request: requestId });
  expect(mocks.serviceClient).not.toHaveBeenCalled();
  expect(mocks.from).not.toHaveBeenCalled();
});

it.each(["missing", "denied", "throws", "invalid"])("keeps publication confirmed when its status report is %s", async failure => {
  mocks.rpc.mockResolvedValueOnce({ data: publishReceipt(), error: null });
  if (failure === "throws") mocks.rpc.mockRejectedValueOnce(new Error("PRIVATE report failure"));
  else mocks.rpc.mockResolvedValueOnce({
    data: failure === "invalid" ? { ...report, counts: { uncertain: 12 } } : null,
    error: failure === "denied" ? { code: "42501", message: "PRIVATE" } : null,
  });
  const response = await handlers.update(request("update", { ...review, status: "published" }), context);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ entryId, requestId, becamePublished: true, broadcast: null, broadcastStatus: "unknown" });
});

it("reads the original publication's current email outcomes on an exact replay", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: publishReceipt({ replayed: true }), error: null });
  mocks.rpc.mockResolvedValueOnce({ data: { ...report, state: "prepared", preparedCount: 3, counts: { accepted: 1, uncertain: 1, skipped: 1 } }, error: null });
  const response = await handlers.update(request("update", { ...review, status: "published" }), context);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ replayed: true, broadcast: { counts: { accepted: 1, uncertain: 1, skipped: 1 } } });
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
});

describe("private broadcast status reader", () => {
  it.each([
    { ...report },
    { ...report, state: "prepared", preparedCount: 0 },
    { ...report, state: "prepared", preparedCount: 7, counts: { queued: 1, attempting: 1, accepted: 1, skipped: 1, failed: 1, uncertain: 1, cancelled: 1 } },
    { ...report, state: "cancelled" },
    { ...report, state: "no_share_token" },
  ])("returns a validated complete report: %j", async candidate => {
    mocks.rpc.mockResolvedValue({ data: candidate, error: null });
    const response = await readBroadcast(new NextRequest("http://localhost/status"), readContext);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ broadcast: candidate });
    expect(mocks.access).toHaveBeenCalledWith(client, campaignId, userId, "engagement.write");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("read_engagement_response_broadcast", { p_campaign: campaignId, p_request: requestId });
  });
  it.each([
    { ...report, campaignId: otherId }, { ...report, requestId: otherId },
    { ...report, to_email: "PRIVATE@example.org" }, { ...report, counts: { to_email: 1 } },
    { ...report, preparedCount: 0 }, { ...report, state: "prepared" },
    { ...report, state: "prepared", preparedCount: 1, counts: {} },
    { ...report, state: "prepared", preparedCount: 1, counts: { queued: -1, accepted: 2 } },
    { ...report, counts: { queued: 1 } }, { ...report, state: "delivered" },
  ])("refuses incomplete, foreign or unsafe report data: %j", async candidate => {
    mocks.rpc.mockResolvedValue({ data: candidate, error: null });
    const response = await readBroadcast(new NextRequest("http://localhost/status"), readContext);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).not.toHaveProperty("broadcast");
    expect(body.error).toMatch(/does not mean no emails/);
    expect(JSON.stringify(body)).not.toContain("PRIVATE");
  });
  it("distinguishes a missing record from known zero recipients", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const response = await readBroadcast(new NextRequest("http://localhost/status"), readContext);
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("broadcast");
    expect(await loadResponseBroadcast(client as never, campaignId, requestId)).toEqual({ report: null, error: null });
  });
  it.each(["unauthenticated", "denied", "missing", "unreadable", "throws"])("refuses %s access before a private read", async failure => {
    if (failure === "unauthenticated") mocks.getUser.mockResolvedValue({ data: { user: null } });
    else if (failure === "throws") mocks.createClient.mockRejectedValue(new Error("PRIVATE configuration"));
    else mocks.access.mockResolvedValue({ campaign: failure === "missing" ? null : { id: campaignId }, allowed: failure !== "denied", error: failure === "unreadable" ? {} : null });
    const response = await readBroadcast(new NextRequest("http://localhost/status"), readContext);
    expect(response.status).toBe({ unauthenticated: 401, denied: 403, missing: 404, unreadable: 503, throws: 503 }[failure]);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
  });
  it("validates both identifiers before a private read", async () => {
    for (const params of [{ campaignId: "bad", requestId }, { campaignId, requestId: "bad" }]) {
      expect((await readBroadcast(new NextRequest("http://localhost/status"), { params: Promise.resolve(params) })).status).toBe(400);
    }
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("preserves a database permission refusal after the preliminary access check", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "PRIVATE" } });
    const response = await readBroadcast(new NextRequest("http://localhost/status"), readContext);
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("broadcast");
  });
});

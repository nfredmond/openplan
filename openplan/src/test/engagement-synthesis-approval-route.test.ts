import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { SynthesisApprovalError } from "@/lib/engagement/synthesis-approval-server";
import { SynthesisReviewError } from "@/lib/engagement/synthesis-review-server";
import { readSynthesisApprovalReceipt } from "@/lib/engagement/synthesis-approval";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), access: vi.fn(), read: vi.fn(), retain: vi.fn(), info: vi.fn(), error: vi.fn(), service: { rpc: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }), createServiceRoleClient: () => mocks.service }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: (...args: unknown[]) => mocks.access(...args) }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: mocks.info, error: mocks.error }) }));
vi.mock("@/lib/engagement/synthesis-approval-server", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/engagement/synthesis-approval-server")>(),
  loadSynthesisApprovalState: (...args: unknown[]) => mocks.read(...args), retainSynthesisApproval: (...args: unknown[]) => mocks.retain(...args) }));
import { GET, POST } from "@/app/api/engagement/campaigns/[campaignId]/synthesis/approvals/route";
const id = (n: number) => `b6000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { campaignId: id(1), workspaceId: id(2), reviewId: id(3), sourceId: id(4), sourceSha256: "a".repeat(64), preparationSha256: "b".repeat(64) };
const current = { ...scope, revisionId: scope.reviewId, revisionNo: 1, revisionSha256: "c".repeat(64) };
const intent = { ...current, actorId: id(5), requestId: id(6), operation: "approve" as const, reason: "SYNTHETIC private approval reason", predecessorId: null, predecessorSha256: null };
const event = { schemaVersion: 1, purpose: "internal_staff_synthesis", eventNo: 1, createdAt: "2026-09-27T00:00:00Z", intent };
const eventText = JSON.stringify(event), packet = { eventText, eventSha256: createHash("sha256").update(eventText).digest("hex") };
const history = { ...scope, headId: intent.requestId, headSha256: packet.eventSha256, eventCount: 1, entries: [packet] };
const path = `http://localhost/api/engagement/campaigns/${scope.campaignId}/synthesis/approvals`;
const context = { params: Promise.resolve({ campaignId: scope.campaignId }) };
const post = (body: unknown = intent, headers: Record<string, string> = {}) => new NextRequest(path, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const get = (query = `reviewId=${scope.reviewId}`, headers: Record<string, string> = {}) => new NextRequest(`${path}?${query}`, { headers });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: intent.actorId } } });
  mocks.access.mockResolvedValue({ campaign: { workspace_id: scope.workspaceId }, allowed: true, error: null });
  mocks.read.mockResolvedValue({ current, packet: history, history: { internalOnly: true } });
  mocks.retain.mockResolvedValue({ event: { ...event, ...packet }, replayed: false });
});

describe("private exact synthesis approval API", () => {
  it("binds the writer identity and returns a strict receipt without enriched internal fields", async () => {
    const res = await POST(post(), context); expect(res.status).toBe(201); expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json(); expect(body).toEqual({ event: packet, replayed: false });
    expect((await readSynthesisApprovalReceipt(body, intent)).event.intent).toEqual(intent);
    expect(mocks.retain).toHaveBeenCalledExactlyOnceWith(expect.anything(), mocks.service, { campaignId: scope.campaignId, workspaceId: scope.workspaceId, actorId: intent.actorId }, intent);
    expect(mocks.access).toHaveBeenCalledWith(expect.anything(), scope.campaignId, intent.actorId, "engagement.write");
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("synthesis_approval_retained", { campaignId: scope.campaignId, reviewId: scope.reviewId, requestId: intent.requestId, eventSha256: packet.eventSha256, operation: "approve", replayed: false });
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain(intent.reason);
  });
  it("returns replay status and private complete history from the application server", async () => {
    mocks.retain.mockResolvedValueOnce({ event: { ...event, ...packet }, replayed: true });
    const retry = await POST(post(), context); expect(retry.status).toBe(200); expect(await retry.json()).toEqual({ event: packet, replayed: true });
    const res = await GET(get(), context); expect(res.status).toBe(200); expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ current, history });
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(expect.anything(), { campaignId: scope.campaignId, workspaceId: scope.workspaceId, reviewId: scope.reviewId });
    mocks.read.mockResolvedValueOnce(null); expect((await GET(get(), context)).status).toBe(404);
  });
  it("denies missing or changed staff access before reaching private server functions", async () => {
    for (const method of [GET, POST]) {
      const request = () => method === GET ? get() : post();
      mocks.getUser.mockResolvedValueOnce({ data: { user: null } }); expect((await method(request(), context)).status).toBe(401);
      mocks.access.mockResolvedValueOnce({ campaign: null, allowed: true }); expect((await method(request(), context)).status).toBe(403);
      mocks.access.mockResolvedValueOnce({ campaign: { workspace_id: scope.workspaceId }, allowed: false }); expect((await method(request(), context)).status).toBe(403);
      mocks.access.mockResolvedValueOnce({ error: new Error("SYNTHETIC private outage") }); expect((await method(request(), context)).status).toBe(503);
      for (const key of ["x-openplan-expected-user", "x-openplan-expected-workspace"]) {
        const req = method === GET ? get(undefined, { [key]: id(90) }) : post(intent, { [key]: id(90) });
        expect((await method(req, context)).status).toBe(403);
      }
    }
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.retain).not.toHaveBeenCalled();
  });
  it.each(["actorId", "workspaceId", "campaignId"] as const)("binds command %s to the authenticated route", async field => {
    expect((await POST(post({ ...intent, [field]: id(90) }), context)).status).toBe(403); expect(mocks.retain).not.toHaveBeenCalled();
  });
  it("requires browser origin and refuses each unregistered assistant marker", async () => {
    expect((await POST(post(intent, { origin: "https://foreign.invalid" }), context)).status).toBe(403);
    for (const key of ["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"]) {
      expect((await POST(post(intent, { [key]: "SYNTHETIC" }), context)).status).toBe(403);
    }
    expect(mocks.getUser).not.toHaveBeenCalled(); expect(mocks.retain).not.toHaveBeenCalled();
  });
  it("rejects oversized, malformed and extra command content before database access", async () => {
    const huge = await POST(post({ ...intent, padding: "x".repeat(20_000) }), context);
    expect(huge.status).toBe(413); expect(huge.headers.get("cache-control")).toBe("private, no-store");
    for (const body of [{ ...intent, eventText }, { ...intent, requestId: "bad" }, { ...intent, reason: " " }]) expect((await POST(post(body), context)).status).toBe(400);
    const encoded = JSON.stringify({ ...intent, reason: "REPLACE" }), position = encoded.indexOf("REPLACE"), encoder = new TextEncoder();
    const invalidUtf8 = new Uint8Array([...encoder.encode(encoded.slice(0, position)), 255, ...encoder.encode(encoded.slice(position + 7))]);
    for (const body of ["{", invalidUtf8]) {
      expect((await POST(new NextRequest(path, { method: "POST", headers: { origin: "http://localhost" }, body }), context)).status).toBe(400);
    }
    expect(mocks.getUser).not.toHaveBeenCalled(); expect(mocks.retain).not.toHaveBeenCalled();
  });
  it("rejects invalid routes, duplicate query keys and unexpected query fields", async () => {
    const bad = { params: Promise.resolve({ campaignId: "invalid" }) };
    expect((await GET(get(), bad)).status).toBe(400); expect((await POST(post(), bad)).status).toBe(400);
    for (const query of ["", "reviewId=bad", `reviewId=${scope.reviewId}&reviewId=${scope.reviewId}`, `reviewId=${scope.reviewId}&public=true`]) expect((await GET(get(query), context)).status).toBe(400);
    expect(mocks.getUser).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.retain).not.toHaveBeenCalled();
  });
  it.each([["invalid", 400], ["forbidden", 403], ["conflict", 409], ["unavailable", 503]] as const)("preserves %s errors from approval and review loaders without exposing private details", async (kind, status) => {
    for (const ErrorType of [SynthesisApprovalError, SynthesisReviewError]) {
      for (const method of [GET, POST]) {
        (method === GET ? mocks.read : mocks.retain).mockRejectedValueOnce(new ErrorType(kind, "SYNTHETIC private details"));
        const res = await method(method === GET ? get() : post(), context);
        expect(res.status).toBe(status); expect(res.headers.get("cache-control")).toBe("private, no-store");
        expect(await res.text()).not.toContain("SYNTHETIC private details");
      }
    }
  });
  it("returns unavailable rather than success after unexpected server failures", async () => {
    mocks.retain.mockRejectedValueOnce(new Error("SYNTHETIC secret"));
    const res = await POST(post(), context); expect(res.status).toBe(503); expect(await res.text()).not.toContain("SYNTHETIC secret");
    expect(mocks.info).not.toHaveBeenCalled(); expect(mocks.error).toHaveBeenCalledExactlyOnceWith("synthesis_approval_unconfirmed");
  });
});

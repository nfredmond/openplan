import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), access: vi.fn(), rpc: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: mocks.access }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: mocks.info, warn: mocks.warn }) }));
import { POST } from "@/app/api/engagement/campaigns/[campaignId]/synthesis/execution/queue/route";
const id = (n: number) => `c7100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const campaignId = id(1), workspaceId = id(2), actorId = id(3);
const command = { schemaVersion: 1, queueId: id(4), authorizationId: id(5), authorizationIntentSha256: "a".repeat(64),
  campaignId, workspaceId, actorId, requestId: id(6), sourceId: id(7), sourceSha256: "b".repeat(64), requestIntentSha256: "c".repeat(64), stage: "segment" };
const commandText = JSON.stringify(command, null, 2);
const receipt = { schemaVersion: 1, queueId: command.queueId, commandText,
  commandSha256: createHash("sha256").update(commandText).digest("hex"), createdAt: "2026-10-07T23:00:00Z" };
const headers = { origin: "http://localhost", "content-type": "application/json", "x-openplan-expected-user": actorId, "x-openplan-expected-workspace": workspaceId };
const context = { params: Promise.resolve({ campaignId }) };
function request(body: string | Uint8Array<ArrayBuffer> = commandText, extra: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/engagement/campaigns/${campaignId}/synthesis/execution/queue`, {
    method: "POST", headers: { ...headers, ...extra }, body,
  });
}
const client = { auth: { getUser: mocks.user }, rpc: (name: string, args: unknown) => ({ abortSignal: (signal: AbortSignal) => mocks.rpc(name, args, signal) }) };
beforeEach(() => {
  vi.resetAllMocks(); mocks.client.mockResolvedValue(client);
  mocks.user.mockResolvedValue({ data: { user: { id: actorId } }, error: null });
  mocks.access.mockResolvedValue({ campaign: { workspace_id: workspaceId }, allowed: true, error: null });
  mocks.rpc.mockResolvedValue({ data: receipt, error: null });
});
describe("staff scheduling HTTP boundary", () => {
  it("preserves exact bytes and returns a private verified receipt", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(receipt);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith(client, campaignId, actorId, "engagement.write");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("enqueue_engagement_synthesis_execution", { p_command_text: commandText }, expect.any(AbortSignal));
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("queue_entry_retained", { queueId: command.queueId });
  });
  it.each(["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"])("refuses agent header %s", async key => {
    expect((await POST(request(commandText, { [key]: "" }), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "cross-site" },
    { "x-openplan-expected-user": "" }, { "x-openplan-expected-workspace": id(99) }])("refuses changed browser scope %j", async extra => {
    expect((await POST(request(commandText, extra), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["anonymous", "denied", "access-error"])("refuses %s before transport", async kind => {
    if (kind === "anonymous") mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    else mocks.access.mockResolvedValue({ campaign: { workspace_id: workspaceId }, allowed: kind !== "denied", error: kind === "access-error" ? new Error("PRIVATE") : null });
    const response = await POST(request(), context);
    expect(response.status).toBe(kind === "anonymous" ? 401 : kind === "denied" ? 403 : 503);
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["x".repeat(4097), 413], [new Uint8Array([255]), 400], ["{", 400]] as const)("refuses invalid body", async (body, status) => {
    const response = await POST(request(body), context);
    expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not acknowledge a malformed native receipt", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...receipt, commandSha256: "0".repeat(64) }, error: null });
    expect((await POST(request(), context)).status).toBe(503); expect(mocks.info).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { ImplementationReportError } from "@/lib/land-use-plans/implementation-report-store";
const mocks = vi.hoisted(() => ({ access: vi.fn(), service: vi.fn(), execute: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/land-use-plans/api", () => ({ loadLandUsePlanAccess: mocks.access }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.service }));
vi.mock("@/lib/land-use-plans/implementation-report-store", async load => ({ ...await load<object>(), executeImplementationReport: mocks.execute }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: mocks.info, warn: mocks.warn }) }));
import { POST } from "@/app/api/land-use-plans/[planId]/implementation-reports/route";
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const planId = id(1), workspaceId = id(2), actorId = id(3), versionId = id(4), commandId = id(5);
const scope = { planId, workspaceId, actorId };
const command = { operation: "generate", commandId, versionId, expectedVersionHash: "a".repeat(64), reportingPeriodStart: "2026-01-01", reportingPeriodEnd: "2026-10-07", title: "SYNTHETIC report", summary: null };
const result = { reportId: id(6), replayed: false };
const client = { privileged: true };
const invalidUtf8 = new TextEncoder().encode(JSON.stringify(command));
invalidUtf8[JSON.stringify(command).indexOf("SYNTHETIC")] = 255;
function post(text: string | Uint8Array = JSON.stringify(command), extra: Record<string, string> = {}, selectedPlan = planId) {
  return POST(new NextRequest(`http://localhost/api/land-use-plans/${selectedPlan}/implementation-reports`, {
    method: "POST", body: text as BodyInit, headers: { origin: "http://localhost", "content-type": "application/json",
      "x-openplan-expected-user": actorId, "x-openplan-expected-workspace": workspaceId, ...extra },
  }), { params: Promise.resolve({ planId: selectedPlan }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ ok: true, access: { userId: actorId, plan: { id: planId, workspace_id: workspaceId } } });
  mocks.service.mockReturnValue(client); mocks.execute.mockResolvedValue(result);
});
describe("implementation report route custody", () => {
  it("passes exact bytes and authenticated scope to the sole transaction", async () => {
    const raw = ` \n${JSON.stringify({ ...command, summary: "歩行 🌉" })}\n`;
    const response = await post(raw);
    expect(response.status).toBe(201); expect(await response.json()).toEqual(result);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.access).toHaveBeenCalledWith(planId, { write: true });
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(client, scope, raw);
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("歩行");
  });
  it("recovers a saved command without requiring a current adopted pointer at the route", async () => {
    mocks.execute.mockResolvedValue({ ...result, replayed: true });
    const response = await post(); expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it.each(["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"])("refuses agent header %s before privileged access", async header => {
    const response = await post(undefined, { [header]: "" }); expect(response.status).toBe(403);
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each([{ origin: "https://other.invalid" }, { origin: "" }, { "sec-fetch-site": "cross-site" }, { "x-openplan-expected-user": id(7) }, { "x-openplan-expected-workspace": id(7) }, { "x-openplan-expected-user": "" }, { "x-openplan-expected-workspace": "" }] as Array<Record<string, string>>)("refuses mismatched browser scope %j", async headers => {
    const response = await post(undefined, headers); expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404])("preserves access refusal %s", async status => {
    mocks.access.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "unavailable" }, { status }) });
    const response = await post(); expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["{", "null", JSON.stringify({ ...command, unexpected: true }), JSON.stringify({ ...command, reportingPeriodEnd: "2025-01-01" }), JSON.stringify({ ...command, commandId: "invalid" }), new Uint8Array([0xff]), invalidUtf8, `\uFEFF${JSON.stringify(command)}`])("refuses malformed request %s without transport", async raw => {
    const response = await post(raw); expect(response.status).toBe(400); expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled();
  });
  it("bounds actual bytes despite a smaller declared length", async () => {
    for (const [raw, headers] of [["x".repeat(98305), { "content-length": "1" }], ["歩".repeat(32769), {}]] as const) {
      const response = await post(raw, headers); expect(response.status).toBe(413);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("refuses malformed plan identity before access", async () => {
    expect((await post(undefined, {}, "invalid")).status).toBe(400); expect(mocks.access).not.toHaveBeenCalled();
  });
  it.each([ ["invalid", 400], ["forbidden", 403], ["missing", 404], ["conflict", 409], ["unavailable", 503] ] as const)("keeps %s failures distinct", async (kind, status) => {
    mocks.execute.mockRejectedValue(new ImplementationReportError(kind)); const response = await post();
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ kind, error: expect.any(String) });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("withholds unexpected internals", async () => {
    mocks.execute.mockRejectedValue(new Error("private failure")); const response = await post(); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private failure"); expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("private failure");
  });
});

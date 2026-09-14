import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST, DELETE } from "@/app/api/engagement/campaigns/[campaignId]/translations/route";

const forbidden = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), model: vi.fn(), keys: vi.fn(), meter: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: forbidden.client, createServiceRoleClient: forbidden.service }));
vi.mock("@/lib/engagement/translation", () => ({ translateEngagementText: forbidden.model }));
vi.mock("@/lib/integrations/workspace-keys", () => ({ withWorkspaceIntegrationContext: forbidden.keys }));
vi.mock("@/lib/runtime/ai-rate-limit", () => ({ checkAiUsageRateLimit: forbidden.meter, recordAiUsageEvent: forbidden.meter }));
const url = "http://localhost/api/engagement/campaigns/11111111-1111-4111-8111-111111111111/translations";
const words = "SYNTHETIC private unsaved words";
beforeEach(() => vi.clearAllMocks());
// Exercise the exported Next handlers with the arguments Next supplies, even
// though the retired endpoint deliberately does not need to read either one.
const handlers: Record<string, (request: NextRequest, context: { params: Promise<{ campaignId: string }> }) => Response> = { POST, DELETE };

describe("retired translation write route", () => {
  it.each(["suggest", "publish_machine", "save", "accept", "withdraw", "unknown"])("refuses legacy POST %s without reading or replaying it", async action => {
    const request = new NextRequest(url, { method: "POST", body: JSON.stringify({ action, locale: "es", fieldKeys: ["campaign:old:title"], entries: [{ fieldKey: "campaign:old:title", text: words }] }) });
    const response = handlers.POST(request, { params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }) });
    expect(response.status).toBe(410); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("location")).toBeNull();
    const body = await response.json(); expect(body.kind).toBe("retired"); expect(body.error).toMatch(/Keep a copy of any unsaved words/);
    expect(body.details).toMatch(/did not change saved translations or request machine generation/);
    expect(JSON.stringify(body)).not.toContain(words); expect(request.bodyUsed).toBe(false);
    for (const dependency of Object.values(forbidden)) expect(dependency).not.toHaveBeenCalled();
  });
  it("refuses legacy DELETE without withdrawing or redirecting", async () => {
    const request = new NextRequest(url + "?fieldKey=campaign:old:title&locale=es", { method: "DELETE" });
    const response = handlers.DELETE(request, { params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }) });
    expect(response.status).toBe(410); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toMatchObject({ kind: "retired", error: expect.stringContaining("Keep a copy") });
    for (const dependency of Object.values(forbidden)) expect(dependency).not.toHaveBeenCalled();
  });
  it.each(["POST", "DELETE"])("returns the same non-disclosing refusal for %s with malformed scope or agent headers", async method => {
    const request = new NextRequest(url.replace("11111111-1111-4111-8111-111111111111", "invalid"), { method, headers: { "x-openplan-assistant-execution-source": "", origin: "https://unrelated.invalid" }, ...(method === "POST" ? { body: "SYNTHETIC malformed body" } : {}) });
    const response = handlers[method](request, { params: Promise.resolve({ campaignId: "invalid" }) });
    expect(response.status).toBe(410); expect(request.bodyUsed).toBe(false); expect(await response.json()).toMatchObject({ kind: "retired" });
    for (const dependency of Object.values(forbidden)) expect(dependency).not.toHaveBeenCalled();
  });
});

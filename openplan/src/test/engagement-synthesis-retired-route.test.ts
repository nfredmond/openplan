import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/engagement/campaigns/[campaignId]/synthesis/route";

const forbidden = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), model: vi.fn(), keys: vi.fn(), meter: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: forbidden.client, createServiceRoleClient: forbidden.service }));
vi.mock("@/lib/engagement/ai-synthesis", () => ({ generateEngagementSynthesis: forbidden.model }));
vi.mock("@/lib/integrations/workspace-keys", () => ({ withWorkspaceIntegrationContext: forbidden.keys }));
vi.mock("@/lib/runtime/ai-rate-limit", () => ({ checkAiUsageRateLimit: forbidden.meter, recordAiUsageEvent: forbidden.meter }));
const url = "http://localhost/api/engagement/campaigns/11111111-1111-4111-8111-111111111111/synthesis";
const words = "SYNTHETIC private unsaved words";
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe("retired synthesis generator", () => {
  it.each(["", JSON.stringify({ text: words }), "not valid JSON"])("refuses old requests without effects or body consumption: %s", async body => {
    const request = new NextRequest(url, { method: "POST", body });
    const response = POST(request);
    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({ kind: "retired",
      error: expect.stringMatching(/Keep a copy of any unsaved text.*retained synthesis sources and staff reviews/),
      details: expect.stringMatching(/did not change saved summaries or request machine generation.*do not generate AI themes or approve findings/),
    });
    expect(request.bodyUsed).toBe(false);
    for (const dependency of Object.values(forbidden)) expect(dependency).not.toHaveBeenCalled();
  });
  it("audits retirement without submitted text, query values or credentials", async () => {
    const queryWords = "SYNTHETIC private query";
    const request = new NextRequest(url + "?text=" + encodeURIComponent(queryWords), {
      method: "POST", body: words, headers: { authorization: "Bearer SYNTHETIC-secret", "x-request-id": "synthetic-retired-request" },
    });
    const response = POST(request);
    expect(response.status).toBe(410); expect(console.warn).toHaveBeenCalledTimes(1);
    const line = vi.mocked(console.warn).mock.calls[0][0] as string;
    expect(JSON.parse(line)).toMatchObject({ route: "engagement.synthesis.retired", event: "engagement_synthesis_write_retired",
      method: "POST", path: new URL(url).pathname, requestId: "synthetic-retired-request", context: { status: 410 } });
    for (const value of [words, queryWords, encodeURIComponent(queryWords), "SYNTHETIC-secret"]) expect(line).not.toContain(value);
    expect(request.bodyUsed).toBe(false);
    for (const dependency of Object.values(forbidden)) expect(dependency).not.toHaveBeenCalled();
  });
  it("gives the same non-disclosing refusal to malformed scope, foreign origin and agent requests", async () => {
    const request = new NextRequest(url.replace("11111111-1111-4111-8111-111111111111", "invalid"), {
      method: "POST", body: words, headers: { origin: "https://unrelated.invalid", "x-openplan-assistant-execution-source": "" },
    });
    const response = POST(request);
    expect(response.status).toBe(410); expect(request.bodyUsed).toBe(false);
    expect(await response.json()).toMatchObject({ kind: "retired" });
    for (const dependency of Object.values(forbidden)) expect(dependency).not.toHaveBeenCalled();
  });
});

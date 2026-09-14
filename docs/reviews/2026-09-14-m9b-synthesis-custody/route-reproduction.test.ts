// Historical defect diagnostic, not a regression specification for desired behavior.
// run-route-reproduction.py installs this temporarily in the app test root.
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

type Row = { id: string; body: string; title: null; category_id: string; latitude: null; longitude: null };
const state = vi.hoisted(() => ({
  rows: [] as Row[],
  saveError: false,
  saved: null as Record<string, unknown> | null,
  calls: [] as { table: string; method: string; args: unknown[] }[],
  model: vi.fn(),
  access: vi.fn(),
  warn: vi.fn(),
}));
const campaignId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";

function query(table: string) {
  let cap: number | undefined;
  let update: Record<string, unknown> | undefined;
  const call = (method: string, args: unknown[]) => state.calls.push({ table, method, args });
  const q = {
    select(...args: unknown[]) { call("select", args); return q; },
    eq(...args: unknown[]) { call("eq", args); return q; },
    order(...args: unknown[]) { call("order", args); return q; },
    limit(n: number) { cap = n; call("limit", [n]); return q; },
    then(resolve: (value: { data: unknown; error: { message: string } | null }) => unknown) {
      if (table === "engagement_items") return Promise.resolve(resolve({ data: state.rows.slice(0, cap), error: null }));
      if (table === "engagement_categories") return Promise.resolve(resolve({ data: [{ id: "routine", label: "SYNTHETIC routine" }, { id: "distinct", label: "SYNTHETIC distinct concern" }], error: null }));
      if (table === "engagement_campaigns" && update) {
        if (state.saveError) return Promise.resolve(resolve({ data: null, error: { message: "SYNTHETIC save unavailable" } }));
        state.saved = update;
        return Promise.resolve(resolve({ data: null, error: null }));
      }
      throw new Error(`Unexpected query ${table}`);
    },
    update(payload: Record<string, unknown>) { update = payload; call("update", [payload]); return q; },
  };
  return q;
}
const client = { auth: { getUser: async () => ({ data: { user: { id: userId } } }) }, from: query };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: (...args: unknown[]) => state.access(...args) }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ warn: state.warn, error: vi.fn() }) }));
vi.mock("@/lib/integrations/workspace-keys", () => ({ withWorkspaceIntegrationContext: (_id: string, work: () => Promise<unknown>) => work() }));
vi.mock("@/lib/runtime/ai-rate-limit", () => ({ checkAiUsageRateLimit: async () => ({ allowed: true }), recordAiUsageEvent: vi.fn() }));
vi.mock("@/lib/integrations/anthropic-access", () => ({ hasAnthropicAccess: () => false, anthropicModel: vi.fn() }));
vi.mock("ai", () => ({ generateText: (...args: unknown[]) => state.model(...args) }));
import { POST } from "@/app/api/engagement/campaigns/[campaignId]/synthesis/route";

function corpus(count: number) {
  state.rows = Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    body: i === count - 1 ? "SYNTHETIC distinct concern" : "SYNTHETIC routine comment",
    title: null, category_id: i === count - 1 ? "distinct" : "routine", latitude: null, longitude: null,
  }));
}
async function invoke() {
  const result = await POST(new NextRequest(`http://localhost/api/engagement/campaigns/${campaignId}/synthesis`, { method: "POST" }), { params: Promise.resolve({ campaignId }) });
  const body = await result.json();
  expect(state.access).toHaveBeenCalledWith(client, campaignId, userId, "engagement.write");
  expect(state.calls).toContainEqual({ table: "engagement_items", method: "select", args: ["id, body, title, category_id, latitude, longitude"] });
  expect(state.calls).toContainEqual({ table: "engagement_items", method: "eq", args: ["campaign_id", campaignId] });
  expect(state.calls).toContainEqual({ table: "engagement_items", method: "eq", args: ["status", "approved"] });
  expect(state.calls).toContainEqual({ table: "engagement_items", method: "order", args: ["created_at", { ascending: true }] });
  expect(state.model).not.toHaveBeenCalled();
  return { result, body };
}
beforeEach(() => {
  state.saved = null; state.saveError = false; state.calls = [];
  state.access.mockResolvedValue({ campaign: { id: campaignId, workspace_id: workspaceId }, allowed: true, error: null });
  state.model.mockImplementation(() => { throw new Error("Unexpected model call"); });
});
it("CONTROL: 300 sources retain the last category and a confirmed saved result", async () => {
  corpus(300);
  const { result, body } = await invoke();
  expect(result.status).toBe(200);
  expect(body.synthesis.item_count).toBe(300);
  expect(body.synthesis.grounding.facts).toHaveLength(300);
  expect(body.synthesis.themes).toContainEqual(expect.objectContaining({ label: "SYNTHETIC distinct concern", item_count: 1 }));
  expect(state.saved).toEqual({ ai_synthesis_json: body.synthesis, ai_synthesized_at: body.synthesizedAt });
});
it("DEFECT: 301 approved sources report only 300 and lose the last category", async () => {
  corpus(301);
  const { result, body } = await invoke();
  expect(result.status).toBe(200);
  expect(state.rows).toHaveLength(301);
  expect(body.synthesis.item_count).toBe(300);
  expect(body.synthesis.analyzed_item_count).toBe(300);
  expect(body.synthesis.grounding.facts).toHaveLength(300);
  expect(body.synthesis.grounding.facts[0].fact_id).toBe(`item_${state.rows[0].id}`);
  expect(body.synthesis.grounding.facts.some((f: { fact_id: string }) => f.fact_id === `item_${state.rows[300].id}`)).toBe(false);
  expect(body.synthesis.themes.map((t: { label: string }) => t.label)).toEqual(["SYNTHETIC routine"]);
  expect(state.saved).toEqual({ ai_synthesis_json: body.synthesis, ai_synthesized_at: body.synthesizedAt });
});
it("DEFECT: failed save returns the same success shape while retaining no result", async () => {
  corpus(300); state.saveError = true;
  const { result, body } = await invoke();
  expect(result.status).toBe(200);
  expect(Object.keys(body).sort()).toEqual(["synthesis", "synthesizedAt"]);
  expect(body.synthesis.item_count).toBe(300);
  expect(body.synthesizedAt).toEqual(expect.any(String));
  expect(state.saved).toBeNull();
  expect(state.warn).toHaveBeenCalledWith("engagement_synthesis_persist_failed", { campaignId, message: "SYNTHETIC save unavailable" });
});

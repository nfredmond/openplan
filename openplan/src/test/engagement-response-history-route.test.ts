import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: mocks.access }));
vi.mock("@/lib/engagement/response-history-server", () => ({ loadResponseHistory: mocks.read }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn() }) }));
import { GET } from "@/app/api/engagement/campaigns/[campaignId]/closeloop/history/route";
const campaignId = "10000000-0000-4000-8000-000000000001";
const request = () => GET(new NextRequest(`http://localhost/api/engagement/campaigns/${campaignId}/closeloop/history`), { params: Promise.resolve({ campaignId }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: "staff" } } });
  mocks.access.mockResolvedValue({ campaign: { id: campaignId }, allowed: true, error: null });
  mocks.read.mockResolvedValue({ rows: [], error: null });
});
it("returns private no-store history using staff write permission", async () => {
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ history: [] });
  expect(mocks.access).toHaveBeenCalledWith(expect.anything(), campaignId, "staff", "engagement.write");
  expect(mocks.read).toHaveBeenCalledWith(expect.anything(), campaignId);
});
it.each([
  ["anonymous", 401, () => mocks.user.mockResolvedValue({ data: { user: null } })],
  ["viewer", 403, () => mocks.access.mockResolvedValue({ campaign: { id: campaignId }, allowed: false })],
  ["missing campaign", 404, () => mocks.access.mockResolvedValue({ campaign: null })],
  ["failed access read", 503, () => mocks.access.mockResolvedValue({ error: { message: "offline" } })],
])("refuses %s before reading private history", async (_label, status, setup) => {
  setup(); expect((await request()).status).toBe(status); expect(mocks.read).not.toHaveBeenCalled();
});
it("reports failed verification without false empty history", async () => {
  mocks.read.mockResolvedValue({ rows: [], error: { message: "History could not be verified" } });
  const response = await request();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "History could not be verified" });
});

/** Real RPC reader, route and component; SQL aggregation and real layout need separate evidence. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailDeliveryRecordSchema, loadCampaignEmailDeliverySummary } from "@/lib/notifications/email-delivery-summary";
const m = vi.hoisted(() => ({ rpc: vi.fn(), access: vi.fn(), service: vi.fn(), user: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: m.rpc, from: m.from, auth: { getUser: m.user } }), createServiceRoleClient: m.service }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ error: vi.fn() }) }));
vi.mock("@/lib/engagement/api", () => ({ loadCampaignAccess: m.access }));
import { GET } from "@/app/api/engagement/campaigns/[campaignId]/notifications/route";
import { EngagementNotificationsInbox } from "@/components/engagement/notifications-inbox";
const campaignId = "11111111-1111-4111-8111-111111111111";
function record() { return { ok: true as const, campaignId, total: 1009,
  counts: { queued: 1, sent: 1, skipped: 1003, failed: 1, attempting: 1, uncertain: 1, cancelled: 1 },
  broadcasts: { queued: 1, prepared: 4, cancelled: 1, noShareToken: 1 },
  transports: ["none", "resend"], lastRecordedAt: "2026-09-13T10:00:00Z", lastFailure: null }; }
async function route() { return GET(new NextRequest(`http://localhost/api/engagement/campaigns/${campaignId}/notifications`), { params: Promise.resolve({ campaignId }) }); }
function show(body: unknown) {
  vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => body } as Response);
  render(<EngagementNotificationsInbox campaignId={campaignId} initialNotifications={[]} />);
}
beforeEach(() => {
  vi.clearAllMocks(); m.rpc.mockResolvedValue({ data: record(), error: null });
  m.user.mockResolvedValue({ data: { user: { id: "staff" } } });
  m.access.mockResolvedValue({ allowed: true, campaign: { id: campaignId }, error: null });
  m.from.mockImplementation(() => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [], error: null }) }));
});
afterEach(() => vi.restoreAllMocks());
describe("complete delivery record in Activity", () => {
  it("uses the staff-scoped RPC without service-role recipient reads", async () => {
    const res = await route(); expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await res.json()).emailDelivery).toEqual(record());
    expect(m.rpc).toHaveBeenCalledWith("read_engagement_email_delivery_summary", { p_campaign: campaignId });
    expect(m.service).not.toHaveBeenCalled(); expect(m.from).toHaveBeenCalledExactlyOnceWith("engagement_notifications");
  });
  it("shows complete counts and honest outcome labels", async () => {
    show(await (await route()).json()); const panel = await screen.findByTestId("email-delivery-panel");
    await waitFor(() => expect(panel.textContent).toContain("1009 messages recorded"));
    for (const text of ["1 Accepted by email service", "1003 Recorded, not sent", "1 Attempt in progress", "1 Outcome uncertain", "1 Cancelled before sending", "1 Failed", "1 Still queued", "does not confirm inbox delivery", "does not automatically resend uncertain messages"]) expect(panel.textContent).toContain(text);
    expect(panel.textContent).not.toContain("most recent only");
  });
  it("keeps unprepared recipient counts unknown", async () => {
    const data = record(); data.total = 0; for (const key of Object.keys(data.counts) as (keyof typeof data.counts)[]) data.counts[key] = 0;
    data.broadcasts = { queued: 2, prepared: 0, cancelled: 0, noShareToken: 0 }; show({ emailDelivery: data });
    await screen.findByText(/Recipient count is not known yet/); expect(screen.queryByText(/No emails have been queued/)).toBeNull();
  });
  it("distinguishes missing links from cancelled preparation", async () => {
    show({ emailDelivery: record() }); await screen.findByText(/campaign had no public link/);
    expect(screen.getByText(/cancelled before recipient preparation/)).toBeTruthy();
  });
  it("refreshes a changing attempt outcome", async () => {
    show({ emailDelivery: record() }); await screen.findByText("1 Outcome uncertain");
    const data = record(); data.counts.uncertain = 0; data.counts.sent = 2;
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ emailDelivery: data }) } as Response);
    fireEvent.click(screen.getByRole("button", { name: "Refresh email status" }));
    await screen.findByText("2 Accepted by email service"); expect(screen.queryByText("1 Outcome uncertain")).toBeNull();
  });
  it("does not turn a refused read into zero or expose database errors", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "private@example.org" } });
    const body = await (await route()).json(); expect(body.emailDelivery.ok).toBe(false); expect(JSON.stringify(body)).not.toContain("private@example.org");
    show(body); await screen.findByText("The email delivery record could not be read"); expect(screen.queryByText(/No emails have been queued/)).toBeNull();
  });
  it("does not read outcomes when campaign access is denied", async () => {
    m.access.mockResolvedValue({ allowed: false, campaign: { id: campaignId }, error: null });
    expect((await route()).status).toBe(403); expect(m.rpc).not.toHaveBeenCalled();
  });
  it.each(["total", "negative", "missing", "private", "campaign"])("rejects a %s defect at the reader", async defect => {
    const data: Record<string, unknown> = record();
    if (defect === "total") data.total = 1008;
    if (defect === "negative") { data.counts = { ...record().counts, queued: -1 }; data.total = 1007; }
    if (defect === "missing") delete data.broadcasts;
    if (defect === "private") data.to_email = "participant@example.org";
    if (defect === "campaign") data.campaignId = "22222222-2222-4222-8222-222222222222";
    m.rpc.mockResolvedValue({ data, error: null }); expect((await loadCampaignEmailDeliverySummary({ rpc: m.rpc }, campaignId)).ok).toBe(false);
  });
  it.each(["total", "campaign"])("rejects a %s defect at the browser boundary", async defect => {
    const data = record(); if (defect === "total") data.total = 0; else data.campaignId = "22222222-2222-4222-8222-222222222222";
    show({ emailDelivery: data }); await screen.findByText(/incomplete or mismatched delivery record/); expect(screen.queryByText(/messages recorded/)).toBeNull();
  });
  it("hides the old campaign record during navigation", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({ ok: true, json: async () => ({ emailDelivery: record() }) } as Response);
    const view = render(<EngagementNotificationsInbox campaignId={campaignId} initialNotifications={[]} />);
    await screen.findByText("1 Outcome uncertain");
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(() => {}));
    view.rerender(<EngagementNotificationsInbox campaignId="22222222-2222-4222-8222-222222222222" initialNotifications={[]} />);
    expect(screen.queryByText("1 Outcome uncertain")).toBeNull();
  });
  it("refuses raw provider text in failure details", () => {
    expect(emailDeliveryRecordSchema.safeParse({ ...record(), lastFailure: { at: "2026-09-13T10:00:00Z", message: "resident7@example.org was refused" } }).success).toBe(false);
  });
});

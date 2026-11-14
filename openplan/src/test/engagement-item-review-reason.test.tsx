import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The single-contribution review form wired to the real PATCH route, with a
// fake Supabase client behind it. The route refuses a moderation change
// without a reason and says "Record a review reason"; the form must ask for
// the reason under that name and send it. Blind category: the database
// trigger that copies review_reason into history is not exercised here.

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "66666666-6666-4666-8666-666666666666";
const UPDATED_AT = "2026-10-18T00:00:00+00:00";

const updateCalls: Array<Record<string, unknown>> = [];

function result(data: unknown) {
  return { data, error: null };
}

function fakeQuery(table: string) {
  let pendingUpdate: Record<string, unknown> | null = null;
  const builder = {
    select: () => builder,
    eq: () => builder,
    update: (values: Record<string, unknown>) => {
      pendingUpdate = values;
      updateCalls.push(values);
      return builder;
    },
    maybeSingle: async () => {
      if (table === "engagement_campaigns") return result({ id: CAMPAIGN_ID, workspace_id: "33333333-3333-4333-8333-333333333333", project_id: null, title: "Countywide safety comments", status: "active" });
      if (table === "workspace_members") return result({ workspace_id: "33333333-3333-4333-8333-333333333333", role: "member" });
      if (table === "engagement_items" && pendingUpdate) return result({ id: ITEM_ID, updated_at: "2026-10-18T00:05:00+00:00" });
      if (table === "engagement_items") return result({ id: ITEM_ID, campaign_id: CAMPAIGN_ID, category_id: null, updated_at: UPDATED_AT, status: "pending", source_type: "public", title: "Crossing", body: "Cars pass the school crossing too fast.", submitted_by: null, photo_path: null, geometry: null, latitude: null, longitude: null });
      throw new Error(`Unexpected table ${table}`);
    },
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "22222222-2222-4222-8222-222222222222" } } }) },
    from: (table: string) => fakeQuery(table),
  }),
}));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/engagement/location-display-map", () => ({ LocationDisplayMap: () => null }));
vi.mock("@/components/engagement/survey-review-attachments", () => ({ SurveyReviewAttachments: () => null, SurveyHistoricalAttachments: () => null }));

import { PATCH as patchItem } from "@/app/api/engagement/campaigns/[campaignId]/items/[itemId]/route";
import { EngagementItemRegistry, type ItemRecord } from "@/components/engagement/engagement-item-registry";

const item: ItemRecord = {
  id: ITEM_ID, campaign_id: CAMPAIGN_ID, category_id: null, title: "Crossing",
  body: "Cars pass the school crossing too fast.", submitted_by: null, status: "pending",
  source_type: "public", moderation_notes: null, updated_at: UPDATED_AT,
};
const counts = { totalItems: 1, uncategorizedItems: 1, geographyCoverage: { geolocatedItems: 0 }, moderationQueue: { actionableCount: 1, pendingCount: 1, flaggedCount: 0 } };

beforeEach(() => {
  updateCalls.length = 0;
  vi.stubGlobal("fetch", (url: string, init: RequestInit) =>
    patchItem(new NextRequest(`http://localhost${url}`, init as ConstructorParameters<typeof NextRequest>[1]), {
      params: Promise.resolve({ campaignId: CAMPAIGN_ID, itemId: ITEM_ID }),
    }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("single contribution review reason", () => {
  it("approves one comment when the planner fills the field the refusal names", async () => {
    render(<EngagementItemRegistry items={[item]} categories={[]} counts={counts} />);
    fireEvent.change(screen.getByLabelText("Review reason"), { target: { value: "Checked against the crossing site visit." } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(updateCalls).toHaveLength(1));
    expect(updateCalls[0]).toMatchObject({ status: "approved", review_reason: "Checked against the crossing site visit.", moderation_notes: "Checked against the crossing site visit." });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still refuses an approval with no reason and names the same field", async () => {
    render(<EngagementItemRegistry items={[item]} categories={[]} counts={counts} />);
    expect(screen.getByLabelText("Review reason")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Record a review reason before changing the public copy or moderation state.");
    expect(updateCalls).toHaveLength(0);
  });

  // KI-2026-11-14-114: the status control read "Approved" after the refusal.
  it("puts the status control back to the saved status when the approval is refused", async () => {
    render(<EngagementItemRegistry items={[item]} categories={[]} counts={counts} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByRole("alert");
    expect((document.getElementById(`engagement-item-status-${ITEM_ID}`) as HTMLSelectElement).value).toBe("pending");
  });
});

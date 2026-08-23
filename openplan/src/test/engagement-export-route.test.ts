import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const campaignMaybeSingleMock = vi.fn();
const campaignEqMock = vi.fn(() => ({ maybeSingle: campaignMaybeSingleMock }));
const campaignSelectMock = vi.fn(() => ({ eq: campaignEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const categoriesResult = vi.fn();
const categoriesEqMock = vi.fn(() => categoriesResult());
const categoriesSelectMock = vi.fn(() => ({ eq: categoriesEqMock }));

/**
 * The items fixture, still configured as `itemsOrderMock.mockResolvedValue(...)`
 * by every test below. What changed is the terminal: the export PAGES now, so
 * the chain ends at `.range(from, to)` and this fake SLICES.
 *
 * Slicing rather than returning the whole fixture to every call is the point. A
 * fake that ignored the range would be a server with no row cap — the one
 * server on which a truncating export cannot be observed — and a route that
 * read only its first page would still satisfy every assertion here.
 */
const itemsOrderMock = vi.fn();
let itemsPageSource: Promise<{ data?: unknown[] | null; error?: unknown }> | null = null;
const itemsRangeMock = vi.fn(async (from: number, toInclusive: number) => {
  itemsPageSource ??= Promise.resolve(
    itemsOrderMock() as unknown as { data?: unknown[] | null; error?: unknown }
  );
  const result = await itemsPageSource;
  if (result?.error) return result;
  const rows = (result?.data ?? []) as unknown[];
  return { data: rows.slice(from, toInclusive + 1), error: null };
});
const itemsChain: Record<string, unknown> = { range: itemsRangeMock };
itemsChain.order = vi.fn(() => itemsChain);
const itemsEqStatusMock = vi.fn(() => itemsChain);
const itemsEqCampaignMock = vi.fn(() => ({ ...itemsChain, eq: itemsEqStatusMock }));
const itemsSelectMock = vi.fn(() => ({ eq: itemsEqCampaignMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "engagement_campaigns") {
    return { select: campaignSelectMock };
  }
  if (table === "workspace_members") {
    return { select: membershipSelectMock };
  }
  if (table === "engagement_categories") {
    return { select: categoriesSelectMock };
  }
  if (table === "engagement_items") {
    return { select: itemsSelectMock };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { GET } from "@/app/api/engagement/campaigns/[campaignId]/export/route";

const validCampaignId = "11111111-1111-4111-8111-111111111111";

describe("GET /api/engagement/campaigns/[campaignId]/export", () => {
  beforeEach(() => {
    // The paging fake resolves its fixture once per request; a test that set
    // a fixture would otherwise inherit the previous test's cached rows.
    itemsPageSource = null;
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: { user: { id: "22222222-2222-4222-8222-222222222222" } },
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });

    campaignMaybeSingleMock.mockResolvedValue({
      data: {
        id: validCampaignId,
        workspace_id: "44444444-4444-4444-8444-444444444444",
        project_id: null,
        title: "Test Campaign",
        status: "active",
        share_token: "pilot-link-01",
        allow_public_submissions: true,
        submissions_closed_at: null,
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: "44444444-4444-4444-8444-444444444444",
        role: "member",
      },
      error: null,
    });

    categoriesResult.mockReturnValue({
      data: [
        { id: "55555555-5555-4555-8555-555555555555", label: "Safety", slug: "safety" },
      ],
      error: null,
    });

    itemsOrderMock.mockResolvedValue({
      data: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          campaign_id: validCampaignId,
          category_id: "55555555-5555-4555-8555-555555555555",
          title: "Unsafe crossing",
          body: "Need better crosswalk markings",
          submitted_by: "Jane",
          status: "approved",
          source_type: "public",
          latitude: 39.22,
          longitude: -121.06,
          geometry: null,
          votes_count: 3,
          moderation_notes: null,
          metadata_json: {},
          created_at: "2026-03-20T12:00:00.000Z",
          updated_at: "2026-03-20T12:00:00.000Z",
        },
      ],
      error: null,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await GET(
      new NextRequest(`http://localhost/api/engagement/campaigns/${validCampaignId}/export?format=csv`),
      { params: Promise.resolve({ campaignId: validCampaignId }) }
    );

    expect(response.status).toBe(401);
  });

  /**
   * THE REFUSAL THIS ROUTE EXISTS BEHIND, AND THE ONE NOTHING WAS CHECKING.
   *
   * This file asserted 401 and never 403, so the membership branch was untested
   * by construction. Deleting `if (!access.allowed) return 403` outright left
   * all five tests green — and this endpoint hands back the whole resident
   * comment corpus: names, free-text bodies, coordinates, and moderation notes.
   * `workspace-write-role-gate-guard` cannot cover it either, because it only
   * inspects mutating verbs and this is a GET. So the read side is asserted
   * here, in both of its shapes.
   */
  it("returns 403 when the caller is not a member of the campaign's workspace", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await GET(
      new NextRequest(`http://localhost/api/engagement/campaigns/${validCampaignId}/export?format=csv`),
      { params: Promise.resolve({ campaignId: validCampaignId }) }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
    // Nothing about the corpus may reach a refused caller — not even its size.
    expect(itemsSelectMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a role the matrix does not grant engagement.read (deny-by-default)", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: { workspace_id: "44444444-4444-4444-8444-444444444444", role: "auditor" },
      error: null,
    });

    const response = await GET(
      new NextRequest(`http://localhost/api/engagement/campaigns/${validCampaignId}/export?format=csv`),
      { params: Promise.resolve({ campaignId: validCampaignId }) }
    );

    expect(response.status).toBe(403);
    expect(itemsSelectMock).not.toHaveBeenCalled();
  });

  /**
   * And which campaign's comments come back. The item query is the only thing
   * standing between one campaign's export and every campaign in the database;
   * swapping `.eq("campaign_id", …)` for `.eq("status", "approved")` survived
   * this file and four siblings, because the mocked chain answers its canned
   * rows whatever it was filtered on.
   */
  it("asks the database only for the requested campaign's items", async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/engagement/campaigns/${validCampaignId}/export?format=csv`),
      { params: Promise.resolve({ campaignId: validCampaignId }) }
    );

    expect(response.status).toBe(200);
    expect(itemsEqCampaignMock).toHaveBeenCalledWith("campaign_id", validCampaignId);
    expect(categoriesEqMock).toHaveBeenCalledWith("campaign_id", validCampaignId);
  });

  it("returns CSV export with correct content type", async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/engagement/campaigns/${validCampaignId}/export?format=csv`),
      { params: Promise.resolve({ campaignId: validCampaignId }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");

    const csvText = await response.text();
    expect(csvText).toContain("id,title,body");
    expect(csvText).toContain("Unsafe crossing");
    expect(csvText).toContain("Safety");
  });

  /**
   * CSV formula injection: the body/title/submitted_by cells are resident-
   * authored free text, and a cell opening with `=` `+` `-` `@` runs as a
   * formula on the planner's own machine when they open their own export.
   * The shared escaping layer prefixes a quote; the coordinate columns are
   * machine numbers and must stay bare so the file stays computable.
   */
  it("neutralizes resident text a spreadsheet would execute, leaving numeric columns computable", async () => {
    itemsOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          campaign_id: validCampaignId,
          category_id: "55555555-5555-4555-8555-555555555555",
          title: "@SUM(1+9)",
          body: '=HYPERLINK("http://evil.example","click me")',
          submitted_by: "+1 530 555 0100",
          status: "approved",
          source_type: "public",
          latitude: 39.22,
          longitude: -121.06,
          geometry: null,
          votes_count: 3,
          moderation_notes: "-note that starts with a hyphen",
          metadata_json: {},
          created_at: "2026-03-20T12:00:00.000Z",
          updated_at: "2026-03-20T12:00:00.000Z",
        },
      ],
      error: null,
    });

    const response = await GET(
      new NextRequest(`http://localhost/api/engagement/campaigns/${validCampaignId}/export?format=csv`),
      { params: Promise.resolve({ campaignId: validCampaignId }) }
    );

    expect(response.status).toBe(200);
    const csvText = await response.text();

    expect(csvText).toContain("'@SUM(1+9)");
    expect(csvText).toContain("\"'=HYPERLINK");
    expect(csvText).toContain("'+1 530 555 0100");
    expect(csvText).toContain("'-note that starts with a hyphen");
    // No cell anywhere opens with a live formula character.
    expect(csvText).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(csvText).not.toMatch(/(^|,)@SUM/m);
    // The machine-written coordinates stay bare numbers.
    expect(csvText).toContain(",39.22,-121.06,");
  });

  it("returns JSON export when format=json", async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/engagement/campaigns/${validCampaignId}/export?format=json`),
      { params: Promise.resolve({ campaignId: validCampaignId }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const json = JSON.parse(await response.text());
    expect(json.campaign.id).toBe(validCampaignId);
    expect(json.campaign.publicPortal).toMatchObject({
      label: "Live · accepting submissions",
      portalPath: "/engage/pilot-link-01",
      isPubliclyReachable: true,
      isAcceptingSubmissions: true,
    });
    expect(json.items).toHaveLength(1);
    expect(json.items[0].categoryLabel).toBe("Safety");
    // Internal submission tracking (IP fingerprint / user-agent / referer) must
    // not travel into a downloadable export an agency may share onward.
    expect(json.items[0]).not.toHaveProperty("metadata_json");
    expect(json.meta.handoffReadiness).toMatchObject({
      readyForHandoffCount: 1,
      actionableCount: 0,
      uncategorizedItems: 0,
      appendixReadyCount: 1,
      duplicateReviewCount: 0,
      publicApprovedCategorizedCount: 1,
      nonPublicApprovedCategorizedCount: 0,
    });
    expect(json.meta.commentMatrixPreview).toMatchObject({
      caveat: expect.stringMatching(/staff cue only/i),
      counts: {
        includedCount: 1,
        heldDuplicateReviewCount: 0,
        excludedInternalPrivateCount: 0,
        excludedNotReadyCount: 0,
        previewedRowCount: 1,
        totalItemCount: 1,
      },
      rows: [
        expect.objectContaining({
          itemId: "66666666-6666-4666-8666-666666666666",
          posture: "included",
          postureLabel: "Included in matrix preview",
          categoryLabel: "Safety",
        }),
      ],
    });
  });

  /**
   * A CAMPAIGN LARGER THAN ONE PAGE.
   *
   * PostgREST caps a response at `max_rows` — 1000 on this deployment — and
   * reports no error while doing it, so the single unpaged read this route used
   * handed back at most 1000 items and the file presented them as the whole
   * campaign. A planner attaches that file to a funder submission; the missing
   * residents are invisible on every screen.
   *
   * The fixture is deliberately larger than both the page size and the server
   * cap, so a route that reads one page fails here rather than in a submission.
   */
  it("exports every comment when the campaign holds more than one page of them", async () => {
    const many = Array.from({ length: 1200 }, (_, index) => ({
      id: `aaaaaaa1-0000-4000-8000-${String(index).padStart(12, "0")}`,
      campaign_id: validCampaignId,
      category_id: null,
      title: `Comment ${index}`,
      body: "b",
      submitted_by: null,
      status: "approved",
      source_type: "public",
      latitude: null,
      longitude: null,
      geometry: null,
      votes_count: 0,
      moderation_notes: null,
      metadata_json: {},
      created_at: "2026-03-20T12:00:00.000Z",
      updated_at: "2026-03-20T12:00:00.000Z",
    }));
    itemsOrderMock.mockResolvedValueOnce({ data: many, error: null });

    const response = await GET(
      new NextRequest(`http://localhost/api/engagement/campaigns/${validCampaignId}/export?format=csv`),
      { params: Promise.resolve({ campaignId: validCampaignId }) }
    );

    expect(response.status).toBe(200);
    const csv = await response.text();
    // One header row plus every comment — 1200, not the 500 of a single page.
    const dataRows = csv.trimEnd().split("\n").length - 1;
    expect(dataRows).toBe(1200);
    expect(csv).toContain("Comment 1199");

    // It asked more than once, each request starting where the last ended.
    expect(itemsRangeMock.mock.calls.length).toBeGreaterThan(1);
    const [firstFrom, firstTo] = itemsRangeMock.mock.calls[0];
    expect(itemsRangeMock.mock.calls[1][0]).toBe(firstTo + 1);
    expect(firstFrom).toBe(0);
  });

  it("returns a GeoJSON FeatureCollection (WGS84) that GIS tools import", async () => {
    itemsOrderMock.mockResolvedValueOnce({
      data: [
        // point synthesized from lat/lng (no stored geometry)
        { id: "aaaaaaa1-0000-4000-8000-000000000001", campaign_id: validCampaignId, category_id: "55555555-5555-4555-8555-555555555555", title: "Point item", body: "b1", submitted_by: "Jane", status: "approved", source_type: "public", latitude: 39.22, longitude: -121.06, geometry: null, votes_count: 4, moderation_notes: "internal note", metadata_json: {}, created_at: "2026-03-20T12:00:00.000Z", updated_at: "2026-03-20T12:00:00.000Z" },
        // stored LineString geometry passes through
        { id: "aaaaaaa1-0000-4000-8000-000000000002", campaign_id: validCampaignId, category_id: null, title: "Line item", body: "b2", submitted_by: null, status: "approved", source_type: "public", latitude: 39.2, longitude: -121.05, geometry: { type: "LineString", coordinates: [[-121.06, 39.2], [-121.04, 39.24]] }, votes_count: 0, moderation_notes: null, metadata_json: {}, created_at: "2026-03-20T12:00:00.000Z", updated_at: "2026-03-20T12:00:00.000Z" },
        // no location → skipped, not emitted as a feature
        { id: "aaaaaaa1-0000-4000-8000-000000000003", campaign_id: validCampaignId, category_id: null, title: "No location", body: "b3", submitted_by: null, status: "approved", source_type: "public", latitude: null, longitude: null, geometry: null, votes_count: 1, moderation_notes: null, metadata_json: {}, created_at: "2026-03-20T12:00:00.000Z", updated_at: "2026-03-20T12:00:00.000Z" },
      ],
      error: null,
    });

    const response = await GET(
      new NextRequest(`http://localhost/api/engagement/campaigns/${validCampaignId}/export?format=geojson`),
      { params: Promise.resolve({ campaignId: validCampaignId }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/geo+json");
    expect(response.headers.get("content-disposition")).toContain(".geojson");

    const fc = JSON.parse(await response.text());
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(2); // the no-location item is skipped

    const point = fc.features[0];
    expect(point.geometry).toEqual({ type: "Point", coordinates: [-121.06, 39.22] }); // [lng, lat]
    expect(point.properties).toMatchObject({ id: "aaaaaaa1-0000-4000-8000-000000000001", category_label: "Safety", votes_count: 4 });
    expect(point.properties).not.toHaveProperty("moderation_notes"); // internal note excluded from a portable file

    expect(fc.features[1].geometry.type).toBe("LineString");
  });

  it("rejects unsupported format", async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/engagement/campaigns/${validCampaignId}/export?format=xml`),
      { params: Promise.resolve({ campaignId: validCampaignId }) }
    );

    expect(response.status).toBe(400);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pagingFake } from "./helpers/paging-fake";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const campaignMaybeSingleMock = vi.fn();
const campaignEqMock = vi.fn(() => ({ maybeSingle: campaignMaybeSingleMock }));
// The UPDATE now reads back the row it changed (`.select("id").maybeSingle()`),
// so it can tell "changed nothing" from "failed" instead of answering
// `{ success: true }` over a write the database may have refused.
const campaignUpdateMaybeSingleMock = vi.fn().mockResolvedValue({
  data: { id: "11111111-1111-4111-8111-111111111111" },
  error: null,
});
const campaignUpdateSelectMock = vi.fn(() => ({ maybeSingle: campaignUpdateMaybeSingleMock }));
const campaignUpdateEqMock = vi.fn(() => ({ select: campaignUpdateSelectMock }));
const campaignUpdateMock = vi.fn(() => ({ eq: campaignUpdateEqMock }));

// The campaign's own place columns (20260729000003), read by
// `loadPortalPlaceCandidates` on the GET path.
const campaignPlaceMaybeSingleMock = vi.fn();
const workspaceMaybeSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectPlaceMaybeSingleMock = vi.fn();

/**
 * Two different reads hit each of these tables now — the access/detail read and
 * the place-of-record read behind the public map's framing — so the fake client
 * routes on the SELECT string rather than pretending one row shape serves both.
 * That is also what lets the tests below assert which columns were asked for,
 * which is the seam a missing column would break silently.
 */
const selectsPlaceColumns = (columns: string) => columns.includes("place_source");

/**
 * A THIRD read of `engagement_campaigns`: the submission location check
 * (20260730000002), on the GET path as the console's current state and on the
 * PATCH path as half of the precondition. Both projections name the flag, and
 * neither names `place_source`, so one discriminator and one row serve both.
 *
 * It is a separate read in the route for the same reason the campaign console
 * splits `default_content_locale`: welding a brand-new column onto
 * `loadCampaignAccess` would 404 the whole engagement module in the window
 * between a deploy and its migration.
 */
const selectsSubmissionGeofence = (columns: string) => columns.includes("submission_geofence_enabled");

const campaignGeofenceMaybeSingleMock = vi.fn();

const campaignSelectMock = vi.fn((columns: string) => {
  if (selectsSubmissionGeofence(columns)) {
    return { eq: () => ({ maybeSingle: campaignGeofenceMaybeSingleMock }) };
  }
  return selectsPlaceColumns(columns)
    ? { eq: () => ({ maybeSingle: campaignPlaceMaybeSingleMock }) }
    : { eq: campaignEqMock };
});

const projectSelectMock = vi.fn((columns: string) =>
  selectsPlaceColumns(columns)
    ? { eq: () => ({ maybeSingle: projectPlaceMaybeSingleMock }) }
    : { eq: projectEqMock }
);

const categoriesOrderCreatedMock = vi.fn();
const categoriesOrderSortMock = vi.fn(() => ({ order: categoriesOrderCreatedMock }));
const categoriesEqCampaignMock = vi.fn(() => ({ order: categoriesOrderSortMock }));

const itemsOrderMock = vi.fn();
const itemsPaging = pagingFake(() => itemsOrderMock());
const itemsEqCampaignMock = vi.fn(() => itemsPaging.chain);
const reportsOrderMock = vi.fn();
const reportsEqProjectMock = vi.fn(() => ({ order: reportsOrderMock }));

// The covered-project set (20260810000003), read by GET so the console can
// show and edit which projects this campaign covers. Empty by default; the
// dedicated join-maintenance tests live in
// engagement-campaign-project-links-route.test.ts.
const campaignProjectsEqMock = vi.fn();

/**
 * The workspace's RTP cycles and chapters (the campaign console's attachment
 * options), read by GET and — on PATCH, per targeted id — verified against
 * their workspace. The eq mocks RECORD the filter so the tests below can
 * assert the list is scoped to the campaign's workspace rather than to
 * whatever RLS happens to return.
 */
const rtpCyclesOrderMock = vi.fn();
const rtpCyclesEqMock = vi.fn((_column: string, _value: unknown) => ({
  order: rtpCyclesOrderMock,
  maybeSingle: rtpCycleMaybeSingleMock,
}));
const rtpCycleMaybeSingleMock = vi.fn();
const rtpChaptersOrderMock = vi.fn();
const rtpChapterMaybeSingleMock = vi.fn();
const rtpChaptersEqMock = vi.fn((_column: string, _value: unknown) => ({
  order: rtpChaptersOrderMock,
  maybeSingle: rtpChapterMaybeSingleMock,
}));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

/**
 * Everything this route handed to the audit logger, flattened. Share tokens are
 * the sole credential protecting a public engagement portal, so the token-value
 * assertions below search the whole audit surface rather than one call site.
 */
function auditPayloads(): string {
  return JSON.stringify([
    mockAudit.info.mock.calls,
    mockAudit.warn.mock.calls,
    mockAudit.error.mock.calls,
  ]);
}

const fromMock = vi.fn((table: string) => {
  if (table === "engagement_campaigns") {
    return {
      select: campaignSelectMock,
      update: campaignUpdateMock,
    };
  }

  if (table === "workspace_members") {
    return {
      select: membershipSelectMock,
    };
  }

  if (table === "projects") {
    return {
      select: projectSelectMock,
    };
  }

  if (table === "engagement_categories") {
    return {
      select: () => ({ eq: categoriesEqCampaignMock }),
    };
  }

  if (table === "engagement_items") {
    return {
      select: () => ({ eq: itemsEqCampaignMock }),
    };
  }

  if (table === "reports") {
    return {
      select: () => ({ eq: reportsEqProjectMock }),
    };
  }

  if (table === "workspaces") {
    return {
      select: workspaceSelectMock,
    };
  }

  if (table === "rtp_cycles") {
    return {
      select: () => ({ eq: rtpCyclesEqMock }),
    };
  }

  if (table === "rtp_cycle_chapters") {
    return {
      select: () => ({ eq: rtpChaptersEqMock }),
    };
  }

  if (table === "engagement_campaign_projects") {
    return {
      select: () => ({ eq: campaignProjectsEqMock }),
    };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

// A searched campaign area is stored from the boundary the SERVER re-resolves,
// never from anything the caller sent, so the resolver is the seam under test.
const resolvePlaceBoundaryMock = vi.fn();
vi.mock("@/lib/geographies/place-resolver", () => ({
  resolvePlaceBoundary: (...args: unknown[]) => resolvePlaceBoundaryMock(...args),
}));

import { GET as getCampaignDetail, PATCH as patchCampaignDetail } from "@/app/api/engagement/campaigns/[campaignId]/route";

describe("/api/engagement/campaigns/[campaignId]", () => {
  beforeEach(() => {
    // The paging fake caches its fixture per request; clear it per test.
    itemsPaging.reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      },
    });

    campaignMaybeSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: "44444444-4444-4444-8444-444444444444",
        title: "Downtown listening campaign",
        status: "draft",
        engagement_type: "comment_collection",
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: "33333333-3333-4333-8333-333333333333",
        role: "member",
      },
      error: null,
    });

    projectMaybeSingleMock.mockResolvedValue({
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Downtown safety project",
      },
      error: null,
    });

    // No campaign area of its own; the project states one; the workspace does
    // not. That is the ordinary shape, and it is what makes the precedence
    // observable at the route.
    campaignPlaceMaybeSingleMock.mockResolvedValue({ data: {}, error: null });
    // Off, with no campaign area behind it — the state every campaign is in
    // before an operator asks for anything else.
    campaignGeofenceMaybeSingleMock.mockResolvedValue({
      data: {
        submission_geofence_enabled: false,
        place_min_lon: null,
        place_min_lat: null,
        place_max_lon: null,
        place_max_lat: null,
      },
      error: null,
    });
    projectPlaceMaybeSingleMock.mockResolvedValue({
      data: {
        place_source: "tigerweb",
        place_label: "Franklin County, Ohio",
        place_min_lon: -83.2,
        place_min_lat: 39.85,
        place_max_lon: -82.8,
        place_max_lat: 40.1,
      },
      error: null,
    });
    workspaceMaybeSingleMock.mockResolvedValue({ data: {}, error: null });

    // Two cycles in the campaign's workspace, one with a chapter — enough to
    // observe grouping without describing a shape the product cannot produce.
    rtpCyclesOrderMock.mockResolvedValue({
      data: [
        { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "2050 Regional Transportation Plan", status: "draft" },
        { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "2045 Regional Transportation Plan", status: "adopted" },
      ],
      error: null,
    });
    rtpChaptersOrderMock.mockResolvedValue({
      data: [
        { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "Financial element", rtp_cycle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      ],
      error: null,
    });
    rtpCycleMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    rtpChapterMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    // No coverage rows by default; GET reports an empty covered set.
    campaignProjectsEqMock.mockResolvedValue({ data: [], error: null });

    resolvePlaceBoundaryMock.mockResolvedValue({
      kind: "county",
      geoid: "39049",
      label: "Franklin County, Ohio",
      geojson: { type: "Polygon", coordinates: [[[-83.2, 39.85], [-82.8, 39.85], [-82.8, 40.1], [-83.2, 40.1], [-83.2, 39.85]]] },
      bbox: { minLon: -83.2, minLat: 39.85, maxLon: -82.8, maxLat: 40.1 },
    });

    categoriesOrderCreatedMock.mockResolvedValue({
      data: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          campaign_id: "11111111-1111-4111-8111-111111111111",
          label: "Safety",
          description: "Crossings and speeding",
        },
      ],
      error: null,
    });

    itemsOrderMock.mockResolvedValue({
      data: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          campaign_id: "11111111-1111-4111-8111-111111111111",
          category_id: "55555555-5555-4555-8555-555555555555",
          title: "Crossing issue",
          body: "Drivers roll the stop line at school pickup.",
          status: "flagged",
          source_type: "meeting",
          latitude: 34.1,
          longitude: -118.3,
          moderation_notes: "Needs follow-up",
          updated_at: "2026-03-14T16:00:00.000Z",
        },
        {
          id: "77777777-7777-4777-8777-777777777777",
          campaign_id: "11111111-1111-4111-8111-111111111111",
          category_id: null,
          title: "Need shade",
          body: "Waiting area is exposed.",
          status: "approved",
          source_type: "public",
          latitude: null,
          longitude: null,
          moderation_notes: null,
          updated_at: "2026-03-01T16:00:00.000Z",
        },
      ],
      error: null,
    });

    reportsOrderMock.mockResolvedValue({
      data: [
        {
          id: "88888888-8888-4888-8888-888888888888",
          project_id: "44444444-4444-4444-8444-444444444444",
          title: "Downtown Safety Packet",
          report_type: "project_status",
          status: "generated",
          generated_at: "2026-03-13T16:00:00.000Z",
          updated_at: "2026-03-13T16:05:00.000Z",
        },
      ],
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("GET returns campaign detail with categories and moderation counts", async () => {
    const response = await getCampaignDetail(new NextRequest("http://localhost/api/engagement/campaigns/1"), {
      params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      campaign: {
        id: "11111111-1111-4111-8111-111111111111",
      },
      project: {
        id: "44444444-4444-4444-8444-444444444444",
      },
      categories: expect.arrayContaining([expect.objectContaining({ id: "55555555-5555-4555-8555-555555555555" })]),
      recentItems: expect.arrayContaining([expect.objectContaining({ id: "66666666-6666-4666-8666-666666666666" })]),
      linkedReports: expect.arrayContaining([expect.objectContaining({ id: "88888888-8888-4888-8888-888888888888" })]),
      counts: {
        totalItems: 2,
        geolocatedItems: 1,
        nonGeolocatedItems: 1,
        categorizedItems: 1,
        uncategorizedItems: 1,
        itemsWithModerationNotes: 1,
        sourceSummaries: expect.arrayContaining([
          expect.objectContaining({ sourceType: "meeting", count: 1, geolocatedCount: 1 }),
          expect.objectContaining({ sourceType: "public", count: 1, nonGeolocatedCount: 1 }),
        ]),
        moderationQueue: expect.objectContaining({
          actionableCount: 1,
          flaggedCount: 1,
          readyForHandoffCount: 0,
        }),
        geographyCoverage: expect.objectContaining({
          geolocatedShare: 0.5,
        }),
        recentActivity: expect.objectContaining({
          count: 1,
          byStatus: expect.objectContaining({
            flagged: 1,
          }),
        }),
        statusCounts: expect.objectContaining({
          approved: 1,
          flagged: 1,
        }),
        categoryCounts: expect.arrayContaining([
          expect.objectContaining({ categoryId: "55555555-5555-4555-8555-555555555555", count: 1 }),
          expect.objectContaining({ categoryId: null, count: 1 }),
        ]),
      },
    });
  });

  it("GET succeeds for a viewer — the read-only tier reads, it does not write", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: {
        workspace_id: "33333333-3333-4333-8333-333333333333",
        role: "viewer",
      },
      error: null,
    });

    const response = await getCampaignDetail(new NextRequest("http://localhost/api/engagement/campaigns/1"), {
      params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      campaign: { id: "11111111-1111-4111-8111-111111111111" },
    });
  });

  it("PATCH returns 403 when workspace role is unsupported", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: {
        workspace_id: "33333333-3333-4333-8333-333333333333",
        role: "viewer",
      },
      error: null,
    });

    const response = await patchCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Updated campaign" }),
      }),
      {
        params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("PATCH updates campaign metadata", async () => {
    const response = await patchCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Updated campaign",
          status: "active",
          engagementType: "map_feedback",
        }),
      }),
      {
        params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    expect(campaignUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Updated campaign",
        status: "active",
        engagement_type: "map_feedback",
      })
    );
  });

  it("PATCH refuses a caller-chosen share token and names where minting lives", async () => {
    const attemptedToken = "pilot_link_2026_01";

    const response = await patchCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shareToken: attemptedToken }),
      }),
      {
        params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("/share-token"),
    });
    // Refused outright — not silently dropped from an otherwise-applied update.
    expect(campaignUpdateMock).not.toHaveBeenCalled();
    // A rejected token is still a credential: it must appear in no audit record.
    expect(auditPayloads()).not.toContain(attemptedToken);
  });

  it("PATCH disables the public link on an explicit null without logging the token", async () => {
    const liveToken = "livesharetoken0123456789abcd";
    campaignMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: "44444444-4444-4444-8444-444444444444",
        title: "Downtown listening campaign",
        status: "active",
        engagement_type: "comment_collection",
        share_token: liveToken,
      },
      error: null,
    });

    const response = await patchCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shareToken: null }),
      }),
      {
        params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    expect(campaignUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ share_token: null }));
    // The disable is auditable as a derived fact, never as a value.
    expect(mockAudit.info).toHaveBeenCalledWith(
      "campaign_updated",
      expect.objectContaining({ shareTokenDisabled: true })
    );
    expect(auditPayloads()).not.toContain(liveToken);
  });

  /**
   * The campaign's map area (20260729000003). These are the route half of the
   * reachability seam: the console can only show and change what this endpoint
   * reads and writes.
   */
  it("GET says which area frames the public map, and why", async () => {
    const response = await getCampaignDetail(new NextRequest("http://localhost/api/engagement/campaigns/1"), {
      params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      mapFraming: { origin: string; originLabel: string | null; summary: string; view: unknown };
    };

    // The campaign states no area of its own, so the linked project's wins.
    expect(body.mapFraming.origin).toBe("project_place");
    expect(body.mapFraming.originLabel).toBe("Franklin County, Ohio");
    expect(body.mapFraming.summary).toContain("Franklin County, Ohio");
    expect(body.mapFraming.view).not.toBeNull();

    // The reads behind it must name the columns the migrations create — a
    // missing one is `undefined` at runtime and silent at build.
    const placeSelects = [
      ...campaignSelectMock.mock.calls.map((call) => call[0]),
      ...projectSelectMock.mock.calls.map((call) => call[0]),
    ].filter((columns) => typeof columns === "string" && columns.includes("place_source"));
    expect(placeSelects).toHaveLength(2);
    for (const columns of placeSelects) {
      for (const column of ["place_min_lon", "place_min_lat", "place_max_lon", "place_max_lat", "place_label"]) {
        expect(columns).toContain(column);
      }
    }
    expect(workspaceSelectMock).toHaveBeenCalledWith(expect.stringContaining("home_min_lon"));
  });

  it("PATCH stores a searched campaign area from the boundary it re-resolved, not from the caller", async () => {
    const response = await patchCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        // A REFERENCE, not a bbox. A caller-supplied extent would be an
        // unverifiable geography wearing trusted-looking provenance — and this
        // one frames the map every resident is asked to draw on.
        body: JSON.stringify({ place: { mode: "place", kind: "county", geoid: "39049" } }),
      }),
      { params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }) }
    );

    expect(resolvePlaceBoundaryMock).toHaveBeenCalledWith("county", "39049");
    expect(response.status).toBe(200);
    expect(campaignUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        place_source: "tigerweb",
        place_ref: "39049",
        place_label: "Franklin County, Ohio",
        place_min_lon: -83.2,
        place_max_lat: 40.1,
      })
    );
  });

  it("PATCH refuses a place the boundary service could not resolve, rather than half-writing it", async () => {
    resolvePlaceBoundaryMock.mockResolvedValueOnce(null);

    const response = await patchCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ place: { mode: "place", kind: "county", geoid: "39049" } }),
      }),
      { params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }) }
    );

    expect(response.status).toBe(404);
    // Nothing was written: an area recorded without a verified boundary frames
    // nothing, which is the state these columns exist to end.
    expect(campaignUpdateMock).not.toHaveBeenCalled();
  });

  it("PATCH clears the campaign area on an explicit null", async () => {
    const response = await patchCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ place: null }),
      }),
      { params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }) }
    );

    expect(response.status).toBe(200);
    expect(campaignUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ place_source: null, place_ref: null, place_min_lon: null, place_set_at: null })
    );
  });

  it("PATCH reports a write that matched no rows instead of answering success", async () => {
    campaignUpdateMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await patchCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Renamed campaign" }),
      }),
      { params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }) }
    );

    // The route already read this campaign through the caller's own client and
    // passed the role gate, so zero matched rows is the database refusing what
    // the application allowed — not a missing campaign, and not a success.
    expect(response.status).not.toBe(200);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "campaign_update_matched_no_rows",
      expect.objectContaining({ campaignId: "11111111-1111-4111-8111-111111111111" })
    );
  });
  /**
   * THE LOCATION CHECK (20260730000002).
   *
   * The rule is that a check which cannot run must never be storable, and it is
   * reachable from BOTH sides — turning the flag on with no area, and clearing
   * the area under a flag that is already on. Each is refused here in a sentence
   * an operator can act on, and each is refused again by the table's own CHECK,
   * so a future writer that forgets this route still cannot store it.
   */
  it("GET reports the location check as three states, never folding a failed read into 'off'", async () => {
    campaignGeofenceMaybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'column "submission_geofence_enabled" does not exist', code: "42703" },
    });

    const response = await getCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1"),
      { params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }) }
    );
    const body = (await response.json()) as { submissionGeofence: { enabled: boolean | null } };

    // Not `false`. Telling an operator the check is off, on the strength of a
    // query that broke, is a claim about the world nobody established.
    expect(body.submissionGeofence.enabled).toBeNull();
  });

  it("GET says the check cannot be enabled when the campaign has no area of its OWN", async () => {
    // The linked project states an area and it frames the map — but the check
    // never runs against it, so offering the control here would refuse
    // residents against a boundary nobody chose for this consultation.
    const response = await getCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1"),
      { params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }) }
    );
    const body = (await response.json()) as {
      submissionGeofence: { enabled: boolean | null; canEnable: boolean; areaState: string };
      mapFraming: { origin: string };
    };

    expect(body.mapFraming.origin).toBe("project_place");
    expect(body.submissionGeofence).toMatchObject({ enabled: false, canEnable: false, areaState: "unset" });
  });

  it("PATCH refuses to turn the location check on for a campaign with no area", async () => {
    const response = await patchCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionGeofenceEnabled: true }),
      }),
      { params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }) }
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/no area on record/i);
    expect(campaignUpdateMock).not.toHaveBeenCalled();
  });

  it("PATCH turns the check on when an area exists, writing the flag and nothing else", async () => {
    campaignGeofenceMaybeSingleMock.mockResolvedValue({
      data: {
        submission_geofence_enabled: false,
        place_min_lon: -83.2,
        place_min_lat: 39.85,
        place_max_lon: -82.8,
        place_max_lat: 40.1,
      },
      error: null,
    });

    const response = await patchCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionGeofenceEnabled: true }),
      }),
      { params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }) }
    );

    expect(response.status).toBe(200);
    expect(campaignUpdateMock).toHaveBeenCalledWith({ submission_geofence_enabled: true });
  });

  it("PATCH sets an area and the check together, without needing two round trips", async () => {
    const response = await patchCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          place: { mode: "place", kind: "county", geoid: "39049" },
          submissionGeofenceEnabled: true,
        }),
      }),
      { params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }) }
    );

    expect(response.status).toBe(200);
    // The area arriving in the SAME request is what satisfies the precondition;
    // reading the stored row would have found none and refused a valid edit.
    expect(campaignUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ submission_geofence_enabled: true, place_ref: "39049" })
    );
  });

  it("PATCH refuses to clear the area out from under a live location check", async () => {
    campaignGeofenceMaybeSingleMock.mockResolvedValue({
      data: {
        submission_geofence_enabled: true,
        place_min_lon: -83.2,
        place_min_lat: 39.85,
        place_max_lon: -82.8,
        place_max_lat: 40.1,
      },
      error: null,
    });

    const response = await patchCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ place: null }),
      }),
      { params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }) }
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/clearing the area/i);
    expect(campaignUpdateMock).not.toHaveBeenCalled();
  });

  it("PATCH allows clearing the area when the same request turns the check off", async () => {
    campaignGeofenceMaybeSingleMock.mockResolvedValue({
      data: {
        submission_geofence_enabled: true,
        place_min_lon: -83.2,
        place_min_lat: 39.85,
        place_max_lon: -82.8,
        place_max_lat: 40.1,
      },
      error: null,
    });

    const response = await patchCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ place: null, submissionGeofenceEnabled: false }),
      }),
      { params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }) }
    );

    expect(response.status).toBe(200);
    expect(campaignUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ place_source: null, submission_geofence_enabled: false })
    );
  });

  it("PATCH fails closed when it cannot read the campaign's current area", async () => {
    campaignGeofenceMaybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: "statement timeout", code: "57014" },
    });

    const response = await patchCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionGeofenceEnabled: true }),
      }),
      { params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }) }
    );

    // Writing either half without knowing the other could store a check with
    // nothing behind it, or trip the table CHECK as an unexplained failure.
    expect(response.status).toBe(500);
    expect(campaignUpdateMock).not.toHaveBeenCalled();
  });

  it("PATCH that touches neither the area nor the check reads nothing extra", async () => {
    await patchCampaignDetail(
      new NextRequest("http://localhost/api/engagement/campaigns/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Renamed campaign" }),
      }),
      { params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }) }
    );

    expect(campaignGeofenceMaybeSingleMock).not.toHaveBeenCalled();
  });

  /**
   * The RTP attachment options (the campaign side of the RTP↔engagement seam).
   * `rtp_cycle_id` was writable through this PATCH long before anything on the
   * campaign console could read what to write — the classic shipped-invisible
   * shape. These prove the GET now serves the options the console's selects
   * render, scoped to the campaign's workspace, and that a failed cycle read
   * arrives as "unknown" rather than as a workspace with no plans.
   */
  describe("the RTP attachment options", () => {
    it("GET lists the workspace's cycles with their chapters grouped under them", async () => {
      const response = await getCampaignDetail(new NextRequest("http://localhost/api/engagement/campaigns/1"), {
        params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        rtpTargets: { cycles: Array<{ id: string; title: string; chapters: Array<{ id: string; title: string }> }> } | null;
      };

      expect(body.rtpTargets).not.toBeNull();
      expect(body.rtpTargets?.cycles).toEqual([
        expect.objectContaining({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "2050 Regional Transportation Plan",
          chapters: [expect.objectContaining({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "Financial element" })],
        }),
        expect.objectContaining({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          title: "2045 Regional Transportation Plan",
          chapters: [],
        }),
      ]);

      // Scoped to the CAMPAIGN's workspace — the same scope the PATCH verifies
      // a chosen id against, so the options and the enforcement cannot drift.
      expect(rtpCyclesEqMock).toHaveBeenCalledWith("workspace_id", "33333333-3333-4333-8333-333333333333");
      expect(rtpChaptersEqMock).toHaveBeenCalledWith("workspace_id", "33333333-3333-4333-8333-333333333333");
    });

    it("GET answers null — not an empty list — when the cycle read fails", async () => {
      rtpCyclesOrderMock.mockResolvedValueOnce({ data: null, error: { message: "statement timeout" } });

      const response = await getCampaignDetail(new NextRequest("http://localhost/api/engagement/campaigns/1"), {
        params: Promise.resolve({ campaignId: "11111111-1111-4111-8111-111111111111" }),
      });

      // The rest of the campaign GET still answers; only the options degrade.
      expect(response.status).toBe(200);
      const body = (await response.json()) as { rtpTargets: unknown };
      expect(body.rtpTargets).toBeNull();
    });
  });
});

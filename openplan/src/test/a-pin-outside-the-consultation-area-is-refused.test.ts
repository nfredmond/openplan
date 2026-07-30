import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * THE PUBLIC SUBMIT ROUTE, WITH A CAMPAIGN THAT HAS AN AREA.
 *
 * Until 20260730000002 this route validated a participant's coordinate against
 * the whole planet and nothing else, so a comment about a corridor study could
 * be pinned in another hemisphere and enter the record as ordinary
 * participation. These tests are about the four things that had to be true at
 * once for the fix to be worth having:
 *
 *   1. a campaign that did NOT opt in behaves exactly as it did before — down to
 *      not even reading the flag when there is no pin to check;
 *   2. a campaign that DID opt in refuses an outside pin, in a sentence a member
 *      of the public can act on;
 *   3. a comment with no pin is never refused, because it has no location to be
 *      outside of;
 *   4. every failure of ours accepts the comment rather than silencing someone.
 *
 * And the fifth, which is the defect class this repository keeps shipping: the
 * route is asserted to ASK the database for the columns it acts on. The mocks
 * below answer with a fixture whatever was projected, so a select string missing
 * `submission_geofence_enabled` would pass every other assertion in this file.
 */

const createServiceRoleClientMock = vi.fn();

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";

/** Every `.select()` string this route sends to `engagement_campaigns`. */
let campaignSelects: string[] = [];

type CampaignRow = Record<string, unknown> | null;

let publicCampaignRow: CampaignRow;
let geofenceScopeRow: CampaignRow;
let geofenceScopeError: { message: string; code?: string } | null;
let boundaryRow: CampaignRow;
let boundaryError: { message: string; code?: string } | null;

const insertedRows: Array<Record<string, unknown>> = [];

const itemSingleMock = vi.fn(async () => ({
  data: { id: "22222222-2222-4222-8222-222222222222", created_at: "2026-07-30T12:00:00.000Z" },
  error: null,
}));

const campaignFrom = () => ({
  select: (columns: string) => {
    campaignSelects.push(columns);

    // The public gate: share_token + status. Two filters, then the row.
    if (columns.includes("allow_public_submissions")) {
      return { eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: publicCampaignRow, error: null }) }) }) };
    }

    // The boundary refinement — deliberately its own query so the polygon is
    // never dragged out of Postgres for a campaign that did not opt in.
    if (columns.trim() === "place_geometry_geojson") {
      return { eq: () => ({ maybeSingle: async () => ({ data: boundaryRow, error: boundaryError }) }) };
    }

    // The flag plus the campaign's extent.
    return { eq: () => ({ maybeSingle: async () => ({ data: geofenceScopeRow, error: geofenceScopeError }) }) };
  },
});

const itemsFrom = () => ({
  select: () => ({
    eq: () => ({
      eq: () => ({
        gte: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
      }),
    }),
  }),
  insert: (row: Record<string, unknown>) => {
    insertedRows.push(row);
    return { select: () => ({ single: itemSingleMock }) };
  },
});

const fromMock = vi.fn((table: string) => {
  if (table === "engagement_campaigns") return campaignFrom();
  if (table === "engagement_items") return itemsFrom();
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/notifications/engagement", () => ({
  recordOperatorNotification: vi.fn(async () => {}),
}));

import { POST } from "@/app/api/engage/[shareToken]/submit/route";
import { OUTSIDE_CAMPAIGN_AREA_REASON } from "@/lib/engagement/geofence";

/** A two-degree square with a matching bbox. No real place, deliberately. */
const AREA_GEOMETRY = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ],
  ],
};

const AREA_BBOX = {
  place_min_lon: 0,
  place_min_lat: 0,
  place_max_lon: 2,
  place_max_lat: 2,
};

function submit(payload: unknown) {
  return POST(
    new NextRequest("http://localhost/api/engage/test-share-token-12345/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Vitest Geofence",
        "x-forwarded-for": "203.0.113.44",
      },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ shareToken: "test-share-token-12345" }) }
  );
}

/** Inside the square. */
const INSIDE = { latitude: 1, longitude: 1 };
/** Another hemisphere entirely. */
const FAR_AWAY = { latitude: -33.87, longitude: 151.2 };

describe("a campaign that never asked for a location rule is untouched", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    campaignSelects = [];
    insertedRows.length = 0;
    createServiceRoleClientMock.mockReturnValue({ from: fromMock, storage: { from: vi.fn() } });
    publicCampaignRow = {
      id: CAMPAIGN_ID,
      workspace_id: "workspace-1",
      title: "Corridor study",
      status: "active",
      allow_public_submissions: true,
      submissions_closed_at: null,
      demographics_enabled: false,
    };
    geofenceScopeRow = { submission_geofence_enabled: false, ...AREA_BBOX, place_label: "The corridor" };
    geofenceScopeError = null;
    boundaryRow = { place_geometry_geojson: AREA_GEOMETRY };
    boundaryError = null;
  });

  it("accepts a pin on the other side of the planet, exactly as it did before", async () => {
    const response = await submit({ body: "The crossing here is dangerous.", ...FAR_AWAY });

    expect(response.status).toBe(201);
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].latitude).toBe(FAR_AWAY.latitude);
  });

  it("never fetches the boundary polygon for a campaign that did not opt in", async () => {
    await submit({ body: "The crossing here is dangerous.", ...FAR_AWAY });

    // A county boundary can be megabytes. It must not be read on the strength of
    // a flag that is off.
    expect(campaignSelects.some((columns) => columns.trim() === "place_geometry_geojson")).toBe(false);
  });

  it("does not even ask about the rule when the comment carries no location", async () => {
    await submit({ body: "Please publish the draft plan as a PDF." });

    // One query: the public gate. Nothing to check means nothing to read, so a
    // text-only comment costs exactly what it always did.
    expect(campaignSelects).toHaveLength(1);
    expect(campaignSelects[0]).toContain("allow_public_submissions");
  });
});

describe("a campaign that opted in refuses a pin outside its area", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    campaignSelects = [];
    insertedRows.length = 0;
    createServiceRoleClientMock.mockReturnValue({ from: fromMock, storage: { from: vi.fn() } });
    publicCampaignRow = {
      id: CAMPAIGN_ID,
      workspace_id: "workspace-1",
      title: "Corridor study",
      status: "active",
      allow_public_submissions: true,
      submissions_closed_at: null,
      demographics_enabled: false,
    };
    geofenceScopeRow = {
      submission_geofence_enabled: true,
      ...AREA_BBOX,
      place_label: "the Broad Street corridor",
    };
    geofenceScopeError = null;
    boundaryRow = { place_geometry_geojson: AREA_GEOMETRY };
    boundaryError = null;
  });

  it("asks the database for the columns the check acts on", () => {
    // Not a behavioural assertion — a projection one. Every other test in this
    // file passes with a select string that forgot the flag, because the mock
    // returns the fixture whatever was projected. This is the assertion that
    // does not.
    return submit({ body: "Fix this crossing.", ...INSIDE }).then(() => {
      const scopeSelect = campaignSelects.find((columns) => columns.includes("submission_geofence_enabled"));

      expect(scopeSelect, "the route must project the opt-in flag").toBeDefined();
      for (const column of ["place_min_lon", "place_min_lat", "place_max_lon", "place_max_lat", "place_label"]) {
        expect(scopeSelect, `the check reads ${column} and must select it`).toContain(column);
      }

      // And the polygon is fetched separately, never in the same breath as the
      // scope columns — that separation is what keeps it off the common path.
      expect(scopeSelect).not.toContain("place_geometry_geojson");
      expect(campaignSelects.some((columns) => columns.trim() === "place_geometry_geojson")).toBe(true);
    });
  });

  it("turns a far-away pin away with a sentence a resident can act on", async () => {
    const response = await submit({ body: "This roundabout is terrible.", ...FAR_AWAY });
    const body = (await response.json()) as { error: string; reason: string };

    expect(response.status).toBe(422);
    expect(body.reason).toBe(OUTSIDE_CAMPAIGN_AREA_REASON);
    expect(body.error).toContain("the Broad Street corridor");
    expect(body.error).toMatch(/without a location/i);
    // Not "invalid coordinates" — the coordinate is perfectly valid, it is
    // somewhere else — and not a bare status code.
    expect(body.error).not.toMatch(/invalid/i);

    expect(insertedRows).toHaveLength(0);
  });

  it("refuses a pin inside the bounding box but outside the boundary itself", async () => {
    // The bbox is the square; the recorded boundary is only its western half.
    boundaryRow = {
      place_geometry_geojson: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 2],
            [0, 2],
            [0, 0],
          ],
        ],
      },
    };

    const response = await submit({ body: "Add a crossing here.", latitude: 1, longitude: 1.5 });

    expect(response.status).toBe(422);
    expect(insertedRows).toHaveLength(0);
  });

  it("accepts a pin inside the area", async () => {
    const response = await submit({ body: "Add a crossing here.", ...INSIDE });

    expect(response.status).toBe(201);
    expect(insertedRows).toHaveLength(1);
  });

  it("accepts a comment with no pin at all — it has no location to be outside of", async () => {
    const response = await submit({ body: "I could not use the map, but the plan needs more shade." });

    expect(response.status).toBe(201);
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].latitude).toBeNull();

    // And it is never even TESTED. Asserting only the 201 would still pass a
    // route that substituted a default coordinate and got lucky about where the
    // area happens to be; this asserts the check was not reached at all.
    expect(campaignSelects).toHaveLength(1);
    expect(campaignSelects[0]).toContain("allow_public_submissions");
  });

  /**
   * THE BYPASS. `engagement_items.latitude/longitude` is the vertex CENTROID of
   * a drawn shape, and this ring's centroid is (1, 1) — the exact middle of the
   * campaign's area — while every corner of it is in a different hemisphere.
   * A check that tested the stored representative point alone would accept this
   * and then draw it on the operator's map.
   */
  it("refuses an area drawn AROUND the campaign, whose centroid lands inside it", async () => {
    const response = await submit({
      body: "The whole world should be consulted about this crossing.",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-60, -60],
            [62, -60],
            [62, 62],
            [-60, 62],
            [-60, -60],
          ],
        ],
      },
    });

    expect(response.status).toBe(422);
    expect(insertedRows).toHaveLength(0);
  });

  it("accepts a shape drawn wholly inside the area", async () => {
    const response = await submit({
      body: "This block floods.",
      geometry: {
        type: "LineString",
        coordinates: [
          [0.5, 0.5],
          [1.5, 1.5],
        ],
      },
    });

    expect(response.status).toBe(201);
    expect(insertedRows).toHaveLength(1);
  });

  it("refuses a line with one end outside, even though its middle is inside", async () => {
    // The midpoint — the ONLY thing stored in latitude/longitude — is (2, 1),
    // on the area's own eastern edge and therefore inside it. The eastern end is
    // not. A centroid-only check accepts this line; the rule the operator was
    // shown does not.
    const response = await submit({
      body: "This route is unsafe.",
      geometry: {
        type: "LineString",
        coordinates: [
          [0.1, 1],
          [3.9, 1],
        ],
      },
    });

    expect(response.status).toBe(422);
    expect(insertedRows).toHaveLength(0);
  });

  it("checks the drawn geometry's representative point, not just a bare lat/lng pair", async () => {
    const response = await submit({
      body: "This whole block floods.",
      geometry: {
        type: "LineString",
        coordinates: [
          [151.2, -33.8],
          [151.3, -33.9],
        ],
      },
    });

    expect(response.status).toBe(422);
    expect(insertedRows).toHaveLength(0);
  });
});

describe("when our own reads fail, the participant is still heard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    campaignSelects = [];
    insertedRows.length = 0;
    createServiceRoleClientMock.mockReturnValue({ from: fromMock, storage: { from: vi.fn() } });
    publicCampaignRow = {
      id: CAMPAIGN_ID,
      workspace_id: "workspace-1",
      title: "Corridor study",
      status: "active",
      allow_public_submissions: true,
      submissions_closed_at: null,
      demographics_enabled: false,
    };
    geofenceScopeRow = { submission_geofence_enabled: true, ...AREA_BBOX, place_label: "the corridor" };
    geofenceScopeError = null;
    boundaryRow = { place_geometry_geojson: AREA_GEOMETRY };
    boundaryError = null;
  });

  /**
   * This is also the pre-migration state: before 20260730000002 is applied the
   * column does not exist and this read errors for every campaign. Accepting is
   * what makes the deploy safe in either order.
   */
  it("accepts when the flag itself could not be read, rather than inventing a rule", async () => {
    geofenceScopeRow = null;
    geofenceScopeError = { message: 'column "submission_geofence_enabled" does not exist', code: "42703" };

    const response = await submit({ body: "The bus never comes.", ...FAR_AWAY });

    expect(response.status).toBe(201);
    expect(insertedRows).toHaveLength(1);
  });

  it("accepts an inside-the-box pin when the boundary read fails, instead of refusing on our fault", async () => {
    boundaryRow = null;
    boundaryError = { message: "statement timeout", code: "57014" };

    const response = await submit({ body: "Add a crossing here.", ...INSIDE });

    expect(response.status).toBe(201);
  });

  it("still refuses a far-away pin when the boundary read would fail — the box already settled it", async () => {
    boundaryRow = null;
    boundaryError = { message: "statement timeout", code: "57014" };

    const response = await submit({ body: "This roundabout is terrible.", ...FAR_AWAY });

    expect(response.status).toBe(422);
    // The boundary is never even asked for: outside the box is final.
    expect(campaignSelects.some((columns) => columns.trim() === "place_geometry_geojson")).toBe(false);
  });

  it("accepts, rather than refusing everyone, when the flag is on with no extent behind it", async () => {
    // The `engagement_campaigns_geofence_needs_area` CHECK makes this
    // unstorable; a deployment missing the constraint must still not turn its
    // whole public into 422s.
    geofenceScopeRow = {
      submission_geofence_enabled: true,
      place_min_lon: null,
      place_min_lat: null,
      place_max_lon: null,
      place_max_lat: null,
      place_label: null,
    };

    const response = await submit({ body: "The bus never comes.", ...FAR_AWAY });

    expect(response.status).toBe(201);
  });
});

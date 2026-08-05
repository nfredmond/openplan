import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Survey responses were collected and could not leave the product. This proves
 * the door out exists, that a planner can find it, and that it does not carry
 * more of a resident than the operator can already see.
 *
 * NOTHING IN THE READ PATH IS DOUBLED. `loadCampaignAccess` and
 * `loadSurveyResponseSessions` are the REAL functions here — only the Supabase
 * factories are replaced, with a fake client that records every `.select()`
 * projection it is handed. Stubbing either loader would have tested the
 * renderer and proved nothing about the permission gate or the columns.
 */

const authGetUser = vi.fn();
const serviceRoleClient = vi.fn();
const auditError = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: authGetUser }, ...sessionClient() }),
  createServiceRoleClient: () => serviceRoleClient(),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: auditError }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { GET } from "@/app/api/engagement/campaigns/[campaignId]/survey/export/route";
import { EngagementShareControls } from "@/components/engagement/engagement-share-controls";

const CAMPAIGN_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

/** Every projection string the route's reads asked the database for. */
let projections: string[] = [];
/** Every `.eq()` filter applied to the sensitive response-session read. */
let sessionFilters: [string, unknown][] = [];

let campaignRow: Record<string, unknown> | null = null;
let campaignError: { message: string } | null = null;
let membershipRow: Record<string, unknown> | null = null;
let sessionRows: Record<string, unknown>[] = [];
/** The one lever that makes the failure path reachable — see `responseClient`. */
let sessionError: { message: string } | null = null;

/** The auth-side client: campaign lookup + workspace membership. */
function sessionClient() {
  return {
    from(table: string) {
      const builder = {
        select(columns: string) {
          projections.push(`${table}:${columns}`);
          return builder;
        },
        eq() {
          return builder;
        },
        async maybeSingle() {
          if (table === "engagement_campaigns") return { data: campaignRow, error: campaignError };
          if (table === "workspace_members") return { data: membershipRow, error: null };
          throw new Error(`unexpected table ${table}`);
        },
      };
      return builder;
    },
  };
}

/**
 * The service-role client: the sensitive response-session read only.
 *
 * `sessionError` is what makes this harness able to prove anything about a
 * failed read. A fake client hands back its fixture whatever was asked for, so
 * without a way to FAIL a named read the whole failure path is unreachable and
 * every assertion below would pass over code that never runs — which is exactly
 * how this defect class shipped in the first place.
 */
function responseClient() {
  return {
    from(table: string) {
      if (table !== "engagement_survey_response_sessions") {
        throw new Error(`unexpected sensitive table ${table}`);
      }
      const builder = {
        select(columns: string) {
          projections.push(`${table}:${columns}`);
          return builder;
        },
        eq(column: string, value: unknown) {
          sessionFilters.push([column, value]);
          return builder;
        },
        async order() {
          return { data: sessionError ? null : sessionRows, error: sessionError };
        },
      };
      return builder;
    },
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "resp-1",
    status: "pending",
    // The loader selects these; the export must not emit them.
    submitted_by: "Ada Lovelace <ada@example.org>",
    source_type: "public",
    moderation_notes: "staff: check duplicate",
    created_at: "2026-03-04T10:00:00.000Z",
    updated_at: "2026-03-04T10:05:00.000Z",
    ...overrides,
  };
}

function request(query = "") {
  return new NextRequest(
    `http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}/survey/export${query}`
  );
}
const context = { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  projections = [];
  sessionFilters = [];
  campaignError = null;
  campaignRow = { id: CAMPAIGN_ID, workspace_id: "ws-1", title: "Downtown listening" };
  membershipRow = { workspace_id: "ws-1", role: "member" };
  sessionRows = [session()];
  sessionError = null;
  authGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  serviceRoleClient.mockImplementation(() => responseClient());
});

describe("a planner can export a campaign's survey responses", () => {
  it("answers a CSV of the response register, campaign-scoped", async () => {
    const response = await GET(request(), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain(
      `survey-responses-${CAMPAIGN_ID}.csv`
    );

    const body = await response.text();
    const lines = body.split("\n");
    const header = lines.find((line) => line.startsWith("response_id"));
    expect(header).toBe("response_id,status,source_type,received_at,updated_at");
    expect(body).toContain("resp-1,pending,public,2026-03-04T10:00:00.000Z");

    // The sensitive read is scoped to this campaign and nothing else.
    expect(sessionFilters).toEqual([["campaign_id", CAMPAIGN_ID]]);
  });

  it("asks the database for the columns the file renders", () => {
    // A mocked client hands back the fixture whatever was requested, so the
    // projection string is the only place a dropped column can be caught.
    return GET(request(), context).then(() => {
      const projection = projections.find((p) =>
        p.startsWith("engagement_survey_response_sessions:")
      );
      expect(projection).toBeTruthy();
      for (const column of ["id", "status", "source_type", "created_at", "updated_at"]) {
        expect(projection).toContain(column);
      }
    });
  });

  it("carries no respondent name, contact detail, fingerprint or internal note", async () => {
    const body = await (await GET(request(), context)).text();

    expect(body).not.toContain("ada@example.org");
    expect(body).not.toContain("Ada Lovelace");
    expect(body).not.toContain("staff: check duplicate");
    expect(body.toLowerCase()).not.toContain("fingerprint,");
    expect(body).not.toMatch(/^submitted_by/m);
  });

  it("states what the file contains, in the file", async () => {
    const body = await (await GET(request(), context)).text();

    expect(body.startsWith("# OpenPlan survey response register")).toBe(true);
    expect(body).toContain("Downtown listening");
    expect(body).toContain("1 survey response recorded");
    expect(body).toContain("Contains: one row per survey response received");
    expect(body).toContain("Excludes:");
  });

  it("states a plain zero when the read succeeded and found nothing", async () => {
    sessionRows = [];
    const body = await (await GET(request(), context)).text();

    expect(body).toContain("# 0 survey responses recorded.");
    // The old hedge was there because the loader could not report its own
    // failure. It can now, so the file no longer refuses to say what it knows.
    expect(body).not.toContain("cannot yet tell those two apart");
  });

  it("keeps a filtered empty result from denying the whole campaign", async () => {
    // A planner who filtered to `flagged` and read "0 survey responses
    // recorded" would take it as a fact about a campaign that may have
    // hundreds. The absence stated must be the one that was actually queried.
    sessionRows = [];
    const body = await (await GET(request("?status=flagged"), context)).text();

    expect(body).toContain('no survey response has status "flagged"');
    expect(body).not.toContain("# 0 survey responses recorded.");
  });

  it("passes a status filter through to the query", async () => {
    await GET(request("?status=flagged"), context);
    expect(sessionFilters).toEqual([
      ["campaign_id", CAMPAIGN_ID],
      ["status", "flagged"],
    ]);
  });

  it("refuses an unknown status instead of silently exporting everything", async () => {
    const response = await GET(request("?status=deleted"), context);
    expect(response.status).toBe(400);
    expect(sessionFilters).toEqual([]);
  });
});

describe("the export is gated exactly as the rest of the response surface is", () => {
  it("401s an unauthenticated request without touching the response tables", async () => {
    authGetUser.mockResolvedValue({ data: { user: null } });
    const response = await GET(request(), context);
    expect(response.status).toBe(401);
    expect(serviceRoleClient).not.toHaveBeenCalled();
  });

  it("403s a member of another workspace", async () => {
    membershipRow = null;
    const response = await GET(request(), context);
    expect(response.status).toBe(403);
    expect(serviceRoleClient).not.toHaveBeenCalled();
  });

  it("404s a campaign that does not exist", async () => {
    campaignRow = null;
    const response = await GET(request(), context);
    expect(response.status).toBe(404);
    expect(serviceRoleClient).not.toHaveBeenCalled();
  });

  it("500s — never 200 with an empty file — when the access read itself fails", async () => {
    campaignError = { message: "connection reset" };
    const response = await GET(request(), context);
    expect(response.status).toBe(500);
    expect(serviceRoleClient).not.toHaveBeenCalled();
  });

  it("grants a viewer, because engagement.read is the surface's own gate", async () => {
    membershipRow = { workspace_id: "ws-1", role: "viewer" };
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
  });
});

describe("a failed response read leaves as a status, never as a file", () => {
  /**
   * The defect this closes. `loadSurveyResponseSessions` returned
   * `result.data ?? []`, so a dropped connection produced a 200, a valid CSV,
   * and a header line — a document an agency attaches to a Title VI or grant
   * deliverable, stating a participation record nobody read.
   */
  it("500s instead of writing a file that claims zero responses", async () => {
    sessionError = { message: "connection reset by peer" };
    const response = await GET(request(), context);

    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).not.toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toBeNull();

    const body = await response.json();
    expect(body.error).toBe("Failed to load survey responses");
    expect(body.hint).toBe("This is a read failure, not an empty result.");

    // The false claim is gone, not merely accompanied by an error.
    const text = JSON.stringify(body);
    expect(text).not.toContain("0 survey responses recorded");
    expect(text).not.toContain("response_id,status");
  });

  it("names the failure in the audit line, with the database's own words", async () => {
    sessionError = { message: "connection reset by peer" };
    await GET(request("?status=flagged"), context);

    expect(auditError).toHaveBeenCalledWith(
      "survey_export_read_failed",
      expect.objectContaining({
        campaignId: CAMPAIGN_ID,
        statusFilter: "flagged",
        message: "connection reset by peer",
      })
    );
  });

  it("503s an unapplied migration, because that one is worth retrying", async () => {
    sessionError = { message: 'relation "public.engagement_survey_response_sessions" does not exist' };
    const response = await GET(request(), context);

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toContain("schema is not available yet");
  });
});

describe("a planner can REACH the export", () => {
  // The real component, not a described fixture: this renders the same share
  // controls the campaign page mounts unconditionally in Operator Actions.
  const campaign = {
    id: CAMPAIGN_ID,
    title: "Downtown listening",
    status: "active",
    share_token: "abcdef0123456789abcdef01",
    public_description: "Tell us about downtown.",
    allow_public_submissions: true,
    submissions_closed_at: null,
    demographics_enabled: false,
  };

  it("offers a link that hits the survey export route", () => {
    render(<EngagementShareControls campaign={campaign} />);

    const link = screen.getByText(/Export survey response register/i).closest("a");
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toBe(
      `/api/engagement/campaigns/${CAMPAIGN_ID}/survey/export?format=csv`
    );
    expect(link?.hasAttribute("download")).toBe(true);
  });

  it("tells the planner what the file holds before they download it", () => {
    render(<EngagementShareControls campaign={campaign} />);

    expect(screen.getByText(/One row per survey response received/i)).toBeTruthy();
    expect(screen.getByText(/leaves out respondent names and contact details/i)).toBeTruthy();
  });

  it("offers it even before the portal is publicly reachable (responses may predate a token)", () => {
    render(<EngagementShareControls campaign={{ ...campaign, share_token: null }} />);
    expect(screen.getByText(/Export survey response register/i)).toBeTruthy();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngagementCampaignControls } from "@/components/engagement/engagement-campaign-controls";
import { EngagementReviewFiles } from "@/components/engagement/engagement-review-files";
import { resolvePortalMapFraming } from "@/lib/engagement/public-portal-data";
import type { WorkspaceCalendar } from "@/lib/time/workspace-calendar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

/**
 * ENGAGEMENT DATE INPUTS READ AND WRITE THE WORKSPACE'S CLOCK.
 *
 * The participation inputs were labelled "UTC" and filled by slicing the stored
 * instant, while the staff sentences beside them name the workspace zone. A
 * close at 6 p.m. Pacific read "October 20 at 18:00 (America/Los_Angeles)" in
 * the sentence and "2026-10-21T01:00" in the input. The review-file filters
 * likewise cut days at UTC midnight. Every expected instant below was worked
 * out by hand from the zone's offset on that date.
 */

const LA: WorkspaceCalendar = { timeZone: "America/Los_Angeles", source: "workspace_setting" };
const HONOLULU: WorkspaceCalendar = { timeZone: "Pacific/Honolulu", source: "workspace_setting" };
const TOKYO: WorkspaceCalendar = { timeZone: "Asia/Tokyo", source: "home_country" };

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Corridor listening window",
    summary: null,
    status: "active",
    engagement_type: "comment_collection",
    project_id: null,
    rtp_cycle_id: null,
    rtp_cycle_chapter_id: null,
    participation_starts_at: null,
    participation_ends_at: null,
    ...overrides,
  };
}

function stubCampaignFetch() {
  const patchBodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((_url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "PATCH") patchBodies.push(JSON.parse(init.body ?? "{}") as Record<string, unknown>);
      const body =
        !init?.method || init.method === "GET"
          ? {
              mapFraming: resolvePortalMapFraming({}),
              submissionGeofence: { enabled: false, canEnable: false, areaState: "unset", areaLabel: null },
              rtpTargets: { cycles: [] },
              linkedProjectIds: [],
            }
          : { success: true };
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
      );
    })
  );
  return patchBodies;
}

const opens = () => screen.getByLabelText(/^Participation opens/) as HTMLInputElement;
const closes = () => screen.getByLabelText(/^Participation closes/) as HTMLInputElement;

async function saveCampaign(patchBodies: Array<Record<string, unknown>>) {
  fireEvent.click(screen.getByRole("button", { name: /^save campaign$/i }));
  await waitFor(() => expect(patchBodies).toHaveLength(1));
  return patchBodies[0];
}

describe("participation dates on the workspace clock", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows a late-evening Pacific close as that evening and saves the same instant back", async () => {
    const patchBodies = stubCampaignFetch();
    render(
      <EngagementCampaignControls
        campaign={campaign({
          participation_starts_at: "2026-10-01T15:00:00+00:00",
          participation_ends_at: "2026-10-21T01:00:00+00:00",
        })}
        projects={[]}
        calendar={LA}
      />
    );
    expect(closes()).toHaveValue("2026-10-20T18:00");
    expect(opens()).toHaveValue("2026-10-01T08:00");
    expect(screen.getByText(/Participation closes \(America\/Los_Angeles\)/)).toBeInTheDocument();
    expect(screen.queryByText(/closes, UTC/)).not.toBeInTheDocument();

    const body = await saveCampaign(patchBodies);
    expect(body.participationEndsAt).toBe("2026-10-21T01:00:00.000Z");
    expect(body.participationStartsAt).toBe("2026-10-01T15:00:00.000Z");
  });

  it("reads typed times with the offset in force on that date, across daylight saving time", async () => {
    const patchBodies = stubCampaignFetch();
    render(<EngagementCampaignControls campaign={campaign()} projects={[]} calendar={LA} />);
    // Nov 1, 2026: 1:30 a.m. occurs twice in Los Angeles; the earlier (PDT, UTC-7) is meant.
    fireEvent.change(opens(), { target: { value: "2026-11-01T01:30" } });
    // Nov 2 is on PST (UTC-8).
    fireEvent.change(closes(), { target: { value: "2026-11-02T17:00" } });
    const body = await saveCampaign(patchBodies);
    expect(body.participationStartsAt).toBe("2026-11-01T08:30:00.000Z");
    expect(body.participationEndsAt).toBe("2026-11-03T01:00:00.000Z");
  });

  it("works far from UTC in both directions", async () => {
    const honoluluBodies = stubCampaignFetch();
    render(<EngagementCampaignControls campaign={campaign()} projects={[]} calendar={HONOLULU} />);
    fireEvent.change(closes(), { target: { value: "2026-10-20T20:00" } });
    expect((await saveCampaign(honoluluBodies)).participationEndsAt).toBe("2026-10-21T06:00:00.000Z");
    cleanup();
    vi.unstubAllGlobals();

    const tokyoBodies = stubCampaignFetch();
    render(
      <EngagementCampaignControls
        campaign={campaign({ participation_ends_at: "2026-10-20T23:00:00+00:00" })}
        projects={[]}
        calendar={TOKYO}
      />
    );
    expect(closes()).toHaveValue("2026-10-21T08:00");
    expect(screen.getByText(/Participation closes \(Asia\/Tokyo\)/)).toBeInTheDocument();
    expect((await saveCampaign(tokyoBodies)).participationEndsAt).toBe("2026-10-20T23:00:00.000Z");
  });

  it("says UTC out loud when the workspace has no zone, and keeps UTC values", async () => {
    const patchBodies = stubCampaignFetch();
    render(
      <EngagementCampaignControls
        campaign={campaign({ participation_ends_at: "2026-10-21T01:00:00+00:00" })}
        projects={[]}
        calendar={{ timeZone: "UTC", source: "utc_fallback" }}
      />
    );
    expect(closes()).toHaveValue("2026-10-21T01:00");
    expect(screen.getByText(/Participation closes \(UTC, no workspace time zone set\)/)).toBeInTheDocument();
    expect((await saveCampaign(patchBodies)).participationEndsAt).toBe("2026-10-21T01:00:00.000Z");
  });

  it("sends null for an emptied date, as before", async () => {
    const patchBodies = stubCampaignFetch();
    render(
      <EngagementCampaignControls
        campaign={campaign({ participation_ends_at: "2026-10-21T01:00:00+00:00" })}
        projects={[]}
        calendar={LA}
      />
    );
    fireEvent.change(closes(), { target: { value: "" } });
    const body = await saveCampaign(patchBodies);
    expect(body.participationEndsAt).toBeNull();
    expect(body.participationStartsAt).toBeNull();
  });
});

type ReviewPost = { filters: { from?: string; to?: string } };

function stubReviewFetch() {
  const posts: ReviewPost[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "POST") posts.push(JSON.parse(init.body ?? "{}") as ReviewPost);
      return { ok: true, json: async () => ({ jobs: [], canWrite: true }) };
    })
  );
  return posts;
}

async function prepare(posts: ReviewPost[]) {
  fireEvent.click(screen.getByRole("button", { name: /Prepare PDF, XLSX and ZIP/ }));
  await waitFor(() => expect(posts).toHaveLength(1));
  return posts[0].filters;
}

describe("review-file received dates are whole days on the workspace calendar", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("starts each day at the workspace's midnight, across daylight saving time", async () => {
    const posts = stubReviewFetch();
    render(<EngagementReviewFiles campaignId="synthetic-campaign" calendar={LA} />);
    const from = await screen.findByLabelText("Received from (America/Los_Angeles)");
    fireEvent.change(from, { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("Received before (America/Los_Angeles)"), {
      target: { value: "2026-11-02" },
    });
    // Midnight Nov 1 is PDT (UTC-7); midnight Nov 2 is PST (UTC-8).
    expect(await prepare(posts)).toEqual({ from: "2026-11-01T07:00:00.000Z", to: "2026-11-02T08:00:00.000Z" });
  });

  it("works east and west of UTC", async () => {
    const tokyoPosts = stubReviewFetch();
    render(<EngagementReviewFiles campaignId="synthetic-campaign" calendar={TOKYO} />);
    fireEvent.change(await screen.findByLabelText("Received from (Asia/Tokyo)"), { target: { value: "2026-10-20" } });
    expect((await prepare(tokyoPosts)).from).toBe("2026-10-19T15:00:00.000Z");
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();

    const honoluluPosts = stubReviewFetch();
    render(<EngagementReviewFiles campaignId="synthetic-campaign" calendar={HONOLULU} />);
    fireEvent.change(await screen.findByLabelText("Received before (Pacific/Honolulu)"), {
      target: { value: "2026-10-21" },
    });
    expect((await prepare(honoluluPosts)).to).toBe("2026-10-21T10:00:00.000Z");
  });

  it("restores a saved selection on the workspace calendar, not as its UTC day", async () => {
    stubReviewFetch();
    localStorage.setItem(
      "openplan-engagement-export-request:synthetic-campaign",
      JSON.stringify({
        id: "saved-request",
        payload: JSON.stringify({ scope: "internal", filters: { from: "2026-10-19T15:00:00.000Z" } }),
      })
    );
    render(<EngagementReviewFiles campaignId="synthetic-campaign" calendar={TOKYO} />);
    await waitFor(() => expect(screen.getByLabelText("Received from (Asia/Tokyo)")).toHaveValue("2026-10-20"));
  });

  it("says UTC out loud without a workspace zone", async () => {
    const posts = stubReviewFetch();
    render(<EngagementReviewFiles campaignId="synthetic-campaign" />);
    fireEvent.change(await screen.findByLabelText("Received from (UTC, no workspace time zone set)"), {
      target: { value: "2026-10-20" },
    });
    expect((await prepare(posts)).from).toBe("2026-10-20T00:00:00.000Z");
  });
});

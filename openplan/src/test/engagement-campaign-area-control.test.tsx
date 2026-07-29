import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngagementCampaignControls } from "@/components/engagement/engagement-campaign-controls";
import { resolvePortalMapFraming } from "@/lib/engagement/public-portal-data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

/**
 * THE OPERATOR HALF OF THE REACHABILITY SEAM.
 *
 * `resolvePortalMapFraming` can be perfectly correct and still leave the product
 * broken if no operator can see or change what it chose. That is the defect
 * class this repo has paid for repeatedly: a complete, tested capability with no
 * way in. So these assert what an operator SEES on the campaign console — the
 * area that frames their public map, why it was chosen, and a control to
 * override it — not just that the functions behind them exist.
 *
 * The picker is deliberately asserted to be the shared TIGERweb any-place one
 * (`StudyAreaPicker`), because CLAUDE.md forbids a second geography selector and
 * a hand-rolled one here would work fine while quietly forking the front door.
 */

const campaign = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Broad Street listening campaign",
  summary: null,
  status: "active",
  engagement_type: "map_feedback",
  project_id: null,
};

function respondWithFraming(framing: unknown) {
  return vi.fn().mockImplementation((url: string, init?: { method?: string }) => {
    if (!init?.method || init.method === "GET") {
      return Promise.resolve(
        new Response(JSON.stringify({ mapFraming: framing }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ success: true, campaignId: campaign.id }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
  });
}

describe("the operator can see and set what frames the public map", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names the area that frames the portal and why it was chosen", async () => {
    const framing = resolvePortalMapFraming({
      projectPlace: {
        state: "set",
        label: "Franklin County, Ohio",
        bbox: { minLon: -83.2, minLat: 39.85, maxLon: -82.8, maxLat: 40.1 },
      },
    });
    vi.stubGlobal("fetch", respondWithFraming(framing));

    render(<EngagementCampaignControls campaign={campaign} projects={[]} />);

    expect(
      await screen.findByText(/This map opens on Franklin County, Ohio — the linked project's study area\./i)
    ).toBeInTheDocument();
    expect(screen.getByText("Project study area")).toBeInTheDocument();
  });

  it("warns, rather than staying quiet, when nothing frames the portal", async () => {
    vi.stubGlobal("fetch", respondWithFraming(resolvePortalMapFraming({})));

    render(<EngagementCampaignControls campaign={campaign} projects={[]} />);

    expect(await screen.findByText(/no study area has been set for this campaign/i)).toBeInTheDocument();
    expect(
      screen.getByText(/the first resident to open this campaign sees the whole country/i)
    ).toBeInTheDocument();
  });

  it("does not report a failed read as an area nobody set", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Workspace access denied" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        })
      )
    );

    render(<EngagementCampaignControls campaign={campaign} projects={[]} />);

    expect(await screen.findByText(/Could not read where the public map opens/i)).toBeInTheDocument();
    // The honest failure must not be dressed up as the ordinary empty state.
    expect(screen.queryByText(/no study area has been set for this campaign/i)).toBeNull();
  });

  it("opens the shared any-place picker to set the campaign's own area", async () => {
    vi.stubGlobal("fetch", respondWithFraming(resolvePortalMapFraming({})));

    render(<EngagementCampaignControls campaign={campaign} projects={[]} />);

    const open = await screen.findByRole("button", { name: /set campaign area/i });
    fireEvent.click(open);

    await waitFor(() => {
      expect(screen.getByLabelText("Search for a place")).toBeInTheDocument();
    });
    expect(screen.getByRole("group", { name: "Study area input mode" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save campaign area/i })).toBeInTheDocument();
  });

  it("refuses to save an empty area rather than silently doing nothing", async () => {
    const fetchMock = respondWithFraming(resolvePortalMapFraming({}));
    vi.stubGlobal("fetch", fetchMock);

    render(<EngagementCampaignControls campaign={campaign} projects={[]} />);

    fireEvent.click(await screen.findByRole("button", { name: /set campaign area/i }));
    fireEvent.click(await screen.findByRole("button", { name: /save campaign area/i }));

    expect(await screen.findByText(/Search for a place or draw an area before saving/i)).toBeInTheDocument();
    // Nothing was PATCHed — only the initial framing read happened.
    expect(fetchMock.mock.calls.every((call) => !call[1] || !call[1].method || call[1].method === "GET")).toBe(true);
  });
});

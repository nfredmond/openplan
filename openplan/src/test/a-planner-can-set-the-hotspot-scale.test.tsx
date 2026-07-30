import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpatialHotspotTuner } from "@/components/engagement/spatial-hotspot-tuner";
import {
  HOTSPOT_DEFAULT_EPS_METERS,
  HOTSPOT_DEFAULT_MIN_POINTS,
  type HotspotAnalysis,
} from "@/lib/engagement/hotspots";
import { summarizeEngagementItems } from "@/lib/engagement/summary";
import { buildDailyIntake } from "@/lib/engagement/participation-dashboard";

/**
 * A FIXED CLUSTER RADIUS IS A HARDCODED CLAIM ABOUT GEOGRAPHIC SCALE.
 *
 * The hotspot test is DBSCAN. `eps` decides how far apart two comments can be
 * and still be the same place; 250 m is sensible downtown and meaningless
 * across a rural county. The campaign page rendered that default and offered no
 * way past it, which fixed a scale assumption in code for every agency in the
 * country. `/api/engagement/campaigns/[id]/hotspots` was built for exactly this
 * — clamps and all — and had no caller.
 */

// Mapbox does not run in jsdom, and this file is about the controls and the
// request they make, not about rendering a map.
vi.mock("@/components/engagement/participation-heatmap-map", () => ({
  ParticipationHeatmapMap: ({ hotspots }: { hotspots: { features: unknown[] } }) => (
    <div data-testid="heatmap" data-features={hotspots.features.length} />
  ),
}));

function analysis(overrides: Partial<HotspotAnalysis> = {}): HotspotAnalysis {
  return {
    clusters: [],
    clusterCount: 0,
    significantCount: 0,
    testedCount: 0,
    epsMeters: HOTSPOT_DEFAULT_EPS_METERS,
    minPoints: HOTSPOT_DEFAULT_MIN_POINTS,
    alpha: 0.05,
    zCritical: null,
    globalNegativeSharePct: null,
    sentimentAvailable: false,
    caveat: "Screening only.",
    ...overrides,
  };
}

const renderTuner = (initial: HotspotAnalysis = analysis()) =>
  render(
    <SpatialHotspotTuner
      campaignId="11111111-1111-4111-8111-111111111111"
      // One geolocated comment, because the map renders only when there is
      // something to put on it — the same condition the page made before this
      // control existed.
      points={[{ lng: -121.06, lat: 39.22, weight: 1, negative: false }]}
      initialHotspots={initial}
      // Built by the real summarisers rather than hand-written: a fixture that
      // drifts from the shape these components actually receive turns a passing
      // test into no test at all.
      counts={summarizeEngagementItems([], [])}
      categories={[]}
      intake={buildDailyIntake([])}
    />
  );

const setRadius = (value: string) =>
  fireEvent.change(screen.getByLabelText(/cluster radius/i), { target: { value } });

const apply = async () =>
  act(async () => fireEvent.click(screen.getByRole("button", { name: /apply/i })));

describe("a planner can set the hotspot scale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("renders the server's analysis before any request is made", async () => {
    renderTuner();

    // A planner who never touches the controls must see what they saw before.
    expect(screen.getByTestId("heatmap")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/within 250 m of one another/i)).toBeInTheDocument();
  });

  it("asks the route that had no caller for a different scale", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ hotspots: analysis({ epsMeters: 1200, minPoints: 3 }) }),
    });

    renderTuner();
    setRadius("1200");
    await apply();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/engagement/campaigns/11111111-1111-4111-8111-111111111111/hotspots?eps=1200&minPoints=5"
      );
    });
  });

  it("describes the analysis it is showing, not the numbers that were typed", async () => {
    // The route CLAMPS to 25–2000 m. A page that echoed the input would caption
    // a 2000 m map as 9000 m — a false statement about what the reader is
    // looking at, which is worse than refusing the input.
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ hotspots: analysis({ epsMeters: 2000, minPoints: 5 }) }),
    });

    renderTuner();
    setRadius("9000");
    await apply();

    expect(await screen.findByText(/within 2000 m of one another/i)).toBeInTheDocument();
    expect(screen.queryByText(/within 9000 m/i)).toBeNull();
  });

  it("keeps the reading on screen when the recompute fails, and says it is unchanged", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Failed to compute hotspots" }),
    });

    renderTuner();
    setRadius("500");
    await apply();

    // The analysis on screen is still the server's, and still true — it is just
    // not the one that was asked for.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/within 250 m of one another/i)).toBeInTheDocument();
  });

  it("does not re-request the scale already on screen", async () => {
    renderTuner();

    // Apply is inert until something changes: an identical request costs a
    // Postgres clustering pass for a map that would not move.
    expect(screen.getByRole("button", { name: /apply/i })).toBeDisabled();
  });

  it("offers a way back to the default only once it has been left", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ hotspots: analysis({ epsMeters: 800, minPoints: 5 }) }),
    });

    const { rerender } = renderTuner();
    expect(screen.queryByRole("button", { name: /reset/i })).toBeNull();

    setRadius("800");
    await apply();

    expect(await screen.findByRole("button", { name: /reset/i })).toBeInTheDocument();
    void rerender;
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRunEvidencePanel } from "@/components/models/model-run-evidence-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_RUN_ID = "22222222-2222-4222-8222-222222222222";

function mockEvidenceFetch(packet: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => packet }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPanel(
  engineKey: string,
  claimStatus?: "calibrated_to_counts" | "screening_grade" | "prototype_only" | "claim_grade_passed" | null
) {
  return render(
    <ModelRunEvidencePanel
      modelId={MODEL_ID}
      modelRunId={MODEL_RUN_ID}
      runTitle="Davis screening run"
      runStatus="succeeded"
      engineKey={engineKey}
      comparisonCandidates={[]}
      claimStatus={claimStatus}
    />
  );
}

async function openEvidence() {
  fireEvent.click(screen.getByRole("button", { name: /inspect evidence/i }));
  await waitFor(() => expect(screen.getByTestId("evidence-run-honesty")).toBeInTheDocument());
}

const AEQUILIBRAE_PACKET = {
  engine: "aequilibrae",
  mode_split: { transit_status: "no_local_feed", auto_mode_share_pct: 94.5 },
  provenance: {
    engine_version: "aeq-1.6.2",
    run_started_at: "2026-07-22T17:00:00.000Z",
    run_completed_at: "2026-07-22T17:06:00.000Z",
  },
  inputs: { zone_count: 42 },
  assumptions: { corridor_geojson_hash: "abcdef1234567890ffff" },
  caveats: ["Uncalibrated", "Screening-grade"],
};

describe("ModelRunEvidencePanel run-honesty header", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("badges an off-Nevada aequilibrae run as screening-grade with an honest transit label", async () => {
    mockEvidenceFetch(AEQUILIBRAE_PACKET);
    renderPanel("aequilibrae");
    await openEvidence();

    const block = screen.getByTestId("evidence-run-honesty");
    expect(block).toHaveTextContent("Screening-grade");
    expect(block).toHaveTextContent("Uncalibrated by default");
    // The load-bearing honesty distinction: 0 transit share is a feed gap.
    expect(block).toHaveTextContent("Transit not modeled — no local GTFS feed");
    // Reproducibility snapshot.
    expect(block).toHaveTextContent("aeq-1.6.2");
    expect(block).toHaveTextContent("42");
    expect(block).toHaveTextContent("abcdef123456");
  });

  it("shows a modeled-transit label when a covering feed was skimmed", async () => {
    mockEvidenceFetch({ ...AEQUILIBRAE_PACKET, mode_split: { transit_status: "modeled" } });
    renderPanel("aequilibrae");
    await openEvidence();

    const block = screen.getByTestId("evidence-run-honesty");
    expect(block).toHaveTextContent("Transit modeled (local GTFS)");
    expect(block).not.toHaveTextContent("not modeled");
  });

  it("badges a prototype-surface engine as prototype-only, not screening-grade", async () => {
    mockEvidenceFetch({ engine: "behavioral_demand" });
    renderPanel("behavioral_demand");
    await openEvidence();

    const block = screen.getByTestId("evidence-run-honesty");
    expect(block).toHaveTextContent("Prototype-only");
    expect(block).not.toHaveTextContent("Uncalibrated by default");
  });

  it("surfaces the run's REAL calibrated_to_counts tier, not the screening-grade default", async () => {
    mockEvidenceFetch(AEQUILIBRAE_PACKET);
    // The worker promoted this run to calibrated_to_counts; the panel must honor
    // the real claim tier read server-side, not the availability-derived default.
    renderPanel("aequilibrae", "calibrated_to_counts");
    await openEvidence();

    const block = screen.getByTestId("evidence-run-honesty");
    expect(block).toHaveTextContent("Calibrated to counts");
    expect(block).not.toHaveTextContent("Screening-grade");
    // Calibrated is not "uncalibrated by default" — that secondary badge is
    // reserved for screening_grade.
    expect(block).not.toHaveTextContent("Uncalibrated by default");
  });

  it("keeps the Uncalibrated-by-default badge for a screening_grade claim", async () => {
    mockEvidenceFetch(AEQUILIBRAE_PACKET);
    renderPanel("aequilibrae", "screening_grade");
    await openEvidence();

    const block = screen.getByTestId("evidence-run-honesty");
    expect(block).toHaveTextContent("Screening-grade");
    expect(block).toHaveTextContent("Uncalibrated by default");
    expect(block).not.toHaveTextContent("Calibrated to counts");
  });

  it("falls back to the availability posture when no claim row exists (null)", async () => {
    mockEvidenceFetch(AEQUILIBRAE_PACKET);
    renderPanel("aequilibrae", null);
    await openEvidence();

    const block = screen.getByTestId("evidence-run-honesty");
    expect(block).toHaveTextContent("Screening-grade");
    expect(block).toHaveTextContent("Uncalibrated by default");
  });

  it("renders a real claim_grade_passed tier without the uncalibrated badge", async () => {
    mockEvidenceFetch(AEQUILIBRAE_PACKET);
    renderPanel("aequilibrae", "claim_grade_passed");
    await openEvidence();

    const block = screen.getByTestId("evidence-run-honesty");
    expect(block).toHaveTextContent("Claim-grade passed");
    expect(block).not.toHaveTextContent("Uncalibrated by default");
    expect(block).not.toHaveTextContent("Screening-grade");
  });

  it("lets a real prototype_only claim override a launchable engine's screening default", async () => {
    mockEvidenceFetch(AEQUILIBRAE_PACKET);
    // aequilibrae is launchable (availability → screening_grade), but a real
    // prototype_only claim row must win and NOT show "Uncalibrated by default".
    renderPanel("aequilibrae", "prototype_only");
    await openEvidence();

    const block = screen.getByTestId("evidence-run-honesty");
    expect(block).toHaveTextContent("Prototype-only");
    expect(block).not.toHaveTextContent("Uncalibrated by default");
    expect(block).not.toHaveTextContent("Screening-grade");
  });
});

/** With per-place GTFS discovery on by default, a run's transit share is only
 * defensible if the planner can say which feed produced it and over what dates.
 * These pin that the panel states the feed — or states plainly that there wasn't
 * one, which is a different fact from "0% transit". */
describe("ModelRunEvidencePanel transit-feed provenance", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names the discovered feed and its service window for a modeled run", async () => {
    mockEvidenceFetch({
      ...AEQUILIBRAE_PACKET,
      mode_split: {
        transit_status: "modeled",
        transit_los: {
          feed_origin: "discovered_catalog",
          source_url: "https://catalog.example.org/feeds/unitrans.zip",
          source_name: null,
          service_day: "wednesday",
          service_start: "20260301",
          service_end: "20260930",
          service_period: "20260301..20260930",
          n_routes: 17,
          n_served_stops: 412,
        },
      },
    });
    renderPanel("aequilibrae");
    await openEvidence();

    const block = screen.getByTestId("evidence-transit-provenance");
    expect(block).toHaveTextContent("https://catalog.example.org/feeds/unitrans.zip");
    expect(block).toHaveTextContent("Discovered for this study area");
    // ISO dates, not locale dates — a YYYYMMDD calendar date parsed as UTC would
    // render a day early for most viewers.
    expect(block).toHaveTextContent("2026-03-01 → 2026-09-30");
    expect(block).toHaveTextContent("Wednesday");
    expect(block).toHaveTextContent("17 routes · 412 served stops");
  });

  it("states the coverage limit when discovery found no feed, rather than implying 0% was measured", async () => {
    mockEvidenceFetch({
      ...AEQUILIBRAE_PACKET,
      mode_split: {
        transit_status: "no_local_feed",
        transit_los: { feed_origin: "none", no_feed_reason: "discovery_found_no_covering_feed" },
      },
    });
    renderPanel("aequilibrae");
    await openEvidence();

    const block = screen.getByTestId("evidence-transit-provenance");
    expect(block).toHaveTextContent("No published GTFS feed in the Mobility Database catalog covers this study area");
    expect(block).toHaveTextContent("a coverage limit, not a finding that transit demand here is zero");
    // No feed means no service window to report — the panel must not print one.
    expect(block).not.toHaveTextContent("2026-");
  });

  it("calls an unreachable feed catalog unknown, not an absence of local transit", async () => {
    mockEvidenceFetch({
      ...AEQUILIBRAE_PACKET,
      mode_split: {
        transit_status: "feed_unavailable",
        transit_los: {
          feed_origin: "none",
          no_feed_reason: "feed_catalog_unavailable",
          error: "MobilityDB catalog download failed: HTTP 503",
        },
      },
    });
    renderPanel("aequilibrae");
    await openEvidence();

    const block = screen.getByTestId("evidence-transit-provenance");
    expect(block).toHaveTextContent("could not be reached, so whether a feed covers this study area is unknown");
    expect(block).toHaveTextContent("HTTP 503");
    // The claim that must NOT be made: that the catalog was consulted and had
    // nothing. Nobody checked.
    expect(block).not.toHaveTextContent("No published GTFS feed in the Mobility Database catalog covers");
  });

  it("says a feed loaded but did not reach the study area, and names it", async () => {
    mockEvidenceFetch({
      ...AEQUILIBRAE_PACKET,
      mode_split: {
        transit_status: "no_local_feed",
        transit_los: {
          feed_origin: "bundled_default",
          source_name: "bundled_agency_gtfs.zip",
          no_feed_reason: "feed_has_no_stops_in_study_area",
        },
      },
    });
    renderPanel("aequilibrae");
    await openEvidence();

    const block = screen.getByTestId("evidence-transit-provenance");
    expect(block).toHaveTextContent("bundled_agency_gtfs.zip");
    expect(block).toHaveTextContent("has no stops inside the study area");
  });

  it("reports the real reason a feed could not be read instead of a bare failure", async () => {
    mockEvidenceFetch({
      ...AEQUILIBRAE_PACKET,
      mode_split: {
        transit_status: "feed_unavailable",
        transit_los: {
          feed_origin: "discovered_catalog",
          source_url: "https://catalog.example.org/feeds/headway-only.zip",
          no_feed_reason: "feed_load_failed",
          error: "frequencies.txt-based GTFS is not supported by the headway skim; supply a stop_times-scheduled feed.",
        },
      },
    });
    renderPanel("aequilibrae");
    await openEvidence();

    const block = screen.getByTestId("evidence-transit-provenance");
    expect(block).toHaveTextContent("frequencies.txt-based GTFS is not supported");
    expect(block).toHaveTextContent("https://catalog.example.org/feeds/headway-only.zip");
  });

  it("does not blame the publisher's feed when the feed read fine and the skim failed", async () => {
    // The worker distinguishes these because they send a planner to different
    // places. A feed that read fine and then broke the skim must not be reported
    // as unreadable — that sends someone to their transit agency to fix a file
    // that is not broken.
    mockEvidenceFetch({
      ...AEQUILIBRAE_PACKET,
      mode_split: {
        transit_status: "feed_unavailable",
        transit_los: {
          feed_origin: "discovered_catalog",
          source_url: "https://catalog.example.org/feeds/regional.zip",
          no_feed_reason: "transit_skim_failed",
          error: "'GHOST'",
        },
      },
    });
    renderPanel("aequilibrae");
    await openEvidence();

    const block = screen.getByTestId("evidence-transit-provenance");
    expect(block).toHaveTextContent("was read, but the transit skim did not complete");
    expect(block).not.toHaveTextContent("The feed could not be read.");
    expect(block).toHaveTextContent("https://catalog.example.org/feeds/regional.zip");
  });

  it("does not let a bundled-feed fallback read as a successful discovery", async () => {
    // When the feed catalog cannot be reached the worker still loads the bundled
    // feed and lets its own coverage check decide — otherwise an offline
    // deployment loses transit for the one area that feed does cover. But a run
    // that then reports "modeled" must say discovery never ran, or a planner will
    // believe the catalog was searched for their area when it never answered.
    mockEvidenceFetch({
      ...AEQUILIBRAE_PACKET,
      mode_split: {
        transit_status: "modeled",
        transit_los: {
          feed_origin: "bundled_after_catalog_unavailable",
          source_name: "bundled_agency_gtfs.zip",
          discovery_error: "MobilityDB catalog download failed: HTTP 503",
          service_day: "monday",
          service_period: "20250101..20261231",
          n_routes: 2,
          n_served_stops: 30,
        },
      },
    });
    renderPanel("aequilibrae");
    await openEvidence();

    const block = screen.getByTestId("evidence-transit-provenance");
    expect(screen.getByTestId("evidence-transit-discovery-fallback")).toBeInTheDocument();
    expect(block).toHaveTextContent("Per-study-area feed discovery did not run");
    expect(block).toHaveTextContent("HTTP 503");
    expect(block).toHaveTextContent("may exist and was not looked for");
    expect(block).toHaveTextContent("fallback — the feed catalog could not be reached");
    // The claim that must NOT be made: that this feed was found for this area.
    expect(block).not.toHaveTextContent("Discovered for this study area");
  });

  it("calls a fallback feed that misses the area unknown, not an absence of transit", async () => {
    // The bundled feed standing in for an unreachable catalog says nothing about
    // whether a published feed covers this area — only that IT is the wrong feed.
    mockEvidenceFetch({
      ...AEQUILIBRAE_PACKET,
      mode_split: {
        transit_status: "feed_unavailable",
        transit_los: {
          feed_origin: "bundled_after_catalog_unavailable",
          source_name: "bundled_agency_gtfs.zip",
          discovery_error: "MobilityDB catalog download failed: HTTP 503",
          no_feed_reason: "feed_catalog_unavailable",
        },
      },
    });
    renderPanel("aequilibrae");
    await openEvidence();

    const block = screen.getByTestId("evidence-transit-provenance");
    expect(block).toHaveTextContent("could not be reached, so whether a feed covers this study area is unknown");
    expect(block).toHaveTextContent("Per-study-area feed discovery did not run");
    // Neither checked coverage claim may be made from an unreachable catalog.
    expect(block).not.toHaveTextContent("No published GTFS feed in the Mobility Database catalog covers");
    expect(block).not.toHaveTextContent("has no stops inside the study area");
  });

  it("blames the time budget, not the feed, when the transit stage is stopped early", async () => {
    // A run abandoned for time must not be reported as a broken feed: the fix is
    // the operator's, and "your feed could not be read" sends a planner to their
    // transit agency over a file that is fine.
    mockEvidenceFetch({
      ...AEQUILIBRAE_PACKET,
      mode_split: {
        transit_status: "feed_unavailable",
        transit_los: {
          feed_origin: "discovered_catalog",
          source_url: "https://catalog.example.org/feeds/regional.zip",
          no_feed_reason: "transit_skim_timed_out",
          error: "the transit stage ran out of its wall-clock budget while skimming zone-to-zone transit itineraries",
        },
      },
    });
    renderPanel("aequilibrae");
    await openEvidence();

    // The badge has to agree with the body. `feed_unavailable` is the only
    // enumerated status that keeps the transit block on screen, but a badge
    // reading "feed unavailable" would say the feed is broken while the body says
    // nothing is wrong with it — and a planner who reads only the badge would go
    // to their transit agency over a budget their own operator sets.
    const honesty = screen.getByTestId("evidence-run-honesty");
    expect(honesty).toHaveTextContent("Transit not modeled — time budget exceeded");
    expect(honesty).not.toHaveTextContent("feed unavailable");

    const block = screen.getByTestId("evidence-transit-provenance");
    expect(block).toHaveTextContent("exceeded this deployment's wall-clock budget");
    expect(block).toHaveTextContent("Nothing is known to be wrong with the feed itself");
    expect(block).toHaveTextContent("https://catalog.example.org/feeds/regional.zip");
    expect(block).not.toHaveTextContent("The feed could not be read.");
    // A stopped run is still a coverage limit, never a measured zero.
    expect(block).toHaveTextContent("not a finding that transit demand here is zero");
  });

  it("reports an unstated service window as unstated rather than inventing one", async () => {
    mockEvidenceFetch({
      ...AEQUILIBRAE_PACKET,
      mode_split: {
        transit_status: "modeled",
        transit_los: {
          feed_origin: "operator_url",
          source_url: "https://agency.example.org/gtfs.zip",
          service_day: "unknown",
          service_period: null,
          n_routes: 1,
          n_served_stops: 1,
        },
      },
    });
    renderPanel("aequilibrae");
    await openEvidence();

    const block = screen.getByTestId("evidence-transit-provenance");
    expect(block).toHaveTextContent("Not stated in the feed calendar");
    expect(block).toHaveTextContent("Not determined from the feed calendar");
    // Singular units, not "1 routes".
    expect(block).toHaveTextContent("1 route · 1 served stop");
  });

  it("does not attribute a transit share to a feed when the run recorded no provenance", async () => {
    // Packets written before the worker stamped feed provenance: the status is
    // known but the feed is not, and the panel must say so rather than leave the
    // share looking sourced.
    mockEvidenceFetch({ ...AEQUILIBRAE_PACKET, mode_split: { transit_status: "modeled" } });
    renderPanel("aequilibrae");
    await openEvidence();

    const block = screen.getByTestId("evidence-transit-provenance");
    expect(block).toHaveTextContent("recorded no transit-feed provenance");
    expect(block).toHaveTextContent("unattributed rather than as a measurement");
  });

  it("shows no transit-feed block for an engine that reports no transit status", async () => {
    mockEvidenceFetch({ engine: "sketch_abm" });
    renderPanel("sketch_abm");
    await openEvidence();

    expect(screen.queryByTestId("evidence-transit-provenance")).toBeNull();
  });
});

describe("ModelRunEvidencePanel cross-engine comparison refusal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const BASELINE_RUN_ID = "55555555-5555-4555-8555-555555555555";

  it("renders the route's refusal instead of a flat/zero-shift summary when the baseline engine differs", async () => {
    // Two estimators share the KPI name daily_vmt (worker network VMT vs sketch
    // VMT); the route refuses the diff and the panel must render that refusal,
    // never "All compared KPIs flat" — which would assert the runs agree.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("baseline_run_id")) {
        return {
          ok: true,
          json: async () => ({
            run_id: MODEL_RUN_ID,
            baseline_run_id: BASELINE_RUN_ID,
            comparison: [],
            cross_engine_comparison: {
              status: "cross_engine_comparison_blocked",
              current_engine_key: "aequilibrae",
              baseline_engine_key: "sketch_abm",
              message:
                "KPI deltas are only computed between runs of the same engine. The two engines derive same-named KPIs with different estimators.",
            },
          }),
        };
      }
      return { ok: true, json: async () => AEQUILIBRAE_PACKET };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ModelRunEvidencePanel
        modelId={MODEL_ID}
        modelRunId={MODEL_RUN_ID}
        runTitle="Davis screening run"
        runStatus="succeeded"
        engineKey="aequilibrae"
        comparisonCandidates={[
          { id: BASELINE_RUN_ID, runTitle: "Sketch baseline", completedAt: null, scenarioLabel: null },
        ]}
        claimStatus={null}
      />
    );
    await openEvidence();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: BASELINE_RUN_ID } });

    await waitFor(() =>
      expect(screen.getByTestId("cross-engine-comparison-blocked")).toBeInTheDocument()
    );
    expect(screen.getByTestId("cross-engine-comparison-blocked")).toHaveTextContent(
      /different estimators/i
    );
    // The refusal must not co-exist with a comparison summary that reads as a
    // result ("flat" asserts agreement; "0 KPI shifts" asserts a comparison ran).
    expect(screen.queryByText(/All compared KPIs flat/i)).toBeNull();
    expect(screen.queryByText(/KPI shifts/)).toBeNull();
    expect(screen.queryByText(/Comparable KPIs/)).toBeNull();
  });
});

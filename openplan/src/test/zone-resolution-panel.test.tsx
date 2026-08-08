import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModelRunZoneResolutionPanel } from "@/components/models/model-run-zone-resolution-panel";

/**
 * THE DIAGNOSTIC REACHES A PLANNER, not just the database.
 *
 * `intrazonal_trip_share` is written on every sketch run. There is no generic
 * KPI list on a model run — every figure a planner sees comes from a
 * purpose-built panel — so a KPI with no panel is stored, tested, and invisible.
 * That is this repository's signature defect, and the reason this file exists at
 * all rather than the library test being treated as sufficient.
 */

function kpiResponse(rows: Array<Record<string, unknown>>) {
  return {
    ok: true,
    json: async () => ({ kpis: rows }),
  } as unknown as Response;
}

const COARSE_ROW = {
  kpi_name: "intrazonal_trip_share",
  value: 0.36,
  breakdown_json: {
    zone_count: 26,
    intrazonal_trips: 360,
    sample_trips: 1000,
    band: "very_coarse",
    supports_link_level_validation: false,
    interpretation:
      "36.0% of trips begin and end in the same zone across 26 zones. More than a third of all " +
      "travel never reaches a link.",
  },
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("a planner is told what their zone system can support", () => {
  it("shows the share, the zone count, and that link comparison cannot settle it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(kpiResponse([COARSE_ROW])));

    render(<ModelRunZoneResolutionPanel modelId="m1" modelRunId="r1" />);

    // The headline figure and the interpretation both carry "36.0%", so this
    // asserts the headline specifically rather than matching either.
    expect(await screen.findByText("36.0%")).toBeInTheDocument();
    expect(screen.getByText(/of 26/)).toBeInTheDocument();
    expect(screen.getByText(/Link comparison cannot settle this/i)).toBeInTheDocument();
    // The interpretation, in words — a badge alone tells a planner the verdict
    // and not the reason, and the reason is the thing that stops them concluding
    // the model is broken.
    expect(screen.getAllByText(/never reaches a link/i).length).toBeGreaterThan(0);
    // And whose judgement the banding is.
    expect(screen.getByText(/OpenPlan's own screening heuristic/i)).toBeInTheDocument();
  });

  it("says link comparison IS meaningful when almost everything reaches the network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        kpiResponse([
          {
            ...COARSE_ROW,
            value: 0.04,
            breakdown_json: {
              ...COARSE_ROW.breakdown_json,
              zone_count: 380,
              band: "fine",
              supports_link_level_validation: true,
              interpretation: "4.0% of trips begin and end in the same zone across 380 zones.",
            },
          },
        ])
      )
    );

    render(<ModelRunZoneResolutionPanel modelId="m1" modelRunId="r1" />);

    expect(await screen.findByText(/Link comparison is meaningful/i)).toBeInTheDocument();
    // The caveat belongs only where the comparison cannot settle the question.
    // Showing it on a run that CAN be validated would train planners to ignore it.
    expect(screen.queryByText(/OpenPlan's own screening heuristic/i)).toBeNull();
  });

  it("bands a worker row that carries NO verdict, instead of assuming the worst", async () => {
    /**
     * THE BUG THIS EXISTS FOR, introduced and caught the same day. The
     * AequilibraE worker emits this KPI with no `breakdown_json` verdict — the
     * banding is not the worker's to decide. The panel used to read
     * `supports_link_level_validation` off the row, so `undefined` became
     * false and EVERY worker run was badged "cannot settle this", regardless of
     * its actual share. That is a false verdict on the one engine whose link
     * volumes people actually compare to counts.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        kpiResponse([{ kpi_name: "intrazonal_trip_share", value: 0.04, breakdown_json: null }])
      )
    );

    render(<ModelRunZoneResolutionPanel modelId="m1" modelRunId="r1" />);

    expect(await screen.findByText(/Link comparison is meaningful/i)).toBeInTheDocument();
    expect(screen.getByText("4.0%")).toBeInTheDocument();
    // The interpretation is produced from the number, so it is present even
    // though the row carried no wording of its own.
    expect(screen.getAllByText(/same zone/i).length).toBeGreaterThan(0);
  });

  it("names the control that fixes it, for a tract-resolution run that cannot be validated", async () => {
    // A diagnostic that says "split the zone system finer" and leaves a planner
    // to find the control is half a feature. The control exists on the launch
    // form; this closes the loop from diagnosis to the next run.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        kpiResponse([
          {
            kpi_name: "intrazonal_trip_share",
            value: 0.36,
            breakdown_json: { zone_count: 26, zone_geography: "tract" },
          },
        ])
      )
    );

    render(<ModelRunZoneResolutionPanel modelId="m1" modelRunId="r1" />);

    expect(await screen.findByText(/Zone geography \(TAZ resolution\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Block groups/i)).toBeInTheDocument();
  });

  it("does NOT offer a finer zone system to a run already at block groups", async () => {
    // There is nothing finer to switch to, and advice that cannot be taken
    // teaches a planner to stop reading the panel.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        kpiResponse([
          {
            kpi_name: "intrazonal_trip_share",
            value: 0.36,
            breakdown_json: { zone_count: 78, zone_geography: "block_group" },
          },
        ])
      )
    );

    render(<ModelRunZoneResolutionPanel modelId="m1" modelRunId="r1" />);

    expect(await screen.findByText(/Link comparison cannot settle this/i)).toBeInTheDocument();
    expect(screen.queryByText(/Zone geography \(TAZ resolution\)/i)).toBeNull();
  });

  it("renders nothing at all for a run that predates the diagnostic", async () => {
    // An older run has no such KPI. Rendering "0%" would be the most flattering
    // possible answer and would assert a fine-grained zone system nobody
    // measured.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(kpiResponse([{ kpi_name: "daily_vmt", value: 12 }])));

    const { container } = render(<ModelRunZoneResolutionPanel modelId="m1" modelRunId="r1" />);

    await waitFor(() => expect(container.querySelector("[data-testid='zone-resolution-panel']")).toBeNull());
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("says a failed read is a failed read, not a healthy zone system", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "permission denied" }),
      } as unknown as Response)
    );

    render(<ModelRunZoneResolutionPanel modelId="m1" modelRunId="r1" />);

    expect(await screen.findByText(/could not be read/i)).toBeInTheDocument();
    expect(screen.getByText(/not a finding that the zone system is fine/i)).toBeInTheDocument();
  });
});

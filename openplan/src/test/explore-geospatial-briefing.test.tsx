import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExploreGeospatialBriefing } from "@/app/(app)/explore/_components/explore-geospatial-briefing";

/**
 * These assertions were CORRECTED, not merely updated.
 *
 * The previous versions pinned the defect in place: one asserted the briefing
 * says "SWITRS remains the preferred California-grade upgrade path" — pointing
 * every planner at a system retired on 2025-01-08 — and it passed because the
 * component compared the crash snapshot against `"switrs-local"`, a token no
 * code has emitted since the crash lane moved to the adapter registry. A guard
 * that describes the code rather than the intent keeps the defect alive.
 */
describe("ExploreGeospatialBriefing", () => {
  it("renders planning signals, source posture, and captured source citations", () => {
    render(
      <ExploreGeospatialBriefing
        planningSignals={[
          {
            label: "Transit access",
            value: "18 stops",
            note: "Stops within the selected corridor buffer.",
          },
        ]}
        geospatialSourceCards={[
          {
            label: "Crash observations",
            status: "CCRS (California)",
            detail: "Observed crash records for the safety lane.",
            tone: "success",
          },
        ]}
        sourceSnapshots={{
          census: {
            retrievalUrl: "https://api.census.gov/example",
            fetchedAt: "2026-04-20T08:00:00.000Z",
          },
          crashes: {
            source: "ccrs-ca",
            label: "CCRS (California)",
          },
        }}
      />
    );

    expect(screen.getByText("Geospatial Intelligence Briefing")).toBeInTheDocument();
    expect(screen.getByText("Transit access")).toBeInTheDocument();
    expect(screen.getByText("18 stops")).toBeInTheDocument();
    expect(screen.getByText("Stops within the selected corridor buffer.")).toBeInTheDocument();
    expect(screen.getByText("Data fabric status")).toBeInTheDocument();
    expect(screen.getByText("Crash observations")).toBeInTheDocument();
    expect(screen.getByText("Observed crash records for the safety lane.")).toBeInTheDocument();
    expect(screen.getByText("https://api.census.gov/example")).toBeInTheDocument();
    // Names the adapter that actually answered, using its own label.
    expect(screen.getByText(/Crash coverage for this run came from CCRS \(California\)\./)).toBeInTheDocument();
  });

  it("names whichever adapter answered, without hardcoding one", () => {
    render(
      <ExploreGeospatialBriefing
        planningSignals={[]}
        geospatialSourceCards={[]}
        sourceSnapshots={{ crashes: { source: "fars-national", label: "FARS (national, fatal only)" } }}
      />
    );

    expect(
      screen.getByText(/Crash coverage for this run came from FARS \(national, fatal only\)\./)
    ).toBeInTheDocument();
  });

  it("says no source answered instead of recommending a retired system", () => {
    render(
      <ExploreGeospatialBriefing
        planningSignals={[]}
        geospatialSourceCards={[]}
        sourceSnapshots={undefined}
      />
    );

    expect(screen.getByText("Census retrieval URL not captured for this run.")).toBeInTheDocument();
    expect(screen.getByText("Fetched: Unknown")).toBeInTheDocument();
    // An absent crash source is a coverage gap, stated as one — and explicitly
    // not presentable as "no crashes occurred here".
    expect(screen.getByText(/No crash source answered for this study area/)).toBeInTheDocument();
    expect(screen.getByText(/not a finding that no crashes occurred/)).toBeInTheDocument();
    expect(screen.getByText("Census tract geometry + choropleth overlays")).toBeInTheDocument();
  });

  it("never points a planner at SWITRS, which was retired on 2025-01-08", () => {
    const { container } = render(
      <ExploreGeospatialBriefing
        planningSignals={[]}
        geospatialSourceCards={[]}
        sourceSnapshots={{ crashes: { source: "ccrs-ca", label: "CCRS (California)" } }}
      />
    );

    expect(container.textContent).not.toMatch(/SWITRS/i);
  });
});

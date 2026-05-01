import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExploreGeospatialBriefing } from "@/app/(app)/explore/_components/explore-geospatial-briefing";

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
            status: "Local extract",
            detail: "SWITRS rows are available for the safety lane.",
            tone: "success",
          },
        ]}
        sourceSnapshots={{
          census: {
            retrievalUrl: "https://api.census.gov/example",
            fetchedAt: "2026-04-20T08:00:00.000Z",
          },
          crashes: {
            source: "switrs-local",
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
    expect(screen.getByText("Local extract")).toBeInTheDocument();
    expect(screen.getByText("SWITRS rows are available for the safety lane.")).toBeInTheDocument();
    expect(screen.getByText("https://api.census.gov/example")).toBeInTheDocument();
    expect(screen.getByText(/SWITRS-backed safety coverage is active for this corridor run\./)).toBeInTheDocument();
  });

  it("keeps the briefing reviewable when source snapshots are missing", () => {
    render(
      <ExploreGeospatialBriefing
        planningSignals={[]}
        geospatialSourceCards={[]}
        sourceSnapshots={undefined}
      />
    );

    expect(screen.getByText("Census retrieval URL not captured for this run.")).toBeInTheDocument();
    expect(screen.getByText("Fetched: Unknown")).toBeInTheDocument();
    expect(screen.getByText(/Current crash source: Unknown\./)).toBeInTheDocument();
    expect(screen.getByText(/SWITRS remains the preferred California-grade upgrade path/)).toBeInTheDocument();
    expect(screen.getByText("Census tract geometry + choropleth overlays")).toBeInTheDocument();
  });
});

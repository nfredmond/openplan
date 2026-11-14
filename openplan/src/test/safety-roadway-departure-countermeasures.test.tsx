/**
 * Defect D6 (2026-11 rehearsal): in Sierra County 111 of 145 mapped non-PDO
 * crashes were hit object or overturn, and the countermeasure picker offered one
 * roadway-departure item. FHWA's Proven Safety Countermeasures list, read
 * 2026-11-13, names six roadway-departure items. Every segment's picker must
 * offer all six, for a place with road lines and full severity (a state file
 * such as CCRS) and for a fatal-only place ranked by half-mile squares (FARS).
 *
 * The picker does not match countermeasures to crash types: it offers the
 * whole list to every segment, and a ranked segment does not carry the manner
 * of collision of its crashes. FARS stores no manner of collision at all
 * (`collision_type` is not supplied). So "offered" here means "listed and
 * selectable in that segment's picker", never "ranked first".
 *
 * Blind category: this does not prove the FHWA pages still say what the
 * catalog records; the catalog's retrieval note carries that [VERIFY]. jsdom
 * has no layout, so it cannot prove the items are visible without scrolling.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HighInjuryNetworkPanel } from "@/components/safety/high-injury-network-panel";
import { HIGH_INJURY_NETWORK_PARAMETERS, type HighInjuryNetwork } from "@/lib/safety/high-injury-network";
import { SAFETY_COUNTERMEASURES } from "@/lib/safety/countermeasures";

const INGEST_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** The six roadway-departure items on FHWA's list page, read 2026-11-13. */
const FHWA_ROADWAY_DEPARTURE = [
  "Enhanced Delineation for Horizontal Curves",
  "Longitudinal Rumble Strips and Stripes on Two-Lane Roads",
  "Median Barriers",
  "Roadside Design Improvements at Curves",
  "SafetyEdge℠",
  "Wider Edge Lines",
];

/** A state-file place: full severity, road lines from TIGER/Line. */
function stateFileNetwork(): HighInjuryNetwork {
  return {
    status: "computed",
    basis: "ksi",
    method: "road_segments",
    years: [2022, 2023, 2024],
    segments: [
      {
        id: "road:00c0ffee:0",
        rank: 1,
        tied: false,
        label: "State Route 49",
        geometry: { type: "LineString", coordinates: [[-120.6, 39.6], [-120.59, 39.6]] },
        lengthMiles: 0.5,
        crashCount: 4,
        fatalCrashCount: 1,
        seriousInjuryCrashCount: 3,
        crashesPerMile: 8,
        roadSource: "U.S. Census TIGER/Line roads 2025-01-01",
      },
    ],
    crashesConsidered: 4,
    crashesPlaced: 4,
    segmentsWithCrashes: 1,
    roadMilesReviewed: 3,
    listedMiles: 0.5,
    listedCrashes: 4,
    roadSources: ["U.S. Census TIGER/Line roads 2025-01-01"],
    parameters: HIGH_INJURY_NETWORK_PARAMETERS,
  };
}

/** A fatal-only place with no road lines, ranked by half-mile squares. */
function fatalOnlyGridNetwork(): HighInjuryNetwork {
  return {
    status: "computed",
    basis: "fatal_only",
    method: "grid_cells",
    years: [2022, 2023, 2024],
    segments: [
      {
        id: "grid:-14972:6143",
        rank: 1,
        tied: false,
        label: "Half-mile square at 37.94500, -114.38015",
        geometry: { type: "Polygon", coordinates: [[[-114.39, 37.94], [-114.38, 37.94], [-114.38, 37.95], [-114.39, 37.95], [-114.39, 37.94]]] },
        lengthMiles: null,
        crashCount: 2,
        fatalCrashCount: 2,
        seriousInjuryCrashCount: null,
        crashesPerMile: null,
        roadSource: null,
      },
    ],
    crashesConsidered: 2,
    crashesPlaced: 2,
    segmentsWithCrashes: 1,
    roadMilesReviewed: null,
    listedMiles: null,
    listedCrashes: 2,
    roadSources: [],
    parameters: HIGH_INJURY_NETWORK_PARAMETERS,
  };
}

function renderPanel(network: HighInjuryNetwork, sourceLabel: string) {
  render(
    <HighInjuryNetworkPanel
      network={network}
      sourceLabel={sourceLabel}
      showOnMap
      onShowOnMapChange={vi.fn()}
      onFocusSegment={vi.fn()}
      ingestId={INGEST_ID}
      reports={[{ id: "report-a", title: "Plan A", safetyActionPlan: null }]}
      saveRequest={vi.fn().mockResolvedValue({ ok: true })}
    />,
  );
}

afterEach(() => cleanup());

describe.each([
  ["a state-file place ranked by road segment", stateFileNetwork, "California Crash Reporting System (CCRS)"],
  ["a fatal-only place ranked by half-mile square", fatalOnlyGridNetwork, "NHTSA Fatality Analysis Reporting System (FARS)"],
])("the countermeasure picker for %s", (_label, build, sourceLabel) => {
  it("offers every FHWA roadway-departure item, selectable", () => {
    renderPanel(build(), sourceLabel);
    const row = screen.getAllByTestId("safety-hin-row")[0];
    for (const name of FHWA_ROADWAY_DEPARTURE) {
      const box = within(row).getByRole("checkbox", { name });
      fireEvent.click(box);
      expect((box as HTMLInputElement).checked, name).toBe(true);
    }
    expect(within(row).getByText(`Countermeasures (${FHWA_ROADWAY_DEPARTURE.length})`)).toBeTruthy();
  });

  it("hides no catalog item behind a default", () => {
    renderPanel(build(), sourceLabel);
    const row = screen.getAllByTestId("safety-hin-row")[0];
    expect(within(row).getAllByRole("checkbox")).toHaveLength(SAFETY_COUNTERMEASURES.length);
  });
});

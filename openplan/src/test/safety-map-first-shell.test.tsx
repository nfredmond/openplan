/**
 * MOVING THE PANELS MUST NOT DROP A CAVEAT.
 *
 * ═══ WHY THIS FILE EXISTS ═══
 *
 * Safety was rebuilt from a scrolling stack of cards with a 520px map two thirds
 * of the way down it into a map that fills the surface with a docked sidebar.
 * Every panel moved. Safety's caveats are not decoration — the RTP and grant
 * lanes cite these figures, and each one is qualified by a sentence that must
 * travel with it: a live read is not a saved acquisition, a fatality census
 * records nothing but fatalities, a source that cannot separate KABCO A cannot
 * produce a KSI, property-damage counts are not comparable between agencies,
 * collisions with no casualty count belong to no severity band, an empty map is
 * not evidence that no crashes occurred.
 *
 * A layout change is exactly the kind of edit that quietly drops one of those
 * sentences while every other test stays green, because no other test asserts
 * the whole set at once. This one enumerates them.
 *
 * ═══ WHAT THIS FILE CANNOT PROVE ═══
 *
 * jsdom applies no stylesheet, has no box model and does not run Mapbox GL. It
 * cannot show that the map fills the surface, that the sidebar scrolls on its
 * own, or that anything is visible. Those were measured in a real browser: at
 * 1600×900 the map went from 558×210 to 558×457 (the full height the app shell
 * leaves), and at 390×844 the shell becomes one scrolling column with a 256px
 * map on top. What is proved here is that every panel and every sentence is
 * still rendered and still attached to its figure.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SafetyWorkspace } from "@/components/safety/safety-workspace";
import { resolvePublicBasemapConfig } from "@/lib/cartographic/basemaps";
import {
  SAFETY_CRASH_DATA_CAVEAT,
  SAFETY_FATAL_ONLY_CAVEAT,
  SAFETY_LIVE_READ_CAVEAT,
  SAFETY_PDO_COMPARABILITY_CAVEAT,
  SAFETY_SEVERITY_COMPLETENESS_CAVEAT,
  SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT,
} from "@/lib/safety/caveats";
import type { SafetyIngestSummary } from "@/lib/safety/client-types";

// The map is Mapbox-backed and jsdom runs no WebGL; the crash map's own
// behaviour is under test in `safety-map-first-crash-map.test.tsx`.
vi.mock("@/components/safety/safety-crash-map", () => ({
  // The real module also exports the z-order anchor the workspace hands to
  // `useWorkspaceGisMapBinding`. A factory mock replaces the WHOLE module, so
  // omitting it makes the import `undefined` and the render throws — which is
  // how a stub silently becomes the thing under test.
  safetyWorkspaceGisAnchorLayerId: () => undefined,
  SafetyCrashMap: ({
    styleUrl,
    onSelect,
  }: {
    styleUrl: string;
    onSelect?: (id: string | null) => void;
  }) => (
    <div data-testid="safety-crash-map" data-style-url={styleUrl}>
      {/* Stands in for clicking a dot. The real map calls exactly this. */}
      <button onClick={() => onSelect?.("crash-7")}>click-a-collision</button>
    </div>
  ),
}));

// The shared any-US-place picker, stood in for so a study area can be chosen
// without driving the TIGERweb search.
vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: ({
    onCorridorChange,
    onPlaceResolved,
  }: {
    onCorridorChange: (t: string) => void;
    onPlaceResolved?: (p: unknown) => void;
  }) => {
    const shape = JSON.stringify({
      type: "Polygon",
      coordinates: [
        [
          [-83.2, 39.8],
          [-82.8, 39.8],
          [-82.8, 40.1],
          [-83.2, 40.1],
          [-83.2, 39.8],
        ],
      ],
    });
    return (
      <button
        onClick={() => {
          onCorridorChange(shape);
          onPlaceResolved?.({ kind: "county", geoid: "39049", label: "Franklin County" });
        }}
      >
        pick-a-county
      </button>
    );
  },
}));

const BASEMAPS = resolvePublicBasemapConfig({ mapboxToken: "pk.test", env: {} });

function ingest(over: Partial<SafetyIngestSummary> = {}): SafetyIngestSummary {
  return {
    id: "ingest-1",
    sourceLabel: "NHTSA Fatality Analysis Reporting System (FARS)",
    attribution: null,
    coverageState: "fars_us_national",
    severityCompleteness: "fatal_only",
    status: "ready",
    crashCount: 120,
    geocodedCount: 96,
    truncated: true,
    yearsRequested: [2023, 2022],
    fetchError: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    ...over,
  };
}

function renderWorkspace(props: Partial<Parameters<typeof SafetyWorkspace>[0]> = {}) {
  return render(
    <SafetyWorkspace
      workspaceId="workspace-1"
      latestIngest={null}
      basemapChoices={BASEMAPS.choices}
      defaultBasemapId={BASEMAPS.defaultId}
      {...props}
    />
  );
}

beforeEach(() => {
  vi.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({
      type: "FeatureCollection",
      features: [],
      returnedCount: 0,
      matchedCount: 0,
      undrawableCount: 0,
    }),
  } as unknown as Response);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the map-first shell", () => {
  it("puts the map and the controls on the same screen", () => {
    renderWorkspace();

    const shell = screen.getByTestId("safety-map-first-shell");
    const stage = screen.getByTestId("safety-map-stage");
    const sidebar = screen.getByTestId("safety-sidebar");

    // Both are children of the one shell: a sidebar rendered outside it would be
    // the old stacked page wearing new test ids.
    expect(shell).toContainElement(stage);
    expect(shell).toContainElement(sidebar);
    expect(stage).toContainElement(screen.getByTestId("safety-crash-map"));
  });

  it("keeps the module's one primary action, in the header card, inside the sidebar", () => {
    renderWorkspace();

    const actions = document.querySelectorAll(".module-intro-action");
    expect(actions).toHaveLength(1);
    const action = actions[0];
    expect(action.closest(".module-intro-actions")).not.toBeNull();
    expect(action.closest(".module-intro-card")).not.toBeNull();
    expect(screen.getByTestId("safety-sidebar")).toContainElement(action as HTMLElement);
    expect(action.textContent).toContain("Retrieve crash data");
  });

  it("hands the map the background the deployment opens on, and switches it", async () => {
    renderWorkspace();

    const defaultChoice = BASEMAPS.choices.find((choice) => choice.id === BASEMAPS.defaultId);
    expect(screen.getByTestId("safety-crash-map").dataset.styleUrl).toBe(defaultChoice?.styleUrl);

    // Through the real picker, not by calling a handler: a control nobody can
    // reach is this repo's most-repeated defect.
    fireEvent.click(screen.getByRole("button", { name: /map background/i }));
    const other = BASEMAPS.choices.find((choice) => choice.id !== BASEMAPS.defaultId);
    if (!other) throw new Error("the basemap fixture offers no second background");
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(other.label, "i") }));

    await waitFor(() =>
      expect(screen.getByTestId("safety-crash-map").dataset.styleUrl).toBe(other.styleUrl)
    );
  });

  it("says what the colours on the map mean, including the band that is not a rung", () => {
    renderWorkspace();

    /*
      EXACTLY TWO, and the count is the assertion rather than a floor. One is
      docked over the map from `lg` up; the other sits in the column and is the
      only one a phone gets, because the docked version covered a third of a
      256px map at 390×844. A change that deletes the second leaves the key
      perfectly fine on a laptop and gone on a phone — a difference jsdom cannot
      see any other way, since it applies no media queries and no stylesheet.
    */
    const keys = screen.getAllByTestId("safety-severity-key");
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key.textContent).toContain("Fatal");
      expect(key.textContent).toContain("Property damage only");
      expect(key.textContent).toContain("Not classified");
    }
  });
});

describe("every caveat survived the move", () => {
  it("carries the whole disclosure set for a stored fatality-census retrieval", async () => {
    renderWorkspace({ latestIngest: ingest(), studyArea: {
      corridorText: JSON.stringify({
        type: "Polygon",
        coordinates: [[[-83.2, 39.8], [-82.8, 39.8], [-82.8, 40.1], [-83.2, 40.1], [-83.2, 39.8]]],
      }),
      place: null,
      label: "Saved study area",
      origin: "project",
      originLabel: "Saved project",
    } });

    // The source, and what it covers.
    //
    // `findAllBy`, not `findBy`: as of 2026-08-13 the source's name appears
    // TWICE on purpose. The coverage banner names it, and so does the
    // mapped-area note under the study-area picker — which used to say "Pick a
    // California county" to every workspace on earth and now attributes the
    // ungeocoded crashes to whichever source actually reported them. Two
    // mentions of the real source is the correct state; one was the bug.
    expect(
      (await screen.findAllByText(/NHTSA Fatality Analysis Reporting System/)).length
    ).toBeGreaterThan(0);
    expect(screen.getByText(/120 reported · 96 mappable/)).toBeInTheDocument();
    // A fatality census records nothing else.
    expect(screen.getByText(SAFETY_FATAL_ONLY_CAVEAT)).toBeInTheDocument();
    // The geocoding shortfall, computed from THIS extract rather than a constant.
    expect(screen.getByText(/24 of the 120 reported crashes/)).toBeInTheDocument();
    // The record cap.
    expect(screen.getByText(/Retrieval stopped at the record cap/)).toBeInTheDocument();
    // Property damage is withheld by default, and the sentence saying why.
    expect(screen.getByText(SAFETY_PDO_COMPARABILITY_CAVEAT)).toBeInTheDocument();
    // What the bracketed counts in the filter panel are counts OF.
    expect(screen.getByText(/Counts are of the collisions currently on the map/)).toBeInTheDocument();
    // And the standing statement about what crash data is.
    expect(screen.getByText(new RegExp(SAFETY_CRASH_DATA_CAVEAT.slice(0, 60)))).toBeInTheDocument();
  });

  it("never lets an empty map read as a finding", () => {
    renderWorkspace();
    fireEvent.click(screen.getByText("pick-a-county"));

    expect(
      screen.getByText(/that is not evidence that no crashes occurred/i)
    ).toBeInTheDocument();
  });

  it("distinguishes a failed lookup from an absence of crashes", () => {
    renderWorkspace({ ingestsReadFailed: true });
    fireEvent.click(screen.getByText("pick-a-county"));

    expect(screen.getByText(/That is a failed lookup, not a finding/)).toBeInTheDocument();
  });

  it("keeps the live-read, completeness and unclassified sentences reachable", async () => {
    // A live read is the state with the most caveats attached to it, and the one
    // a layout change is most likely to strand: nothing is stored, so every
    // sentence about it exists only on this screen.
    vi.spyOn(global, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/ingest")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: "read_only",
            sourceLabel: "A state crash source",
            coverageState: "read_only_lane",
            severityCompleteness: "fatal_injury_only",
            crashCount: 3,
            geocodedCount: 3,
            truncated: false,
            yearsCovered: [],
            crashes: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: { type: "Point", coordinates: [-83, 39.9] },
                  properties: {
                    id: "c1",
                    externalId: "E1",
                    sourceId: "state",
                    severity: "unknown",
                    collisionDate: "2024-01-02",
                    collisionYear: 2024,
                    killedCount: null,
                    injuredCount: null,
                  },
                },
              ],
            },
          }),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          type: "FeatureCollection",
          features: [],
          returnedCount: 0,
          matchedCount: 0,
          undrawableCount: 0,
        }),
      } as unknown as Response);
    });

    renderWorkspace();
    fireEvent.click(screen.getByText("pick-a-county"));
    fireEvent.click(screen.getByRole("button", { name: /retrieve crash data/i }));

    expect(await screen.findByText(SAFETY_LIVE_READ_CAVEAT)).toBeInTheDocument();
    expect(screen.getByText(SAFETY_SEVERITY_COMPLETENESS_CAVEAT)).toBeInTheDocument();
    // No year came back, and that is stated rather than left as a small number.
    expect(screen.getByText(/No records came back for any year requested/)).toBeInTheDocument();
    // The collision on screen carries no casualty count from the source.
    expect(
      screen.getByText(new RegExp(SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT.slice(0, 60)))
    ).toBeInTheDocument();
  });

  it("opens the clicked collision in the sidebar, with its absences named", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-83, 39.9] },
            properties: {
              id: "crash-7",
              externalId: "EXT-7",
              sourceId: "fars-us",
              severity: "fatal",
              collisionDate: "2024-05-06",
              collisionYear: 2024,
              killedCount: 1,
              injuredCount: null,
            },
          },
        ],
        returnedCount: 1,
        matchedCount: 1,
        undrawableCount: 0,
      }),
    } as unknown as Response);

    renderWorkspace({ latestIngest: ingest() });
    fireEvent.click(screen.getByText("pick-a-county"));

    await screen.findByText(/Showing 1 of 1 crashes/);

    // The selection is made the way the map makes it — through the callback the
    // stage is handed — and the record has to open in the SIDEBAR, because the
    // map now covers the space the old detail card sat under.
    fireEvent.click(screen.getByText("click-a-collision"));

    const record = await screen.findByRole("region", { name: /selected collision/i });
    expect(screen.getByTestId("safety-sidebar")).toContainElement(record);
    expect(record.textContent).toContain("EXT-7");
    // Never a fabricated zero for a count the source did not supply.
    expect(record.textContent).toContain("not reported");
    expect(record.textContent).toContain(
      "Fields shown as not reported are absent from the source record, not zero."
    );
  });
});

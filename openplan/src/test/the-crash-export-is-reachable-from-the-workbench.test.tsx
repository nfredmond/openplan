import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/safety/safety-crash-map", () => ({
  // The real module also exports the z-order anchor the workspace hands to
  // `useWorkspaceGisMapBinding`. A factory mock replaces the WHOLE module, so
  // omitting it makes the import `undefined` and the render throws — which is
  // how a stub silently becomes the thing under test.
  safetyWorkspaceGisAnchorLayerId: () => undefined,
  SafetyCrashMap: () => <div data-testid="safety-crash-map" />,
}));

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
          [-121.3, 39.1],
          [-120.3, 39.1],
          [-120.3, 39.6],
          [-121.3, 39.6],
          [-121.3, 39.1],
        ],
      ],
    });
    return (
      <button
        onClick={() => {
          onCorridorChange(shape);
          onPlaceResolved?.({
            kind: "county",
            geoid: "06057",
            label: "Nevada County",
            geojson: JSON.parse(shape),
            bbox: {},
          });
        }}
      >
        pick-ca-county
      </button>
    );
  },
}));

import { SafetyWorkspace } from "@/components/safety/safety-workspace";
import type { SafetyIngestSummary } from "@/lib/safety/client-types";

/**
 * THE SHIPPED-INVISIBLE DEFECT CLASS, guarded for this feature specifically.
 *
 * `every-api-route-has-a-caller.test.ts` does NOT catch a broken export here,
 * and that is measured, not assumed: two mutations — pointing the button at the
 * map route instead of the export route, and deleting the button from the
 * workbench entirely — both left that guard green. Its matcher cannot separate
 * `/api/safety/crashes/export` from the `/api/safety/crashes` call sitting a few
 * lines away, which is the substring blind spot the caller guard is known to
 * have. A route with a "caller" that is really a different route's caller is
 * exactly the eleven-times-over defect this repository keeps shipping.
 *
 * So the reachability claim is made where only the real surface can answer it:
 * render the actual Safety workbench, click the actual control, and assert on
 * the URL the browser was actually sent to.
 */

function ingest(over: Partial<SafetyIngestSummary> = {}): SafetyIngestSummary {
  return {
    id: "ingest-1",
    sourceLabel: "California Crash Reporting System (CCRS)",
    attribution: "California Highway Patrol, CCRS (public domain).",
    coverageState: "ccrs_ca_statewide",
    severityCompleteness: "kabco_full",
    status: "ready",
    crashCount: 1180,
    geocodedCount: 1089,
    truncated: false,
    yearsRequested: [2025],
    fetchError: null,
    createdAt: "2026-07-23T00:00:00.000Z",
    ...over,
  };
}

function crashResponse(matchedCount: number) {
  return {
    ok: true,
    json: async () => ({
      type: "FeatureCollection",
      features: [],
      returnedCount: 0,
      matchedCount,
      undrawableCount: 0,
      truncated: false,
      limit: 2000,
    }),
  } as Response;
}

/** The href the button navigates to, captured without navigating. */
let navigatedTo: string | null = null;

describe("a planner can actually download the crashes they are looking at", () => {
  beforeEach(() => {
    navigatedTo = null;
    vi.stubGlobal("fetch", vi.fn(async () => crashResponse(1089)) as unknown as typeof fetch);
    // jsdom refuses real navigation; intercepting the assignment is also how the
    // URL becomes assertable, which is the whole point of this file.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        set href(value: string) {
          navigatedTo = value;
        },
        get href() {
          return navigatedTo ?? "http://localhost/";
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("offers CSV and GeoJSON on the Safety workbench once a study area is set", async () => {
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest()} />);
    fireEvent.click(screen.getByText("pick-ca-county"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Download CSV/ })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Download GeoJSON/ })).toBeInTheDocument();
  });

  it("sends the browser to the EXPORT route, carrying the workbench's own filters", async () => {
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest()} />);
    fireEvent.click(screen.getByText("pick-ca-county"));
    await waitFor(() => screen.getByRole("button", { name: /Download CSV/ }));

    fireEvent.click(screen.getByRole("button", { name: /Download CSV/ }));

    expect(navigatedTo).not.toBeNull();
    const url = new URL(navigatedTo!, "http://localhost");
    // The EXPORT route, not the capped map route it sits beside.
    expect(url.pathname).toBe("/api/safety/crashes/export");
    expect(url.searchParams.get("format")).toBe("csv");
    expect(url.searchParams.get("workspaceId")).toBe("ws-1");
    // The extent the planner is looking at, so the file matches the screen.
    expect(url.searchParams.get("minLon")).toBe("-121.3");
    expect(url.searchParams.get("maxLat")).toBe("39.6");
    // And the workbench's live filter selection — the workbench opens with
    // property-damage-only switched off, so the export must inherit that or the
    // file silently contains a category the screen does not.
    const severity = url.searchParams.get("severity");
    expect(severity).toBeTruthy();
    expect(severity!.split(",")).not.toContain("pdo");
    expect(severity!.split(",")).toContain("fatal");
  });

  it("asks for GeoJSON when GeoJSON is what was clicked", async () => {
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest()} />);
    fireEvent.click(screen.getByText("pick-ca-county"));
    await waitFor(() => screen.getByRole("button", { name: /Download GeoJSON/ }));

    fireEvent.click(screen.getByRole("button", { name: /Download GeoJSON/ }));
    expect(new URL(navigatedTo!, "http://localhost").searchParams.get("format")).toBe("geojson");
  });

  it("says why the control is unavailable rather than greying out in silence", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => crashResponse(0)) as unknown as typeof fetch);
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest()} />);
    fireEvent.click(screen.getByText("pick-ca-county"));

    await waitFor(() => {
      expect(screen.getByText(/Nothing matches these filters in this extent yet/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Download CSV/ })).toBeDisabled();
  });
});

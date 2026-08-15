import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SafetyWorkspace } from "@/components/safety/safety-workspace";
import type { SafetyIngestHistoryEntry } from "@/lib/safety/client-types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/safety",
}));

vi.mock("mapbox-gl", () => ({ default: { Map: class {}, Marker: class {}, Popup: class {} } }));

/**
 * A CRASH COUNT MUST SAY WHAT AREA IT COVERS.
 *
 * WHERE THIS CAME FROM. A tester filed a blocker on 2026-08-15: crash counts
 * were attached to a project with no way to see what place they covered. The
 * import history listed source, years, counts and status and said nothing about
 * where — so an acquisition covering one corridor read identically to one
 * covering a whole county, and a planner could not tell whether an
 * already-attached count described their project.
 *
 * The extent had been recorded in the database the whole time. It was not in the
 * `.select()`, not on the client type, and never reached the screen.
 *
 * WHAT IS ASSERTED, and the second one is the point:
 *   - a recorded extent is stated;
 *   - an import with NO recorded extent says so, rather than rendering as an
 *     area of zero. "We did not record where" and "it covered nothing" are
 *     different statements, and a 0 km² crash pull is the more flattering and
 *     less true of the two.
 *
 * NOT ASSERTED: any place NAME. The pull stores a bounding box and sometimes a
 * county code; no place label is recorded when the request is made. Guessing a
 * name from a code would be the invention this repository exists to avoid.
 */
const BASE: SafetyIngestHistoryEntry = {
  id: "ing-1",
  projectId: null,
  sourceLabel: "Example source",
  coverageState: "complete",
  status: "succeeded",
  crashCount: 120,
  geocodedCount: 118,
  yearsRequested: [2023],
  scope: null,
  createdAt: "2026-01-02T00:00:00.000Z",
};

function renderHistory(history: SafetyIngestHistoryEntry[]) {
  render(
    <SafetyWorkspace
      workspaceId="w1"
      ingestHistory={history}
      projects={[]}
      basemapChoices={[]}
      defaultBasemapId={null}
    />
  );
  return screen.getByRole("region", { name: /import history/i });
}

describe("an import says what area it covered", () => {
  it("states the extent when one was recorded", () => {
    const list = renderHistory([
      // Roughly a county-sized box.
      { ...BASE, scope: { minLon: -121.6, minLat: 38.4, maxLon: -121.2, maxLat: 38.7, countyCode: 6067 } },
    ]);
    expect(list.textContent).toMatch(/covers ≈/);
    expect(list.textContent).toMatch(/km²/);
    // The county code is shown AS a code, not dressed up as a place.
    expect(list.textContent).toMatch(/county code 6067/i);
  });

  it("tells a corridor-sized pull apart from a county-sized one", () => {
    const list = renderHistory([
      { ...BASE, id: "small", scope: { minLon: -121.5, minLat: 38.58, maxLon: -121.49, maxLat: 38.59, countyCode: null } },
      { ...BASE, id: "big", scope: { minLon: -121.9, minLat: 38.2, maxLon: -121.0, maxLat: 38.9, countyCode: null } },
    ]);
    const areas = [...list.textContent!.matchAll(/covers ≈ ([\d,.]+) km²/g)].map((m) =>
      Number(m[1].replace(/,/g, ""))
    );
    expect(areas).toHaveLength(2);
    // If both rendered the same number the display would not answer the question
    // the tester actually had.
    expect(areas[0]).not.toBe(areas[1]);
  });

  it("says the area was not recorded, rather than showing zero", () => {
    const list = renderHistory([{ ...BASE, scope: null }]);
    expect(list.textContent).toMatch(/area not recorded/i);
    expect(list.textContent).not.toMatch(/≈ 0 km²/);
  });
});

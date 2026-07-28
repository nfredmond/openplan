import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudyAreaPicker } from "@/components/models/study-area-picker";

/**
 * The shared any-place picker is CONTROLLED, and it is no longer the only thing
 * that can set the text it is controlled by: Analysis Studio also accepts an
 * uploaded boundary file and reloads the corridor of a past run. This suite is
 * about naming the area honestly when that happens — the picker must not keep a
 * place name it chose earlier on a boundary somebody else supplied, and it must
 * be able to show a name the caller vouches for.
 */

const BOUNDARY = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-83.2, 39.8],
      [-82.8, 39.8],
      [-82.8, 40.1],
      [-83.2, 40.1],
      [-83.2, 39.8],
    ],
  ],
};

const OTHER_BOUNDARY = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-97.9, 30.1],
      [-97.5, 30.1],
      [-97.5, 30.4],
      [-97.9, 30.4],
      [-97.9, 30.1],
    ],
  ],
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/geographies/places")) {
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              kind: "county",
              geoid: "99999",
              label: "Example County, ZZ",
              description: "County",
              stateFips: "99",
            },
          ],
          unavailableKinds: [],
          searchUnavailable: false,
          unavailableReason: null,
        }),
      };
    }
    if (url.startsWith("/api/geographies/place-boundary")) {
      return {
        ok: true,
        json: async () => ({
          kind: "county",
          geoid: "99999",
          label: "Example County, ZZ",
          geojson: BOUNDARY,
          bbox: { minLon: -83.2, minLat: 39.8, maxLon: -82.8, maxLat: 40.1 },
        }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Search for a place and take the first result, as a planner would. */
async function pickTheFirstResult() {
  fireEvent.change(screen.getByLabelText("Search for a place"), { target: { value: "example" } });
  await waitFor(() => expect(screen.getByText("Example County, ZZ")).toBeInTheDocument());
  fireEvent.click(screen.getByText("Example County, ZZ"));
}

describe("StudyAreaPicker", () => {
  it("names an area it chose itself", async () => {
    const onCorridorChange = vi.fn();
    const { rerender } = render(
      <StudyAreaPicker corridorText="" onCorridorChange={onCorridorChange} />
    );

    await pickTheFirstResult();

    await waitFor(() => expect(onCorridorChange).toHaveBeenCalledWith(JSON.stringify(BOUNDARY)));
    rerender(
      <StudyAreaPicker corridorText={JSON.stringify(BOUNDARY)} onCorridorChange={onCorridorChange} />
    );
    expect(screen.getByText("Example County, ZZ")).toBeInTheDocument();
  });

  it("drops its own label when the area is replaced from outside", async () => {
    const onCorridorChange = vi.fn();
    const { rerender } = render(
      <StudyAreaPicker corridorText="" onCorridorChange={onCorridorChange} />
    );

    await pickTheFirstResult();
    await waitFor(() => expect(onCorridorChange).toHaveBeenCalled());
    rerender(
      <StudyAreaPicker corridorText={JSON.stringify(BOUNDARY)} onCorridorChange={onCorridorChange} />
    );

    // Something else — an uploaded file, a reloaded run — sets a different area.
    rerender(
      <StudyAreaPicker
        corridorText={JSON.stringify(OTHER_BOUNDARY)}
        onCorridorChange={onCorridorChange}
      />
    );

    expect(screen.queryByText("Example County, ZZ")).not.toBeInTheDocument();
    expect(screen.getByText("Custom study area")).toBeInTheDocument();
  });

  it("shows the caller's label for an area it did not choose", () => {
    render(
      <StudyAreaPicker
        corridorText={JSON.stringify(BOUNDARY)}
        onCorridorChange={vi.fn()}
        externalLabel="Example County, ZZ"
      />
    );

    expect(screen.getByText("Example County, ZZ")).toBeInTheDocument();
    expect(screen.queryByText("Custom study area")).not.toBeInTheDocument();
  });

  it("falls back to a custom-area label rather than borrowing a name", () => {
    render(<StudyAreaPicker corridorText={JSON.stringify(BOUNDARY)} onCorridorChange={vi.fn()} />);

    expect(screen.getByText("Custom study area")).toBeInTheDocument();
  });
});

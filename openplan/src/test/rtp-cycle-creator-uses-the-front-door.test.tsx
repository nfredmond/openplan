/**
 * THE CYCLE CREATOR USES THE ONE GEOGRAPHY FRONT DOOR.
 *
 * Until 2026-08-10 a planner creating an RTP cycle typed a free-text label and
 * hand-copied latitude/longitude into two raw inputs — while every other
 * module resolves any US county / city / CDP / metro through StudyAreaPicker
 * (the "do not build a second geography selector" non-negotiable). The picker
 * now fills the label and pin from a resolved place; both stay editable,
 * because "Countywide, including unincorporated areas" is a legitimate label
 * no gazetteer returns.
 *
 * The picker itself is stubbed: it has its own tests, and this file's subject
 * is the WIRING — so, per the a-wiring-test-must-vary-the-binding lesson, two
 * DIFFERENT places are resolved and each must land its own values. One fixture
 * cannot tell "threads the binding" from "hardcodes its value".
 */
import { fireEvent, render, screen, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaceBoundaryResponse } from "@/lib/api/place-geographies";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

let capturedOnPlaceResolved: ((place: PlaceBoundaryResponse | null) => void) | undefined;
let capturedShowRunEngineHint: boolean | undefined;

vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: (props: {
    onPlaceResolved?: (place: PlaceBoundaryResponse | null) => void;
    showRunEngineHint?: boolean;
  }) => {
    capturedOnPlaceResolved = props.onPlaceResolved;
    capturedShowRunEngineHint = props.showRunEngineHint;
    return <div data-testid="study-area-picker-stub" />;
  },
}));

import { RtpCycleCreator } from "@/components/rtp/rtp-cycle-creator";

function place(overrides: Partial<PlaceBoundaryResponse>): PlaceBoundaryResponse {
  return {
    kind: "county",
    geoid: "39049",
    label: "Franklin County, OH",
    geojson: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    bbox: { minLon: -83.2, minLat: 39.8, maxLon: -82.8, maxLat: 40.2 },
    ...overrides,
  } as PlaceBoundaryResponse;
}

describe("the RTP cycle creator's geography wiring", () => {
  beforeEach(() => {
    capturedOnPlaceResolved = undefined;
    capturedShowRunEngineHint = undefined;
  });

  it("mounts the front door, without the run-engine hint (no run follows)", () => {
    render(<RtpCycleCreator />);
    expect(screen.getByTestId("study-area-picker-stub")).toBeInTheDocument();
    expect(capturedShowRunEngineHint).toBe(false);
  });

  it("fills the label and pin from EACH resolved place, not from one baked value", () => {
    render(<RtpCycleCreator />);

    act(() => {
      capturedOnPlaceResolved?.(place({}));
    });
    expect(screen.getByLabelText(/Geography label/)).toHaveValue("Franklin County, OH");
    expect(screen.getByLabelText(/Map pin latitude/)).toHaveValue("40.00000");
    expect(screen.getByLabelText(/Map pin longitude/)).toHaveValue("-83.00000");

    // The binding must VARY: a second place lands its own name and midpoint.
    act(() => {
      capturedOnPlaceResolved?.(
        place({
          geoid: "48453",
          label: "Travis County, TX",
          bbox: { minLon: -98.2, minLat: 30.0, maxLon: -97.4, maxLat: 30.6 },
        })
      );
    });
    expect(screen.getByLabelText(/Geography label/)).toHaveValue("Travis County, TX");
    expect(screen.getByLabelText(/Map pin latitude/)).toHaveValue("30.30000");
    expect(screen.getByLabelText(/Map pin longitude/)).toHaveValue("-97.80000");
  });

  it("keeps a custom label when the resolved place carries none", () => {
    render(<RtpCycleCreator />);

    const label = screen.getByLabelText(/Geography label/);
    act(() => {
      capturedOnPlaceResolved?.(place({}));
    });
    // The planner overrides with local wording…
    fireEvent.change(label, { target: { value: "Countywide, including unincorporated areas" } });
    // …and a label-less place must not blank what they wrote.
    act(() => {
      capturedOnPlaceResolved?.(place({ label: null }));
    });
    expect(label).toHaveValue("Countywide, including unincorporated areas");
  });

  it("does nothing for a hand-drawn area, which has no place identity", () => {
    render(<RtpCycleCreator />);
    act(() => {
      capturedOnPlaceResolved?.(null);
    });
    expect(screen.getByLabelText(/Geography label/)).toHaveValue("");
    expect(screen.getByLabelText(/Map pin latitude/)).toHaveValue("");
  });
});

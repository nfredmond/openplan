import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRunScreeningGradeNote } from "@/components/models/model-run-screening-grade-note";
import { ModelRunZoneResolutionPanel } from "@/components/models/model-run-zone-resolution-panel";

afterEach(() => vi.unstubAllGlobals());

// Render both consumers of the actual worker/sketch KPI contract. These tests
// cover interpretation, not producer arithmetic, browser layout, or validation.
describe("screening note agrees with the run's zone-resolution panel", () => {
  it.each([
    { share: 0.2972, percent: "29.7%", supports: false, stored: undefined },
    { share: 0.2972, percent: "29.7%", supports: false, stored: true },
    { share: 0.04, percent: "4.0%", supports: true, stored: false },
    { share: 0.2, percent: "20.0%", supports: true, stored: undefined },
    { share: 0.201, percent: "20.1%", supports: false, stored: undefined },
    { share: 0, percent: "0.0%", supports: true, stored: undefined },
    { share: 1, percent: "100.0%", supports: false, stored: undefined },
  ])(
    "converts $share to $percent with support=$supports and stored=$stored",
    async ({ share, percent, supports, stored }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => ({
          ok: true,
          json: async () =>
            url.endsWith("/kpis")
              ? {
                  kpis: [
                    {
                      kpi_name: "intrazonal_trip_share",
                      value: share,
                      unit: "share",
                      breakdown_json: {
                        zone_count: 5,
                        supports_link_level_validation: stored,
                        interpretation:
                          "Stale stored advice must not determine the current verdict.",
                      },
                    },
                  ],
                }
              : {},
        })),
      );
      const { container } = render(
        <>
          <ModelRunScreeningGradeNote
            modelId="model"
            modelRunId="run"
            engineKey="aequilibrae"
            runStatus="succeeded"
          />
          <ModelRunZoneResolutionPanel modelId="model" modelRunId="run" />
        </>,
      );
      const noteElement = container.querySelector("details")!;
      noteElement.open = true;
      fireEvent(noteElement, new Event("toggle"));
      const note = within(noteElement);
      expect(await note.findByText(percent)).toBeInTheDocument();
      const panel = within(screen.getByTestId("zone-resolution-panel"));
      expect(await panel.findByText(percent)).toBeInTheDocument();
      expect(noteElement.textContent).toContain("(5 zones)");
      expect(noteElement.textContent).not.toContain("Stale stored advice");
      expect(noteElement.textContent).toContain(
        supports
          ? "road-by-road volumes against traffic counts can establish something."
          : "road-by-road volumes against traffic counts cannot establish anything",
      );
      expect(
        panel.getByText(
          supports
            ? "Link comparison is meaningful"
            : "Link comparison cannot settle this",
        ),
      ).toBeInTheDocument();
    },
  );

  it.each([
    { kpis: [] },
    { kpis: [{ kpi_name: "intrazonal_trip_share", value: null }] },
  ])(
    "does not convert absent or unmeasured evidence to zero: $kpis",
    async ({ kpis }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: true, json: async () => ({ kpis }) })),
      );
      const { container } = render(
        <ModelRunScreeningGradeNote
          modelId="model"
          modelRunId="run"
          engineKey="aequilibrae"
          runStatus="succeeded"
        />,
      );
      const details = container.querySelector("details")!;
      details.open = true;
      fireEvent(details, new Event("toggle"));
      expect(
        await screen.findByText(/This run recorded no zone-resolution figure/),
      ).toBeInTheDocument();
      expect(details.textContent).not.toContain("0.0%");
      expect(details.textContent).not.toContain("can establish something");
    },
  );
});

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModelRunHeadlineAnswer } from "@/components/models/model-run-headline-answer";

/**
 * A FINISHED RUN MUST STATE THE THING IT WAS RUN FOR.
 *
 * WHERE THIS CAME FROM. A fresh tester with no knowledge of the codebase was
 * given a planner's brief — "how much traffic, how much driving" — ran a
 * corridor analysis to completion on 2026-08-14, and reported that the finished
 * run never states either number. The numbers were there: a succeeded run
 * stores `total_trips` and `daily_vmt`. They had no panel. `daily_vmt` rendered
 * only inside the ITE trip-generation screen (one engine), and `vmt_per_capita`
 * only inside the CEQA significance screen (a different question, and only when
 * the run is eligible for a determination).
 *
 * WHAT IS ASSERTED, AND WHY EACH ONE EXISTS
 *   - the figures reach the screen at all (the original defect);
 *   - a KPI the run did not record renders as ABSENT, never as 0 — "the model
 *     measured nothing" and "nobody measured this" are different sentences and
 *     zero is the most flattering possible reading of the second;
 *   - a FAILED READ is not an empty result — it says so, and does not claim the
 *     run measured nothing;
 *   - the screening-grade qualification travels WITH the figures rather than
 *     sitting elsewhere on the page, because a number separated from its caveat
 *     is the one that ends up in a report.
 *
 * jsdom applies no stylesheet and has no box model, so nothing here is evidence
 * about where on the page any of it sits — only about what is rendered.
 */
describe("a finished run states what it found", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  function mockKpis(kpis: Array<Record<string, unknown>>) {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ kpis }), { status: 200 })
    );
  }

  it("states the traffic and the driving the run was started for", async () => {
    mockKpis([
      { kpi_name: "total_trips", value: 48213 },
      { kpi_name: "daily_vmt", value: 191884 },
      { kpi_name: "final_gap", value: 0.0007 },
    ]);

    render(<ModelRunHeadlineAnswer modelId="m1" modelRunId="r1" />);

    await screen.findByText(/48,213/);
    expect(screen.getByText(/191,884/)).toBeTruthy();
    expect(screen.getByText(/Trips on an average day/i)).toBeTruthy();
    expect(screen.getByText(/Miles driven on an average day/i)).toBeTruthy();

    // A raw engine key is not an answer to anybody; only declared figures show.
    expect(screen.queryByText(/final_gap/)).toBeNull();
  });

  it("carries the screening-grade qualification with the figures, not elsewhere", async () => {
    mockKpis([{ kpi_name: "daily_vmt", value: 1000 }]);

    render(<ModelRunHeadlineAnswer modelId="m1" modelRunId="r1" />);

    const panel = (await screen.findByLabelText(/what this run found/i)) as HTMLElement;
    expect(panel.textContent).toMatch(/screening-grade/i);
  });

  it("renders a KPI the run never recorded as absent, never as zero", async () => {
    // total_trips is missing entirely — the run measured miles and nothing else.
    mockKpis([{ kpi_name: "daily_vmt", value: 1000 }]);

    render(<ModelRunHeadlineAnswer modelId="m1" modelRunId="r1" />);

    await screen.findByText(/1,000/);
    expect(screen.queryByText(/Trips on an average day/i)).toBeNull();
    const panel = screen.getByLabelText(/what this run found/i);
    expect(panel.textContent).not.toMatch(/\b0\s*trips\b/);
  });

  it("says a failed read is a failed read, not an empty result", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "connection reset" }), { status: 500 })
    );

    render(<ModelRunHeadlineAnswer modelId="m1" modelRunId="r1" />);

    const panel = (await screen.findByLabelText(/what this run found/i)) as HTMLElement;
    await waitFor(() => expect(panel.textContent).toMatch(/could not read/i));
    expect(panel.textContent).toMatch(/failed read, not an empty result/i);
    // It must not assert the run measured nothing.
    expect(panel.textContent).not.toMatch(/did not measure/i);
  });

  it("says so plainly when the engine measured neither figure", async () => {
    mockKpis([{ kpi_name: "zone_count", value: 26 }]);

    render(<ModelRunHeadlineAnswer modelId="m1" modelRunId="r1" />);

    const panel = (await screen.findByLabelText(/what this run found/i)) as HTMLElement;
    await waitFor(() => expect(panel.textContent).toMatch(/did not measure/i));
    expect(panel.textContent).toMatch(/expected for some of them/i);
  });
});

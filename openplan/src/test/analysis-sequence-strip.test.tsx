import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AnalysisSequenceStrip } from "@/components/models/analysis-sequence-strip";
import { ANALYSIS_STEP_IDS, CLAIM_STEP_ID } from "@/components/models/analysis-sequence";
import { SCREENING_GRADE_HELP_HREF, SCREENING_GRADE_SUMMARY } from "@/lib/help/screening-grade";

/**
 * WHAT THE PLANNER ACTUALLY SEES ON THE FOUR ANALYSIS PAGES.
 *
 * jsdom applies no stylesheet and has no box model. NOTHING here says anything
 * about nesting depth, density, line length or layout, and a green run must not
 * be read as saying the strip looks right — that is measured in real Chrome by
 * `qa-harness/openplan-local-card-nesting-audit.js`. What this file checks is
 * what is in the document: the order, the one next step, and the caveat.
 *
 * MUTATION-VERIFIED 2026-08-13.
 */

const EMPTY = {
  areaLabel: null,
  networkCount: 0,
  scenarioSetCount: 0,
  modelCount: 0,
  runCount: 0,
  checkedRunCount: 0,
  unreadable: [],
} as const;

const COMPLETE = {
  areaLabel: "Nevada County, California",
  networkCount: 2,
  scenarioSetCount: 3,
  modelCount: 1,
  runCount: 4,
  checkedRunCount: 1,
  unreadable: [],
} as const;

describe("the analysis sequence strip", () => {
  it("renders all seven steps, in order, numbered", () => {
    render(<AnalysisSequenceStrip facts={EMPTY} currentStepId="model" />);

    const strip = screen.getByTestId("analysis-sequence");
    const items = within(strip).getAllByRole("listitem");
    expect(items).toHaveLength(ANALYSIS_STEP_IDS.length);
    expect(items.map((item) => item.getAttribute("data-testid"))).toEqual(
      ANALYSIS_STEP_IDS.map((id) => `analysis-step-${id}`)
    );

    // The number is rendered, not implied by the list marker — a planner
    // referring to "step four" needs to see a four.
    expect(within(items[3]).getByRole("heading").textContent).toMatch(/^4\./);
  });

  it("points at exactly one next step, and says what the others wait on", () => {
    render(<AnalysisSequenceStrip facts={EMPTY} />);
    const strip = screen.getByTestId("analysis-sequence");

    const states = ANALYSIS_STEP_IDS.map(
      (id) => within(strip).getByTestId(`analysis-step-state-${id}`).textContent
    );
    expect(states.filter((label) => label === "Do this next")).toHaveLength(1);
    expect(states[0]).toBe("Do this next");
    expect(within(strip).getAllByText(/Waiting for/)).toHaveLength(8);
    expect(within(screen.getByTestId("analysis-step-area")).getByRole("link")).toHaveTextContent("Pick the area");
    expect(within(screen.getByTestId("analysis-step-check")).queryByRole("link")).toBeNull();
  });

  it("marks the page the reader is on", () => {
    render(<AnalysisSequenceStrip facts={EMPTY} currentStepId="check" />);
    const step = screen.getByTestId("analysis-step-check");
    expect(within(step).getByText(/you are here/)).toBeTruthy();
    expect(within(screen.getByTestId("analysis-step-model")).queryByText(/you are here/)).toBeNull();
  });

  it("carries the screening-grade caveat on screen, and links to what it means", () => {
    render(<AnalysisSequenceStrip facts={EMPTY} />);
    const claim = screen.getByTestId(`analysis-step-${CLAIM_STEP_ID}`);
    expect(claim.textContent).toContain(SCREENING_GRADE_SUMMARY);
    const link = within(claim).getByRole("link");
    expect(link.getAttribute("href")).toBe(SCREENING_GRADE_HELP_HREF);
  });

  it("still carries it when every step before it is done", () => {
    // A finished checklist reads as permission. It must not read as permission
    // here: a validated screening run is still a screening run.
    render(<AnalysisSequenceStrip facts={COMPLETE} />);
    const claim = screen.getByTestId(`analysis-step-${CLAIM_STEP_ID}`);
    expect(claim.textContent).toContain(SCREENING_GRADE_SUMMARY);
    expect(claim.getAttribute("data-state")).not.toBe("done");
    expect(within(screen.getByTestId("analysis-step-check")).getByTestId("analysis-step-state-check").textContent).toBe(
      "Done"
    );
  });

  it("says a fact could not be read rather than calling the work undone", () => {
    render(<AnalysisSequenceStrip facts={{ ...EMPTY, unreadable: ["area"] }} />);
    const area = screen.getByTestId("analysis-step-area");
    expect(within(area).getByTestId("analysis-step-state-area").textContent).toBe("Not known");
    expect(area.textContent).toContain("could not be read");
    expect(area.textContent).not.toContain("Nothing chosen yet");
  });

  it("says Corridor Analysis is not part of this sequence", () => {
    // The finding that produced the strip: /explore sits in the same nav group
    // and writes a different history table. Nothing on any page said so.
    render(<AnalysisSequenceStrip facts={EMPTY} />);
    expect(screen.getByTestId("analysis-sequence").textContent).toContain(
      "Corridor Analysis is not part of this"
    );
  });
});

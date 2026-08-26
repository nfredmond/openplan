import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { ExploreStudyBriefControls } from "@/app/(app)/explore/_components/explore-study-brief-controls";

/**
 * THE FIRST CLICK MUST NOT REFUSE A QUESTION THE PLANNER JUST TYPED.
 *
 * WHERE THIS CAME FROM. Two testers, in separate jobs on 2026-08-15, filled in
 * the analysis question inside the brief sheet, pressed "Run the analysis", and
 * were told to write the question — with the question visible on screen and a
 * "Ready to run" summary directly above the error. Clicking again ran it. One of
 * them described the sheet as sticking; both described the message as
 * contradicting the summary beside it.
 *
 * THE CAUSE was reading the wrong render. The sheet collects the question in its
 * own state, hands it to the workbench, and submits in the same tick. The
 * `canSubmit` / `blockReason` props are computed by the workbench from ITS
 * state, so at that moment they still describe a workbench that has never seen
 * the question. The gate was being asked about the previous render.
 *
 * AND YESTERDAY'S FIX MADE IT WORSE, which is the part worth remembering. Making
 * the refusal name the missing input turned a vague "cannot run" into a specific
 * "write the question" — a precise sentence about something untrue. An accurate
 * description of stale state is still wrong, and it reads as more authoritative.
 *
 * WHAT IS ASSERTED: submitting evaluates the values the sheet COLLECTED. The
 * evaluator is handed the typed question, and a run that should start does start
 * on the first press.
 */
type BriefProps = ComponentProps<typeof ExploreStudyBriefControls>;

function baseProps(overrides: Partial<BriefProps> = {}): BriefProps {
  return {
    queryText: "",
    isQueryTooLong: false,
    reportTemplate: "atp" as const,
    // Deliberately the values from BEFORE the question is typed — this is the
    // stale state the sheet used to trust.
    canSubmit: false,
    blockReason: "Write the question this run should answer. The study area is set.",
    isSubmitting: false,
    analysisRunId: null,
    isGeneratingReport: false,
    isDownloadingPdf: false,
    error: "",
    projects: [],
    selectedProjectId: "",
    onQueryTextChange: vi.fn(),
    onSelectedProjectIdChange: vi.fn(),
    onReportTemplateChange: vi.fn(),
    onRunAnalysis: vi.fn(),
    onGenerateReport: vi.fn(),
    onDownloadPdfReport: vi.fn(),
    ...overrides,
  } as BriefProps;
}

describe("the brief judges what it collected", () => {
  it("asks the evaluator about the question the planner typed, not the stale prop", async () => {
    const typed = "How many people live within a half mile of this corridor?";
    const seen: string[] = [];
    const onRunAnalysis = vi.fn();

    render(
      <ExploreStudyBriefControls
        {...baseProps({
          onRunAnalysis,
          // A run IS possible with this question — the stale props above say
          // otherwise, and the sheet must not believe them.
          evaluateRunBlock: (queryText: string) => {
            seen.push(queryText);
            return queryText.trim().length > 0 ? null : "Write the question this run should answer.";
          },
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /set up the analysis|run the analysis/i }));

    const box = await screen.findByRole("textbox");
    fireEvent.change(box, { target: { value: typed } });

    // Walk to the end of the sheet and submit.
    for (let guard = 0; guard < 6; guard += 1) {
      const next = screen.queryByRole("button", { name: /^next$/i });
      if (!next) break;
      fireEvent.click(next);
    }
    const submit = screen.getByRole("button", { name: /run the analysis/i });
    fireEvent.click(submit);

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    // The evaluator saw the typed question, not the empty prop.
    expect(seen.at(-1)).toBe(typed);
    await waitFor(() => expect(onRunAnalysis).toHaveBeenCalledWith(typed, ""));
  });

  it("still refuses, and says why, when the collected values really cannot run", async () => {
    const onRunAnalysis = vi.fn();

    render(
      <ExploreStudyBriefControls
        {...baseProps({
          onRunAnalysis,
          canSubmit: true, // stale in the OTHER direction
          blockReason: null,
          evaluateRunBlock: () => "Set the area you are planning for first.",
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /set up the analysis|run the analysis/i }));
    const box = await screen.findByRole("textbox");
    fireEvent.change(box, { target: { value: "A question" } });
    for (let guard = 0; guard < 6; guard += 1) {
      const next = screen.queryByRole("button", { name: /^next$/i });
      if (!next) break;
      fireEvent.click(next);
    }
    fireEvent.click(screen.getByRole("button", { name: /run the analysis/i }));

    // A stale `canSubmit: true` must not let a run start that cannot.
    await waitFor(() => expect(screen.getByText(/set the area you are planning for/i)).toBeTruthy());
    expect(onRunAnalysis).not.toHaveBeenCalled();
  });
});

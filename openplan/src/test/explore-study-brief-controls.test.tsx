import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExploreStudyBriefControls } from "@/app/(app)/explore/_components/explore-study-brief-controls";

function renderControls(overrides: Partial<Parameters<typeof ExploreStudyBriefControls>[0]> = {}) {
  const props = {
    queryText: "Evaluate corridor safety and access",
    isQueryTooLong: false,
    reportTemplate: "atp" as const,
    canSubmit: true,
  blockReason: null,
  // The sheet judges what it collected; the default fixture lets a run start.
  evaluateRunBlock: () => null,
    isSubmitting: false,
    analysisRunId: "run-1",
    isGeneratingReport: false,
    isDownloadingPdf: false,
    error: "",
    onQueryTextChange: vi.fn(),
    onReportTemplateChange: vi.fn(),
    onRunAnalysis: vi.fn(),
    onGenerateReport: vi.fn(),
    onDownloadPdfReport: vi.fn(),
    ...overrides,
  };

  render(<ExploreStudyBriefControls {...props} />);

  return props;
}

/**
 * The intake became a guided flow; the corridor drawing and the run button did
 * NOT, because a modal over the map covers the thing being described. So these
 * drive the flow the way a planner does: press the setup button, answer, run.
 */
function openTheBrief() {
  fireEvent.click(screen.getByRole("button", { name: /Change the question|Set up the analysis/ }));
}

describe("ExploreStudyBriefControls", () => {
  it("shows the current question on the rail, and carries it into the setup for editing", () => {
    const props = renderControls();

    // The question is READABLE without opening anything — the rail is what a
    // planner looks at while drawing.
    expect(screen.getByText("Evaluate corridor safety and access")).toBeInTheDocument();

    openTheBrief();
    const field = screen.getByLabelText("Your question");
    expect(field).toHaveValue("Evaluate corridor safety and access");
    expect(screen.getByText("35 of 600 characters used.")).toBeInTheDocument();

    fireEvent.change(field, { target: { value: "New corridor question" } });
    // The workbench still owns the value: it is handed over on submit, not on
    // every keystroke, so an abandoned draft cannot change what the page thinks
    // was asked.
    expect(props.onQueryTextChange).not.toHaveBeenCalled();
  });

  it("surfaces prompt length warnings and disables the run action", () => {
    const props = renderControls({
      isQueryTooLong: true,
      canSubmit: false,
  blockReason: "Set the study area first: search a place, draw one on the map, or upload a boundary file.",
  evaluateRunBlock: () => "Set the study area first: search a place, draw one on the map, or upload a boundary file."
    });

    expect(screen.getByText("That question is too long to run. Open the setup and shorten it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run Analysis/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Run Analysis/ }));
    expect(props.onRunAnalysis).not.toHaveBeenCalled();
  });

  it("updates report template and calls run/export actions", async () => {
    const props = renderControls();

    openTheBrief();
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    fireEvent.change(screen.getByLabelText("Report style"), { target: { value: "ss4a" } });
    fireEvent.click(screen.getByRole("button", { name: "Run the analysis" }));

    await waitFor(() => expect(props.onRunAnalysis).toHaveBeenCalledWith("Evaluate corridor safety and access"));
    expect(props.onReportTemplateChange).toHaveBeenCalledWith("ss4a");
    expect(props.onQueryTextChange).toHaveBeenCalledWith("Evaluate corridor safety and access");

    fireEvent.click(screen.getByRole("button", { name: "ATP Report" }));
    expect(props.onGenerateReport).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    expect(props.onDownloadPdfReport).toHaveBeenCalledTimes(1);
  });

  it("hides export actions before a run exists and renders validation errors", () => {
    renderControls({
      analysisRunId: null,
      error: "Workspace ID, corridor, and query are required.",
    });

    expect(screen.queryByRole("button", { name: "ATP Report" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "PDF" })).not.toBeInTheDocument();
    expect(screen.getByText("Workspace ID, corridor, and query are required.")).toBeInTheDocument();
  });
});

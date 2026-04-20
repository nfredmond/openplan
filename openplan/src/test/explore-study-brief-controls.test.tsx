import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExploreStudyBriefControls } from "@/app/(app)/explore/_components/explore-study-brief-controls";

function renderControls(overrides: Partial<Parameters<typeof ExploreStudyBriefControls>[0]> = {}) {
  const props = {
    queryText: "Evaluate corridor safety and access",
    isQueryTooLong: false,
    reportTemplate: "atp" as const,
    canSubmit: true,
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

describe("ExploreStudyBriefControls", () => {
  it("renders the study brief form and dispatches query changes", () => {
    const props = renderControls();

    const field = screen.getByPlaceholderText("Example: Evaluate transit accessibility, safety risk, and equity implications for this corridor.");
    expect(field).toHaveValue("Evaluate corridor safety and access");
    expect(screen.getByText("Query length: 35/600 characters.")).toBeInTheDocument();

    fireEvent.change(field, { target: { value: "New corridor question" } });
    expect(props.onQueryTextChange).toHaveBeenCalledWith("New corridor question");
  });

  it("surfaces prompt length warnings and disables the run action", () => {
    const props = renderControls({
      isQueryTooLong: true,
      canSubmit: false,
    });

    expect(screen.getByText("Trim the prompt before running analysis.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run Analysis" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Run Analysis" }));
    expect(props.onRunAnalysis).not.toHaveBeenCalled();
  });

  it("updates report template and calls run/export actions", () => {
    const props = renderControls();

    fireEvent.click(screen.getByRole("button", { name: "SS4A" }));
    expect(props.onReportTemplateChange).toHaveBeenCalledWith("ss4a");

    fireEvent.click(screen.getByRole("button", { name: "Run Analysis" }));
    expect(props.onRunAnalysis).toHaveBeenCalledTimes(1);

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

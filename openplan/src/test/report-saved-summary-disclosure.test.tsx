import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReportCompositionAudit } from "@/app/(app)/reports/[reportId]/_components/report-composition-audit";
import { presentRunSummary } from "@/lib/analysis/run-summary-presentation";

describe("saved report summary disclosure", () => {
  it("withholds contradictory prose in the reachable evidence component without clipping the warning", () => {
    render(<ReportCompositionAudit reportId="report-1" sectionList={[]} enabledSectionsCount={0} artifactList={[]} runs={[{
      id: "run-1", title: "Older analysis", created_at: "2026-08-19T00:00:00Z",
      summary_text: "No crash figures were estimated. Overall: 32/100.",
      metrics: { dataQuality: { crashDataAvailable: false } },
    }]} />);
    const warning = screen.getByText(/Saved run summary withheld/);
    expect(warning).toHaveTextContent(/recorded estimated-source metadata/);
    expect(warning).not.toHaveClass("line-clamp-2");
    expect(screen.queryByText(/No crash figures were estimated/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Overall: 32\/100/)).not.toBeInTheDocument();
  });

  it("keeps unconflicted source-limited narrative unchanged", () => {
    const summary = "Observed fatal crashes only. Injury coverage is unavailable.";
    expect(presentRunSummary(summary, { sourceSnapshots: { crashes: { source: "fars" } } }))
      .toEqual({ withheld: false, text: summary });
  });

  it.each(["Overall", "Safety", "Accessibility", "Equity"])("withholds ineligible %s scores even if metrics are missing", (label) => {
    expect(presentRunSummary(`${label}: 32/100`, null).withheld).toBe(true);
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AdminOperationsPage from "@/app/(app)/admin/operations/page";
import { summarizeOperationalWarnings } from "@/lib/observability/operational-events";

describe("AdminOperationsPage", () => {
  it("surfaces operational warning events and log queries", () => {
    render(<AdminOperationsPage />);

    expect(screen.getByText("Warning watchboard")).toBeInTheDocument();
    expect(screen.getByText("Oversized API request")).toBeInTheDocument();
    expect(screen.getByText("High-cost AI analysis call")).toBeInTheDocument();
    expect(screen.getByText("CSP report-only violation")).toBeInTheDocument();
    expect(screen.getAllByText(/request_body_too_large/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/analysis_cost_threshold_exceeded/).length).toBeGreaterThan(0);
  });

  it("builds a combined query from all configured warning events", () => {
    const summary = summarizeOperationalWarnings();

    expect(summary.totalEvents).toBeGreaterThan(0);
    expect(summary.combinedLogQuery).toContain("\"request_body_too_large\"");
    expect(summary.combinedLogQuery).toContain("\"analysis_cost_threshold_exceeded\"");
  });
});

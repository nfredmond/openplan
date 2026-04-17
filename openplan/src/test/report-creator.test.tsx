import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { ReportCreator } from "@/components/reports/report-creator";

describe("ReportCreator", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("surfaces existing stale report guidance for the selected project", () => {
    render(
      <ReportCreator
        projects={[
          { id: "project-1", workspace_id: "workspace-1", name: "Downtown Mobility Plan" },
          { id: "project-2", workspace_id: "workspace-1", name: "Transit Access Plan" },
        ]}
        runs={[]}
        reportGuidanceByProject={{
          "project-1": {
            reportCount: 2,
            refreshRecommendedCount: 1,
            noPacketCount: 1,
            comparisonBackedCount: 0,
            recommendedReportId: "report-1",
            recommendedReportTitle: "Downtown Safety Packet",
          },
        }}
      />
    );

    expect(screen.getByText(/This project already has 2 report records\./i)).toBeInTheDocument();
    expect(screen.getByText(/1 refresh recommended and 1 without packet\./i)).toBeInTheDocument();
    expect(screen.getByText(/Review Downtown Safety Packet before creating another packet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open existing report/i })).toHaveAttribute(
      "href",
      "/reports/report-1"
    );
  });

  it("shows calm guidance when the latest packet is current", () => {
    render(
      <ReportCreator
        projects={[{ id: "project-2", workspace_id: "workspace-1", name: "Transit Access Plan" }]}
        runs={[]}
        reportGuidanceByProject={{
          "project-2": {
            reportCount: 1,
            refreshRecommendedCount: 0,
            noPacketCount: 0,
            comparisonBackedCount: 0,
            recommendedReportId: "report-2",
            recommendedReportTitle: "Transit Access Packet",
          },
        }}
      />
    );

    expect(screen.getByText(/This project already has 1 report record\./i)).toBeInTheDocument();
    expect(screen.getByText(/Latest packet looks current\./i)).toBeInTheDocument();
  });
});

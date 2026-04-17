import { render, screen, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { FileText } from "lucide-react";

import { DashboardKpiGrid } from "@/components/dashboard/dashboard-kpi-grid";
import { DashboardOperatorGuidance } from "@/components/dashboard/dashboard-operator-guidance";
import { DashboardQuickActions } from "@/components/dashboard/dashboard-quick-actions";
import { DashboardWorkspaceIntro } from "@/components/dashboard/dashboard-workspace-intro";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("DashboardKpiGrid", () => {
  it("renders every card with label, value, and detail", () => {
    render(
      <DashboardKpiGrid
        cards={[
          { label: "Total runs", value: "12", detail: "8 completed runs in this workspace" },
          { label: "Run completion rate", value: "67%", detail: "8/12 runs completed" },
        ]}
      />
    );

    expect(screen.getByText("Total runs")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("8 completed runs in this workspace")).toBeInTheDocument();
    expect(screen.getByText("Run completion rate")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
  });

  it("renders an empty grid with no cards", () => {
    const { container } = render(<DashboardKpiGrid cards={[]} />);
    const grid = container.querySelector(".module-summary-grid");
    expect(grid).not.toBeNull();
    expect(grid?.children.length).toBe(0);
  });
});

describe("DashboardWorkspaceIntro", () => {
  it("shows workspace name, role, plan, and the default description", () => {
    render(
      <DashboardWorkspaceIntro
        workspaceName="Nevada County RTPA"
        workspaceRole="owner"
        workspacePlan="pilot"
      />
    );

    expect(screen.getByRole("heading", { name: "Nevada County RTPA" })).toBeInTheDocument();
    expect(screen.getByText("owner")).toBeInTheDocument();
    expect(screen.getByText("pilot")).toBeInTheDocument();
    expect(
      screen.getByText(/Use this overview to see current work/)
    ).toBeInTheDocument();
  });

  it("renders children slot content after the body", () => {
    render(
      <DashboardWorkspaceIntro
        workspaceName="Test"
        workspaceRole="member"
        workspacePlan="pilot"
      >
        <div data-testid="slot">slot content</div>
      </DashboardWorkspaceIntro>
    );

    expect(screen.getByTestId("slot")).toHaveTextContent("slot content");
  });

  it("supports a custom description override", () => {
    render(
      <DashboardWorkspaceIntro
        workspaceName="Test"
        workspaceRole="member"
        workspacePlan="pilot"
        description="Custom intro copy for the test workspace."
      />
    );

    expect(screen.getByText("Custom intro copy for the test workspace.")).toBeInTheDocument();
  });
});

describe("DashboardQuickActions", () => {
  it("renders each action as a link with title and description", () => {
    render(
      <DashboardQuickActions
        actions={[
          {
            key: "analysis-studio",
            href: "/explore",
            title: "Open Analysis Studio",
            description: "Run corridor analysis.",
            icon: FileText,
          },
          {
            key: "projects",
            href: "/projects",
            title: "Open Projects Module",
            description: "Control rooms.",
            icon: FileText,
          },
        ]}
      />
    );

    const analysis = screen.getByRole("link", { name: /Open Analysis Studio/ });
    expect(analysis).toHaveAttribute("href", "/explore");
    expect(within(analysis).getByText("Run corridor analysis.")).toBeInTheDocument();

    const projects = screen.getByRole("link", { name: /Open Projects Module/ });
    expect(projects).toHaveAttribute("href", "/projects");
  });

  it("renders the quick-actions header", () => {
    render(<DashboardQuickActions actions={[]} />);
    expect(screen.getByText("Quick actions")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Move into the work" })).toBeInTheDocument();
  });
});

describe("DashboardOperatorGuidance", () => {
  it("suppresses the RTP and comparison operator items when counts are zero", () => {
    render(
      <DashboardOperatorGuidance
        rtpFundingReviewCount={0}
        grantsRoutedRtpFundingReview={false}
        comparisonBackedReportCount={0}
        grantModelingOperatorDetail={null}
        firstRunAt={null}
        timeToFirstResultFormatted="N/A"
      />
    );

    expect(
      screen.queryByText(/current RTP packet/)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/comparison-backed report packet/)
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/No analysis runs yet/)
    ).toBeInTheDocument();
  });

  it("renders singular-form copy when exactly one RTP packet needs review", () => {
    render(
      <DashboardOperatorGuidance
        rtpFundingReviewCount={1}
        grantsRoutedRtpFundingReview={false}
        comparisonBackedReportCount={1}
        grantModelingOperatorDetail={null}
        firstRunAt={null}
        timeToFirstResultFormatted="N/A"
      />
    );

    expect(
      screen.getByText(/1 current RTP packet still needs funding-backed release review/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 packet still carries linked-project funding follow-up/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 comparison-backed report packet can support grant planning/)
    ).toBeInTheDocument();
  });

  it("routes to grants follow-through wording when grantsRoutedRtpFundingReview is true", () => {
    render(
      <DashboardOperatorGuidance
        rtpFundingReviewCount={3}
        grantsRoutedRtpFundingReview={true}
        comparisonBackedReportCount={0}
        grantModelingOperatorDetail={null}
        firstRunAt={null}
        timeToFirstResultFormatted="N/A"
      />
    );

    expect(
      screen.getByText(/3 current RTP packets still need Grants OS follow-through/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Current RTP packet work is now a Grants OS follow-through lane/)
    ).toBeInTheDocument();
  });

  it("shows grant modeling operator detail when present", () => {
    render(
      <DashboardOperatorGuidance
        rtpFundingReviewCount={0}
        grantsRoutedRtpFundingReview={false}
        comparisonBackedReportCount={0}
        grantModelingOperatorDetail="Grant modeling says advance the funding decision."
        firstRunAt={null}
        timeToFirstResultFormatted="N/A"
      />
    );

    expect(
      screen.getByText("Grant modeling says advance the funding decision.")
    ).toBeInTheDocument();
  });

  it("reports time to first result when firstRunAt is set", () => {
    render(
      <DashboardOperatorGuidance
        rtpFundingReviewCount={0}
        grantsRoutedRtpFundingReview={false}
        comparisonBackedReportCount={0}
        grantModelingOperatorDetail={null}
        firstRunAt="2026-04-01T10:00:00Z"
        timeToFirstResultFormatted="2.5 hrs"
      />
    );

    expect(
      screen.getByText("Time to first result: 2.5 hrs.")
    ).toBeInTheDocument();
  });
});

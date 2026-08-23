import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReportNavigationPreview } from "@/app/(app)/reports/[reportId]/_components/report-navigation-preview";

describe("report artifact preview sandbox", () => {
  it("allows same-origin private images without granting script execution", () => {
    render(
      <ReportNavigationPreview
        projectId={null}
        engagementCampaign={null}
        engagementPublicHref={null}
        latestHtml="<img src='/api/reports/report/artifacts/artifact/aerial/custody' />"
        latestArtifact={null}
      />,
    );

    const frame = screen.getByTitle("Latest report artifact preview");
    expect(frame).toHaveAttribute("sandbox", "allow-same-origin");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-scripts");
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReportNavigationPreview } from "@/app/(app)/reports/[reportId]/_components/report-navigation-preview";

describe("report artifact preview sandbox", () => {
  it("allows same-origin private images without granting script execution", () => {
    render(
      <ReportNavigationPreview
        reportId="11111111-1111-4111-8111-111111111111"
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

  it("puts the generated PDF download on the main preview surface", () => {
    render(
      <ReportNavigationPreview
        reportId="11111111-1111-4111-8111-111111111111"
        projectId={null}
        engagementCampaign={null}
        engagementPublicHref={null}
        latestHtml={null}
        latestArtifact={{
          id: "22222222-2222-4222-8222-222222222222",
          artifact_kind: "pdf",
          generated_at: "2026-08-24T12:00:00.000Z",
          storage_path: "workspace/report/packet.pdf",
          metadata_json: {},
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: /Latest report preview/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download PDF/i })).toHaveAttribute(
      "href",
      "/api/reports/11111111-1111-4111-8111-111111111111/artifacts/22222222-2222-4222-8222-222222222222/download",
    );
  });
});

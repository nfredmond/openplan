import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JurisdictionReadinessPanel } from "@/components/jurisdiction-readiness/jurisdiction-readiness-panel";
import { buildJurisdictionReadinessPayload } from "@/lib/jurisdiction-readiness/payload";

describe("JurisdictionReadinessPanel", () => {
  it("shows the exact selected cell and lets a planner change jobs", () => {
    const payload = buildJurisdictionReadinessPayload(
      { countryCode: "US", subdivisionCode: "OR", label: "Deschutes County, Oregon" },
      "a".repeat(64),
    );

    render(
      <JurisdictionReadinessPanel
        reports={payload.reports}
        downloadHref="/api/workspaces/jurisdiction-readiness?download=1"
      />,
    );

    expect(screen.getByRole("heading", { name: "Can OpenPlan do this here?" })).toBeInTheDocument();
    expect(screen.getByText("Deschutes County, Oregon")).toBeInTheDocument();
    expect(screen.getByText("Partly supported")).toBeInTheDocument();
    expect(screen.getByText(/one v0\.42 Oregon start-to-handoff journey is frozen/i)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Planning job" }), {
      target: { value: "land-use-plan" },
    });

    expect(screen.getByText("Unavailable here")).toBeInTheDocument();
    expect(screen.getByText(/no configured Oregon statutory plan bundle/i)).toBeInTheDocument();
    const evidenceHash = screen.getByText(/sha256:283f9f53/i);
    expect(evidenceHash).toBeInTheDocument();
    expect(evidenceHash.previousElementSibling).toHaveClass("break-all");
    expect(screen.getByRole("link", { name: /download exact local support json/i })).toHaveAttribute(
      "href",
      "/api/workspaces/jurisdiction-readiness?download=1",
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Planning job" }), {
      target: { value: "grants-and-reimbursement" },
    });
    expect(screen.getByRole("link", { name: "Local Government Funding Overview" })).toHaveAttribute(
      "href",
      "https://www.oregon.gov/ODOT/LocalGov/Pages/Funding.aspx",
    );
  });

  it("shows an unassessed place without source evidence or inherited rules", () => {
    const payload = buildJurisdictionReadinessPayload(
      { countryCode: "US", subdivisionCode: "NV", label: "A Nevada county" },
      "b".repeat(64),
    );

    render(
      <JurisdictionReadinessPanel
        reports={payload.reports}
        downloadHref="/api/workspaces/jurisdiction-readiness?download=1"
      />,
    );

    expect(screen.getByText("Not assessed here")).toBeInTheDocument();
    expect(screen.getByText(/no evidence-backed claim is registered/i)).toBeInTheDocument();
    expect(screen.queryByText(/California/)).not.toBeInTheDocument();
  });

  it("shows an unreadable read as an error and withholds the download", () => {
    render(
      <JurisdictionReadinessPanel
        reports={[]}
        unreadableReason="The workspace geography record could not be read."
      />,
    );

    expect(screen.getByRole("heading", { name: "Support could not be checked" })).toBeInTheDocument();
    expect(screen.getByText("Unreadable")).toBeInTheDocument();
    expect(screen.queryByText("Not assessed here")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /download exact readiness json/i })).not.toBeInTheDocument();
  });
});

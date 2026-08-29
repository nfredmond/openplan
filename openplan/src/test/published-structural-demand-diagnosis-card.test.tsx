import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PublishedStructuralDemandDiagnosisCard } from "@/components/models/published-structural-demand-diagnosis-card";

describe("PublishedStructuralDemandDiagnosisCard", () => {
  it("states the diagnosis boundary and exposes both method downloads", () => {
    render(<PublishedStructuralDemandDiagnosisCard study={{
      version: "0.43.0", releaseSha: "a".repeat(40), createdAt: "2026-08-28T20:00:00Z", scientificOutcome: "inconclusive",
      records: (["aequilibrae", "activitysim"] as const).map((method) => ({
        geographyId: "06007", geographyName: "Fixture County", method,
        inputAuditPath: `data/${method}-audit.json`, inputAuditSha256: "b".repeat(64),
        diagnosisPath: `data/${method}-diagnosis.json`, diagnosisStoredPath: `data/${method}-diagnosis.json.gz`, diagnosisSha256: "c".repeat(64), coverage: { loaded: 1, unloaded: 1 },
      })),
    }} />);
    expect(screen.getByText(/do not show improved accuracy/i)).toBeInTheDocument();
    expect(screen.getByText(/non-work through travel is unsupported/i)).toBeInTheDocument();
    expect(screen.getByText(/No ranking or average/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "aequilibrae input audit" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "activitysim input audit" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "aequilibrae diagnosis" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "activitysim diagnosis" })).toBeInTheDocument();
    expect(screen.getByTestId("selected-structural-demand-record")).toHaveTextContent("aequilibrae");
    fireEvent.click(screen.getByRole("button", { name: "ActivitySim" }));
    expect(screen.getByTestId("selected-structural-demand-record")).toHaveTextContent("activitysim");
    expect(screen.getByText("b".repeat(64))).toHaveClass("break-all");
  });
});

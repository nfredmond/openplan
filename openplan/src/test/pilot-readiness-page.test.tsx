import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PilotReadinessPage from "@/app/(app)/admin/pilot-readiness/page";
import {
  finalPilotReadinessChecklistSync,
  getAdminPilotReadinessProofArtifactIndex,
  releaseProofPosture,
} from "@/lib/operations/release-proof-packet";

vi.mock("@/lib/operations/pilot-readiness", () => ({
  getSmokeStatus: () => [
    {
      lane: "Release candidate baseline",
      status: "PASS",
      lastRun: "2026-05-01",
      details: "docs/ops/2026-05-01-openplan-rc-proof-log.md",
    },
  ],
}));

describe("PilotReadinessPage", () => {
  it("shows that the export caveat cue is synchronized with Command Center release proof", () => {
    render(<PilotReadinessPage />);

    const cue = screen.getByLabelText("Export caveat sync status");
    const salesCaveatProof = releaseProofPosture.proofItems.find((item) => item.key === "sales-caveats");

    expect(cue).toHaveTextContent("Export caveats mirror Command Center release proof");
    expect(cue).toHaveTextContent(`${releaseProofPosture.caveats.length} required caveats`);
    expect(cue).toHaveTextContent(`${releaseProofPosture.proofItems.length} proof artifacts`);
    expect(cue).toHaveTextContent(finalPilotReadinessChecklistSync.checklistArtifact);
    expect(cue).toHaveTextContent(salesCaveatProof?.artifact ?? "");
    expect(screen.getByRole("heading", { name: /Export filenames and caveats before buyer reliance/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Current packet docs, static exports, and preflight proof/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Compact proof artifact index")).toHaveTextContent("Buyer-safe caveats required");
    expect(screen.getByText(finalPilotReadinessChecklistSync.operatorInstruction)).toBeInTheDocument();
    expect(screen.getByText(finalPilotReadinessChecklistSync.supervisedOnboardingCaveat)).toBeInTheDocument();
    expect(screen.getAllByText(finalPilotReadinessChecklistSync.checklistArtifact).length).toBeGreaterThan(0);

    for (const filename of finalPilotReadinessChecklistSync.exportFilenames) {
      expect(screen.getAllByText(filename).length).toBeGreaterThan(0);
    }

    for (const artifact of finalPilotReadinessChecklistSync.latestProofArtifacts) {
      expect(screen.getByText(artifact.label)).toBeInTheDocument();
      expect(screen.getAllByText(artifact.artifact).length).toBeGreaterThan(0);
    }

    for (const artifact of getAdminPilotReadinessProofArtifactIndex()) {
      expect(screen.getByText(artifact.label)).toBeInTheDocument();
      expect(screen.getAllByText(artifact.artifact).length).toBeGreaterThan(0);
      expect(screen.getByText(artifact.buyerSafeCaveat)).toBeInTheDocument();
    }

    expect(screen.getByRole("heading", { name: /Which artifacts support sale and pilot readiness/i })).toBeInTheDocument();
    expect(screen.getByText(/The export below uses the same release-proof posture as Command Center/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Run a read-only preflight before outward reliance/i })).toBeInTheDocument();
    expect(screen.getByText("pnpm ops:check-pilot-preflight")).toBeInTheDocument();
    expect(screen.getAllByText("docs/ops/2026-05-10-openplan-pilot-preflight-operator-proof.md").length).toBeGreaterThan(0);
    expect(screen.getByText(/Run this in a terminal immediately before a buyer call/i)).toBeInTheDocument();
    expect(screen.getByText(/No commands run in the browser/i)).toBeInTheDocument();
    expect(screen.getByText(/Sale readiness: names the current gate evidence/i)).toBeInTheDocument();
    expect(screen.getByText(/Pilot readiness: turns smoke status and source documents/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Billing proof waiver/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Export Readiness Packet/i })).toBeInTheDocument();
  });
});

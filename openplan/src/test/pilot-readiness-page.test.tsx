import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PilotReadinessPage from "@/app/(app)/admin/pilot-readiness/page";
import { releaseProofPosture } from "@/lib/operations/release-proof-packet";

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
    expect(cue).toHaveTextContent(salesCaveatProof?.artifact ?? "");
    expect(screen.getByRole("heading", { name: /Which artifacts support sale and pilot readiness/i })).toBeInTheDocument();
    expect(screen.getByText(/The export below uses the same release-proof posture as Command Center/i)).toBeInTheDocument();
    expect(screen.getByText(/Sale readiness: names the current gate evidence/i)).toBeInTheDocument();
    expect(screen.getByText(/Pilot readiness: turns smoke status and source documents/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Billing proof waiver/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Export Readiness Packet/i })).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PilotReadinessPage from "@/app/(app)/admin/pilot-readiness/page";
import { buildPilotReadinessControlSummary } from "@/lib/operations/admin-operator-control";
import type { SmokeStatus } from "@/lib/operations/pilot-readiness";
import { buildPilotReadinessPacket } from "@/lib/operations/pilot-readiness-packet";
import {
  getOpenPlanRepositoryArtifactUrl,
  OPENPLAN_REPOSITORY_BLOB_BASE_URL,
} from "@/lib/operations/pilot-readiness-proof-paths";
import {
  finalPilotReadinessChecklistSync,
  getAdminPilotReadinessProofArtifactIndex,
  releaseProofPosture,
} from "@/lib/operations/release-proof-packet";
import { getSupervisedOnboardingEvidenceFlow } from "@/lib/operations/supervised-onboarding-evidence";

const smokeStatusFixture = vi.hoisted(() => [
  {
    lane: "Release candidate baseline",
    status: "PASS",
    lastRun: "2026-05-01",
    details: "docs/ops/2026-05-01-openplan-rc-proof-log.md",
  },
] satisfies SmokeStatus[]);

vi.mock("@/lib/operations/pilot-readiness", () => ({
  getSmokeStatus: () => smokeStatusFixture,
}));

describe("PilotReadinessPage", () => {
  it("shows that the export caveat cue is synchronized with Command Center release proof", () => {
    render(<PilotReadinessPage />);

    const pageText = document.body.textContent ?? "";

    const cue = screen.getByLabelText("Export caveat sync status");
    const salesCaveatProof = releaseProofPosture.proofItems.find((item) => item.key === "sales-caveats");

    expect(cue).toHaveTextContent("Export caveats mirror Command Center release proof");
    expect(cue).toHaveTextContent(`${releaseProofPosture.caveats.length} required caveats`);
    expect(cue).toHaveTextContent(`${releaseProofPosture.proofItems.length} proof artifacts`);
    expect(cue).toHaveTextContent(finalPilotReadinessChecklistSync.checklistArtifact);
    expect(cue).toHaveTextContent(salesCaveatProof?.artifact ?? "");
    expect(screen.getByRole("heading", { name: /Proof status overview/i })).toBeInTheDocument();
    expect(screen.getByText(/export an operator summary for supervised pilot diligence/i)).toBeInTheDocument();
    expect(screen.getByText(/Tracked lanes with a recent passing artifact/i)).toBeInTheDocument();
    expect(screen.getByText(/Tracked lanes requiring proof repair before citation/i)).toBeInTheDocument();
    expect(screen.getByText(/Tracked lanes missing a current proof artifact/i)).toBeInTheDocument();
    expect(screen.getByText(/verify source documents before external reliance/i)).toBeInTheDocument();
    expect(pageText).not.toMatch(/shareable summary/i);
    expect(pageText).not.toMatch(/areas are healthy/i);
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
      expect(screen.getAllByText(artifact.label).length).toBeGreaterThan(0);
      expect(screen.getAllByText(artifact.artifact).length).toBeGreaterThan(0);
    }

    for (const artifact of getAdminPilotReadinessProofArtifactIndex()) {
      expect(screen.getAllByText(artifact.label).length).toBeGreaterThan(0);
      expect(screen.getAllByText(artifact.artifact).length).toBeGreaterThan(0);
      expect(screen.getByText(artifact.buyerSafeCaveat)).toBeInTheDocument();
    }

    expect(screen.getByRole("heading", { name: /Which artifacts support sale and pilot readiness/i })).toBeInTheDocument();
    expect(screen.getByText(/The export below uses the same release-proof posture as Command Center/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Run a read-only preflight before outward reliance/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Supervised onboarding evidence flow/i })).toBeInTheDocument();
    expect(screen.getByText("Trace the admin queue behind this packet")).toBeInTheDocument();
    expect(screen.getByText(getSupervisedOnboardingEvidenceFlow().boundary)).toBeInTheDocument();
    expect(screen.getByText("pnpm ops:check-pilot-preflight")).toBeInTheDocument();
    expect(screen.getAllByText("docs/ops/2026-05-10-openplan-pilot-preflight-operator-proof.md").length).toBeGreaterThan(0);
    expect(screen.getByText(/Run this in a terminal immediately before a buyer call/i)).toBeInTheDocument();
    expect(screen.getByText(/No commands run in the browser/i)).toBeInTheDocument();
    expect(screen.getByText(/Sale readiness: names the current gate evidence/i)).toBeInTheDocument();
    expect(screen.getByText(/Pilot readiness: turns smoke status and source documents/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Billing proof waiver/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Export Readiness Packet/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Latest proof results by app surface/i })).toBeInTheDocument();
    expect(screen.getByText(/cite only the source artifact, not the dashboard row/i)).toBeInTheDocument();
    expect(screen.getByText(/Passing proof artifact available for supervised pilot diligence/i)).toBeInTheDocument();
    expect(screen.getByText("Exact proof:")).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: `Open proof artifact ${smokeStatusFixture[0].details}`,
      }),
    ).toHaveAttribute("href", getOpenPlanRepositoryArtifactUrl(smokeStatusFixture[0].details));
  });

  it("links every rendered proof artifact path to the exact GitHub main-branch blob URL", () => {
    render(<PilotReadinessPage />);

    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expectedProofArtifacts = Array.from(
      new Set([
        smokeStatusFixture[0].details,
        ...getAdminPilotReadinessProofArtifactIndex().map((artifact) => artifact.artifact),
        finalPilotReadinessChecklistSync.checklistArtifact,
        ...finalPilotReadinessChecklistSync.exportFilenames,
        ...finalPilotReadinessChecklistSync.latestProofArtifacts.map((artifact) => artifact.artifact),
        ...releaseProofPosture.proofItems.map((item) => item.artifact),
      ]),
    );

    expect(expectedProofArtifacts.length).toBeGreaterThan(10);

    for (const artifact of expectedProofArtifacts) {
      const expectedHref = `${OPENPLAN_REPOSITORY_BLOB_BASE_URL}/${artifact}`;
      const links = screen.getAllByRole("link", { name: `Open proof artifact ${artifact}` });

      expect(expectedHref, `${artifact} should resolve to the OpenPlan main-branch blob URL`).toMatch(
        new RegExp(`^${escapeRegExp(OPENPLAN_REPOSITORY_BLOB_BASE_URL)}/`),
      );

      for (const link of links) {
        expect(link, `${artifact} should preserve exact visible path text`).toHaveTextContent(artifact);
        expect(link, `${artifact} should use the exact GitHub artifact URL`).toHaveAttribute("href", expectedHref);
        expect(link, `${artifact} should open as an external proof artifact`).toHaveAttribute("target", "_blank");
        expect(link, `${artifact} should avoid leaking opener access`).toHaveAttribute("rel", "noreferrer");
      }
    }

    const proofLinks = screen.getAllByRole("link", { name: /^Open proof artifact / });
    expect(proofLinks.length).toBeGreaterThanOrEqual(expectedProofArtifacts.length);
    for (const link of proofLinks) {
      expect(link.getAttribute("href"), "admin proof links should not point at local relative files").toMatch(
        new RegExp(`^${escapeRegExp(OPENPLAN_REPOSITORY_BLOB_BASE_URL)}/`),
      );
    }
  });

  it("keeps the rendered proof index, preflight cue, and export packet helper on the same source data", () => {
    const { container } = render(<PilotReadinessPage />);
    const pageText = container.textContent ?? "";
    const controlSummary = buildPilotReadinessControlSummary(smokeStatusFixture);
    const packet = buildPilotReadinessPacket(smokeStatusFixture, "2026-05-10T16:41:00.000Z");
    const proofArtifactIndex = getAdminPilotReadinessProofArtifactIndex();
    const preflightProofItem = proofArtifactIndex.find((item) => item.category === "preflight-proof");

    expect(preflightProofItem, "preflight proof must stay in the shared artifact index").toBeDefined();
    expect(preflightProofItem?.artifact).toBe(controlSummary.preflightProofArtifact);
    expect(pageText).toContain(controlSummary.preflightCommand);
    expect(pageText).toContain(controlSummary.preflightProofArtifact);
    expect(pageText).toContain(controlSummary.preflightOperatorInstruction);
    expect(packet).toContain(controlSummary.preflightProofArtifact);
    expect(packet).toContain(preflightProofItem?.buyerSafeCaveat ?? "");

    for (const artifact of proofArtifactIndex) {
      expect(pageText, `${artifact.label} should render on the admin page`).toContain(artifact.label);
      expect(pageText, `${artifact.artifact} should render on the admin page`).toContain(artifact.artifact);
      expect(pageText, `${artifact.label} caveat should render on the admin page`).toContain(artifact.buyerSafeCaveat);
      expect(
        screen.getAllByRole("link", { name: `Open proof artifact ${artifact.artifact}` })[0],
        `${artifact.label} should link to the exact proof artifact`,
      ).toHaveAttribute("href", getOpenPlanRepositoryArtifactUrl(artifact.artifact));
      expect(packet, `${artifact.label} should export from the packet helper`).toContain(artifact.label);
      expect(packet, `${artifact.artifact} should export from the packet helper`).toContain(artifact.artifact);
      expect(packet, `${artifact.label} caveat should export from the packet helper`).toContain(artifact.buyerSafeCaveat);
    }

    expect(packet).toContain(finalPilotReadinessChecklistSync.checklistArtifact);
    expect(packet).toContain(finalPilotReadinessChecklistSync.supervisedOnboardingCaveat);
    expect(pageText).toContain(finalPilotReadinessChecklistSync.checklistArtifact);
    expect(pageText).toContain(finalPilotReadinessChecklistSync.supervisedOnboardingCaveat);
  });
});

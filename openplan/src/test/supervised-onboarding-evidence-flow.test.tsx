import { existsSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SupervisedOnboardingEvidenceFlowPanel } from "@/components/operations/supervised-onboarding-evidence-flow";
import { getOpenPlanRepositoryArtifactUrl } from "@/lib/operations/pilot-readiness-proof-paths";
import {
  getSupervisedOnboardingEvidenceFlow,
  getSupervisedOnboardingEvidenceProofArtifacts,
  SUPERVISED_ONBOARDING_EVIDENCE_FLOW_PROOF_ARTIFACT,
} from "@/lib/operations/supervised-onboarding-evidence";

const repoRoot = path.resolve(process.cwd(), "..");

function resolveRepoArtifact(artifact: string) {
  return path.join(repoRoot, artifact);
}

describe("supervised onboarding evidence flow", () => {
  it("renders the access request to admin operations to pilot readiness evidence chain", () => {
    const flow = getSupervisedOnboardingEvidenceFlow();

    render(<SupervisedOnboardingEvidenceFlowPanel context="admin-operations" />);

    expect(screen.getByLabelText("Supervised onboarding evidence flow")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Supervised onboarding evidence flow" })).toBeInTheDocument();
    expect(screen.getByText(flow.summary)).toBeInTheDocument();
    expect(screen.getByText(flow.boundary)).toBeInTheDocument();
    expect(screen.getByText("Bridge this queue to pilot readiness")).toBeInTheDocument();
    expect(screen.getByText(SUPERVISED_ONBOARDING_EVIDENCE_FLOW_PROOF_ARTIFACT)).toBeInTheDocument();
    expect(screen.getByLabelText("Manual provisioning guard")).toBeInTheDocument();
    expect(screen.getByText("Manual provisioning guard")).toBeInTheDocument();
    expect(screen.getByText(/Acknowledgement: manual_provisioning_no_email/i)).toBeInTheDocument();
    expect(screen.getByText("No production writes during proof smoke")).toBeInTheDocument();
    expect(screen.getByText("No autonomous provisioning")).toBeInTheDocument();
    expect(screen.getByText("No outbound email")).toBeInTheDocument();
    expect(screen.getByText("Manual invite delivery only")).toBeInTheDocument();

    for (const stage of flow.stages) {
      expect(screen.getByText(stage.label)).toBeInTheDocument();
      expect(screen.getByText(stage.operatorCheckpoint)).toBeInTheDocument();
      expect(screen.getByText(stage.buyerSafeCaveat)).toBeInTheDocument();
      expect(screen.getByText(stage.appSurface)).toBeInTheDocument();
      expect(
        screen
          .getAllByRole("link", { name: `Open proof artifact ${stage.proofArtifact}` })
          .some((link) => link.getAttribute("href") === getOpenPlanRepositoryArtifactUrl(stage.proofArtifact)),
      ).toBe(true);
    }

    expect(screen.getAllByText(/manual_provisioning_no_email/).length).toBeGreaterThan(0);
    expect(screen.getByText(/PASS supports a supervised pilot-readiness conversation only/i)).toBeInTheDocument();
  });

  it("keeps every declared proof artifact resolvable in the repository", () => {
    const artifacts = getSupervisedOnboardingEvidenceProofArtifacts();

    expect(artifacts).toContain("openplan/src/test/access-request-route.test.ts");
    expect(artifacts).toContain("openplan/src/test/admin-operations-page.test.tsx");
    expect(artifacts).toContain("openplan/docs/ops/2026-05-10-access-request-manual-provisioning-guard-proof.md");
    expect(artifacts).toContain("docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md");
    expect(artifacts).toHaveLength(new Set(artifacts).size);

    for (const artifact of artifacts) {
      expect(existsSync(resolveRepoArtifact(artifact)), `${artifact} should exist`).toBe(true);
    }
  });

  it("uses the same source data for the pilot-readiness rendering context", () => {
    render(<SupervisedOnboardingEvidenceFlowPanel context="pilot-readiness" />);

    expect(screen.getByText("Trace the admin queue behind this packet")).toBeInTheDocument();
    expect(screen.getByText("/admin/operations → Recent supervised onboarding requests")).toBeInTheDocument();
    expect(screen.getByText("/admin/pilot-readiness")).toBeInTheDocument();
  });
});

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildPilotReadinessPacket } from "@/app/(app)/admin/pilot-readiness/ExportButton";
import { finalPilotReadinessChecklistSync, releaseProofPosture } from "@/lib/operations/release-proof-packet";

const repoRoot = path.resolve(process.cwd(), "..");

describe("pilot readiness export packet", () => {
  it("includes the source proof document for each tracked lane", () => {
    const packet = buildPilotReadinessPacket(
      [
        {
          lane: "Authenticated Auth",
          status: "PASS",
          lastRun: "2026-04-08",
          details: "2026-04-08-openplan-production-authenticated-smoke.md",
        },
      ],
      "2026-05-09T00:00:00.000Z",
    );

    expect(packet).toContain("Generated: 2026-05-09T00:00:00.000Z");
    expect(packet).toContain(
      "- **Authenticated Auth**: PASS (Last Run: 2026-04-08; Source: 2026-04-08-openplan-production-authenticated-smoke.md)",
    );
    expect(packet).toContain("Treat PASS lanes as citeable only when the named source document is available");
  });

  it("reuses the Command Center release-proof caveats and artifacts", () => {
    const packet = buildPilotReadinessPacket([], "2026-05-09T00:00:00.000Z");

    expect(packet).toContain("## Release Proof Packet Alignment");
    expect(packet).toContain(releaseProofPosture.summary);
    expect(packet).toContain(releaseProofPosture.wedge);

    for (const caveat of releaseProofPosture.caveats) {
      expect(packet).toContain(`- ${caveat}`);
    }

    for (const proofItem of releaseProofPosture.proofItems) {
      expect(packet).toContain(`- **${proofItem.label}**: ${proofItem.headline} Source: ${proofItem.artifact}`);
      expect(packet).toContain(`  - Supports: ${proofItem.readinessRole}`);
      expect(packet).toContain(`  - Operator check: ${proofItem.operatorCheck}`);
    }

    expect(packet).toContain("Billing proof waiver (docs/ops/2026-05-01-openplan-billing-current-cycle-waiver-proof.md)");
    expect(packet).toContain("Modeling proof boundary (docs/ops/2026-05-08-openplan-modeling-caveat-kpi-sql-gate-proof.md)");
    expect(packet).toContain("No fresh same-cycle paid canary is claimed");
    expect(packet).toContain("Onboarding remains a supervised implementation step");
    expect(packet).toContain("RPO/RTO commitments are filled per managed-hosting engagement");
    expect(packet).toContain("no validated behavioral forecasting claim is made");
    expect(packet).toContain("not sold as legal-grade LAPM/compliance automation or autonomous AI planning");
  });

  it("syncs the final pilot-readiness checklist, proof packet filenames, and supervised onboarding caveat", () => {
    const packet = buildPilotReadinessPacket([], "2026-05-10T00:00:00.000Z");

    expect(packet).toContain("## Final Pilot-Readiness Checklist Sync");
    expect(packet).toContain(finalPilotReadinessChecklistSync.checklistArtifact);
    expect(packet).toContain(finalPilotReadinessChecklistSync.verdict);
    expect(packet).toContain(finalPilotReadinessChecklistSync.supervisedOnboardingCaveat);
    expect(packet).toContain("no instant public workspace activation");
    expect(packet).toContain("no broad self-serve municipal SaaS claim");
    expect(packet).toContain("buyer-specific emails, public posts, and signed SOW language still need human review");

    for (const filename of finalPilotReadinessChecklistSync.exportFilenames) {
      expect(packet).toContain(`- ${filename}`);
    }

    for (const artifact of finalPilotReadinessChecklistSync.latestProofArtifacts) {
      expect(packet).toContain(`- **${artifact.label}**: ${artifact.artifact}`);
      expect(packet).toContain(`  - Role: ${artifact.role}`);
      expect(packet).toContain(`  - Caveat: ${artifact.caveat}`);
    }

    expect(packet).toContain("docs/sales/2026-05-10-openplan-managed-support-proof-map.md");
    expect(packet).toContain("docs/ops/2026-05-10-openplan-county-run-manifest-proof-ui.md");
    expect(packet).toContain("openplan/docs/ops/2026-05-10-openplan-modeling-evidence-export-proof.md");
    expect(packet).toContain("openplan/src/test/pilot-readiness-export-packet.test.ts");
  });

  it("keeps synchronized proof filenames resolvable in the repo", () => {
    const syncedFiles = [
      finalPilotReadinessChecklistSync.checklistArtifact,
      ...finalPilotReadinessChecklistSync.exportFilenames,
      ...finalPilotReadinessChecklistSync.latestProofArtifacts.map((artifact) => artifact.artifact),
    ];

    for (const filename of syncedFiles) {
      expect(existsSync(path.join(repoRoot, filename)), `${filename} should exist`).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  buildAdminPilotReadinessProofPacketMarkdown,
  buildAdminPilotReadinessProofArtifactIndexMarkdown,
  buildFinalPilotReadinessSyncMarkdown,
  buildPilotReadinessPacket,
  buildReleaseProofAlignmentMarkdown,
} from "@/lib/operations/pilot-readiness-packet";
import {
  finalPilotReadinessChecklistSync,
  getAdminPilotReadinessProofArtifactIndex,
  releaseProofPosture,
} from "@/lib/operations/release-proof-packet";
import { WAVE6_RELEASE_READINESS_SUMMARY_ARTIFACT } from "@/lib/operations/pilot-readiness-proof-paths";
import { SUPERVISED_ONBOARDING_EVIDENCE_FLOW_PROOF_ARTIFACT } from "@/lib/operations/supervised-onboarding-evidence";

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
    expect(packet).toContain("Cite source artifacts, not dashboard summaries");
  });

  it("preserves the no-autonomous launch-certificate caveat in the admin export", () => {
    const packet = buildPilotReadinessPacket([], "2026-05-10T00:00:00.000Z");

    expect(packet).toContain("not an autonomous launch certificate");
    expect(packet).toContain("supervised implementation, human review, and no-autonomous-AI caveats");
    expect(packet).toContain(finalPilotReadinessChecklistSync.verdict);
    expect(packet).toContain("not a launch certificate for a finished planning suite");
    expect(packet).toContain("not sold as legal-grade LAPM/compliance automation or autonomous AI planning");
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
    expect(packet).toContain(SUPERVISED_ONBOARDING_EVIDENCE_FLOW_PROOF_ARTIFACT);
    expect(packet).toContain("manual no-email provisioning");
    expect(packet).toContain("not public self-serve activation, outbound email automation, or permission to provision during a smoke");
    expect(packet).toContain(WAVE6_RELEASE_READINESS_SUMMARY_ARTIFACT);
    expect(packet).toContain("docs/ops/2026-05-10-openplan-county-run-manifest-proof-ui.md");
    expect(packet).toContain("openplan/docs/ops/2026-05-10-openplan-modeling-evidence-export-proof.md");
    expect(packet).toContain("openplan/src/test/pilot-readiness-export-packet.test.ts");
  });

  it("includes the compact proof artifact index with buyer-safe caveats", () => {
    const packet = buildPilotReadinessPacket([], "2026-05-10T00:00:00.000Z");

    expect(packet).toContain("## Compact Proof Artifact Index");
    expect(packet).toContain(buildAdminPilotReadinessProofArtifactIndexMarkdown());

    for (const artifact of getAdminPilotReadinessProofArtifactIndex()) {
      expect(packet).toContain(`**${artifact.label}**`);
      expect(packet).toContain(artifact.artifact);
      expect(packet).toContain(artifact.buyerSafeCaveat);
    }

    expect(packet).toContain(WAVE6_RELEASE_READINESS_SUMMARY_ARTIFACT);
    expect(packet).toContain("operator orientation");
    expect(packet).toContain("docs/ops/2026-05-10-openplan-pilot-preflight-operator-proof.md");
    expect(packet).toContain("read-only operational confidence");
  });

  it("keeps synchronized proof filenames resolvable in the repo", () => {
    const syncedFiles = [
      finalPilotReadinessChecklistSync.checklistArtifact,
      ...getAdminPilotReadinessProofArtifactIndex().map((artifact) => artifact.artifact),
      ...finalPilotReadinessChecklistSync.exportFilenames,
      ...finalPilotReadinessChecklistSync.latestProofArtifacts.map((artifact) => artifact.artifact),
    ];

    for (const filename of syncedFiles) {
      expect(existsSync(path.join(repoRoot, filename)), `${filename} should exist`).toBe(true);
    }
  });

  it("aligns the static sales proof packet with the reusable admin export helpers", () => {
    const staticMarkdownPath = path.join(repoRoot, "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.md");
    const staticHtmlPath = path.join(repoRoot, "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.html");
    const staticPdfPath = path.join(repoRoot, "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.pdf");
    const staticMarkdown = readFileSync(staticMarkdownPath, "utf8");
    const staticHtml = readFileSync(staticHtmlPath, "utf8");
    const staticPdf = readFileSync(staticPdfPath);

    expect(staticMarkdown).toContain(buildAdminPilotReadinessProofArtifactIndexMarkdown());
    expect(staticMarkdown).toContain(buildFinalPilotReadinessSyncMarkdown());
    expect(staticMarkdown).toContain(buildReleaseProofAlignmentMarkdown());
    expect(staticMarkdown).toBe(`${buildAdminPilotReadinessProofPacketMarkdown()}\n`);
    expect(staticHtml).toContain("This generated static packet uses the same final checklist sync");
    expect(staticHtml).toContain("No broad self-serve SaaS claim");
    expect(staticHtml).toContain("docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md");
    expect(staticPdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("documents the static proof packet regeneration and drift-check path", () => {
    const readme = readFileSync(path.join(repoRoot, "docs/sales/README.md"), "utf8");

    expect(readme).toContain("npm run ops:generate-admin-pilot-readiness-proof-packet");
    expect(readme).toContain("npm run ops:check-admin-pilot-readiness-proof-packet-drift");
    expect(readme).toContain("openplan/src/lib/operations/pilot-readiness-packet.ts");
    expect(readme).toContain("buyer-safe caveats");
  });
});

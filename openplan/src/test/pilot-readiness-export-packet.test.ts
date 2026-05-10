import { describe, expect, it } from "vitest";
import { buildPilotReadinessPacket } from "@/app/(app)/admin/pilot-readiness/ExportButton";
import { releaseProofPosture } from "@/lib/operations/release-proof-packet";

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
    }

    expect(packet).toContain("No fresh same-cycle paid canary is claimed");
    expect(packet).toContain("Onboarding remains a supervised implementation step");
    expect(packet).toContain("RPO/RTO commitments are filled per managed-hosting engagement");
    expect(packet).toContain("no validated behavioral forecasting claim is made");
    expect(packet).toContain("not sold as legal-grade LAPM/compliance automation or autonomous AI planning");
  });
});

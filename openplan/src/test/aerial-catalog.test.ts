import { describe, expect, it } from "vitest";

import {
  summarizeAerialEvidenceAttachmentReadiness,
  summarizeAerialMissionPackagePosture,
} from "@/lib/aerial/catalog";

describe("aerial catalog package posture", () => {
  it("reports no-package missions as neutral", () => {
    expect(summarizeAerialMissionPackagePosture([])).toEqual({
      packageCount: 0,
      readyPackageCount: 0,
      qaPendingPackageCount: 0,
      processingPackageCount: 0,
      verificationReadyPackageCount: 0,
      attachmentReadyPackageCount: 0,
      attachmentReadyLabel: "No report attachments",
      attachmentReady: false,
      label: "No packages",
      tone: "neutral",
    });
  });

  it("distinguishes QA-pending packages from ready packages", () => {
    expect(
      summarizeAerialMissionPackagePosture([
        { status: "ready", verification_readiness: "ready" },
        { status: "qa_pending", verification_readiness: "partial" },
        { status: "processing", verification_readiness: "pending" },
      ])
    ).toMatchObject({
      packageCount: 3,
      readyPackageCount: 1,
      qaPendingPackageCount: 1,
      processingPackageCount: 1,
      verificationReadyPackageCount: 1,
      attachmentReadyPackageCount: 1,
      attachmentReadyLabel: "1/3 attachment-ready",
      attachmentReady: false,
      label: "1/3 ready · 1 QA pending",
      tone: "info",
    });
  });

  it("only calls a mission verification-ready when every package is ready/shared and verification-ready", () => {
    expect(
      summarizeAerialMissionPackagePosture([
        { status: "ready", verification_readiness: "ready" },
        { status: "shared", verification_readiness: "ready" },
      ])
    ).toMatchObject({
      readyPackageCount: 2,
      verificationReadyPackageCount: 2,
      attachmentReadyPackageCount: 2,
      attachmentReadyLabel: "Report attachment ready",
      attachmentReady: true,
      label: "2/2 verification-ready",
      tone: "success",
    });
  });
});

describe("aerial catalog attachment readiness", () => {
  it("marks a verified source-backed package ready for project, grant, report, and public-response support", () => {
    const summary = summarizeAerialEvidenceAttachmentReadiness({
      missionTitle: "SR 49 shoulder inventory",
      missionStatus: "complete",
      missionType: "corridor_survey",
      hasProjectLink: true,
      hasAoi: true,
      packages: [
        {
          title: "SR 49 orthomosaic QA bundle",
          status: "ready",
          verification_readiness: "ready",
          notes: "Operator reviewed imagery against field notes on 2026-05-09.",
          updated_at: "2026-05-09T18:00:00.000Z",
        },
      ],
    });

    expect(summary).toMatchObject({
      readiness: "ready",
      label: "Ready for project/report/grant attachment",
      attachmentReadyPackageCount: 1,
      sourceContextPackageCount: 1,
      blockers: [],
    });
    expect(summary.readyUses).toEqual(["project", "grant", "report", "public_response"]);
    expect(summary.sourceContext).toContain("SR 49 orthomosaic QA bundle");
    expect(summary.sourceContext).toContain("Operator-assisted aerial evidence only");
    expect(summary.sourceContext).toContain("No autonomous photogrammetry");
  });

  it("keeps ready packages out of downstream attachment when source notes are missing", () => {
    const summary = summarizeAerialEvidenceAttachmentReadiness({
      missionTitle: "Curb ramp capture",
      hasProjectLink: true,
      hasAoi: true,
      packages: [
        {
          title: "Curb ramp photo set",
          status: "shared",
          verification_readiness: "ready",
          notes: " ",
        },
      ],
    });

    expect(summary.readiness).toBe("needs_source_context");
    expect(summary.readyUses).toEqual([]);
    expect(summary.blockedUses).toEqual(["project", "grant", "report", "public_response"]);
    expect(summary.blockers).toContain(
      "Add package notes or source-context text so reviewers can cite what the aerial evidence actually supports."
    );
    expect(summary.sourceContext).toContain("source context is incomplete");
  });

  it("blocks attachment when packages are unverified or the mission is not linked to a project", () => {
    const summary = summarizeAerialEvidenceAttachmentReadiness({
      missionTitle: "Trailhead hazard scan",
      hasProjectLink: false,
      hasAoi: false,
      packages: [
        {
          title: "Draft surface export",
          status: "qa_pending",
          verification_readiness: "partial",
          notes: "Draft package, not for citation.",
        },
      ],
    });

    expect(summary.readiness).toBe("blocked");
    expect(summary.attachmentReadyPackageCount).toBe(0);
    expect(summary.blockers).toEqual([
      "Link the mission to a project before using aerial evidence for project, grant, report, or public-response support.",
      "At least one package must be ready/shared and verification-ready before it can support downstream materials.",
      "Draw or attach an AOI before using the package as a map exhibit.",
    ]);
  });
});

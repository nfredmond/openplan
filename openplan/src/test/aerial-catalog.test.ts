import { describe, expect, it } from "vitest";

import { summarizeAerialMissionPackagePosture } from "@/lib/aerial/catalog";

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

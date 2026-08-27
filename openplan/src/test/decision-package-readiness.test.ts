import { describe, expect, it } from "vitest";
import {
  decisionPackageFreshness,
  decisionPackageReadiness,
} from "@/lib/project-evidence-bundles/decision-package-readiness";

const HASH = "a".repeat(64);

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "project_evidence_manifest.v2",
    projectRevision: "2026-08-26T18:00:00Z",
    selectedLinkedPlan: { id: "plan-1", revisionToken: HASH },
    currentBoardOrReportPdf: { recordId: "pdf-1", checksumSha256: HASH },
    entries: [
      {
        path: "project/linked-plan.json",
        originalRecord: { sourceId: "linked_data", recordId: "plan-1" },
        inclusion: { status: "included" },
        evidence: { support: { status: "supported" } },
      },
      {
        path: "files/report.pdf",
        originalRecord: { sourceId: "report_artifacts", recordId: "pdf-1" },
        checksumSha256: HASH,
        revisionToken: HASH,
        inclusion: { status: "included" },
        evidence: { support: { status: "supported" } },
      },
    ],
    ...overrides,
  };
}

function inventory(overrides: Record<string, unknown> = {}) {
  return {
    projectRevision: "2026-08-26T18:00:00Z",
    inventoryTruncated: false,
    readFailed: false,
    candidates: [{ sourceId: "report_artifacts", recordId: "pdf-1", revisionToken: HASH }],
    linkedPlans: [{ id: "plan-1", revisionToken: HASH }],
    ...overrides,
  } as Parameters<typeof decisionPackageFreshness>[2];
}

describe("decision package approval readiness", () => {
  it("requires the v2 manifest, selected plan, and exact current PDF checksum", () => {
    expect(decisionPackageReadiness(manifest())).toBeNull();
    expect(decisionPackageReadiness(manifest({ schemaVersion: "project_evidence_manifest.v1" }))).toMatch(/current v2/i);
    expect(decisionPackageReadiness(manifest({ selectedLinkedPlan: null }))).toMatch(/linked plan/i);
    expect(decisionPackageReadiness(manifest({ currentBoardOrReportPdf: null }))).toMatch(/report PDF/i);
  });

  it("blocks point-of-use numeric evidence whose provenance is unsupported", () => {
    expect(decisionPackageReadiness(manifest({
      entries: [
        ...manifest().entries,
        { path: "modeling/claim.json", evidence: { support: { status: "unsupported" } } },
      ],
    }))).toMatch(/numeric claim lacks adequate point-of-use provenance/i);
  });

  it("requires descriptors and exact plan/PDF entry bindings", () => {
    expect(decisionPackageReadiness(manifest({ entries: [{ path: "project/linked-plan.json" }] }))).toMatch(/descriptor/i);
    expect(decisionPackageReadiness(manifest({
      entries: manifest().entries.filter((entry: { path?: string }) => entry.path !== "project/linked-plan.json"),
    }))).toMatch(/linked plan.*bound/i);
    expect(decisionPackageReadiness(manifest({
      entries: manifest().entries.map((entry: { checksumSha256?: string }) => entry.checksumSha256 ? { ...entry, checksumSha256: "b".repeat(64) } : entry),
    }))).toMatch(/PDF.*bound/i);
  });

  it("marks exact custody stale when the project, plan, or source inventory changes", () => {
    expect(decisionPackageFreshness(manifest(), "2026-08-26T18:00:00Z", inventory())).toBeNull();
    expect(decisionPackageFreshness(manifest(), "2026-08-26T17:00:00Z", inventory())).toMatch(/project record changed/i);
    expect(decisionPackageFreshness(manifest(), "2026-08-26T18:00:00Z", inventory({
      linkedPlans: [{ id: "plan-1", revisionToken: "b".repeat(64) }],
    }))).toMatch(/linked plan changed/i);
    expect(decisionPackageFreshness(manifest(), "2026-08-26T18:00:00Z", inventory({
      candidates: [{ sourceId: "report_artifacts", recordId: "pdf-1", revisionToken: "b".repeat(64) }],
    }))).toMatch(/evidence source changed/i);
    expect(decisionPackageFreshness(manifest(), "2026-08-26T18:00:00Z", inventory({ candidates: [] }))).toMatch(/inventory changed/i);
  });
});

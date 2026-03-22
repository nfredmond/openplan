import { describe, expect, it } from "vitest";
import { buildAssistantPreview, buildAssistantResponse } from "@/lib/assistant/respond";
import type { ProjectAssistantContext, RunAssistantContext } from "@/lib/assistant/context";

describe("assistant response builders", () => {
  it("builds project blocker responses from project control context", () => {
    const context: ProjectAssistantContext = {
      kind: "project",
      workspace: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Nevada County Vision Zero",
        plan: "pilot",
        role: "member",
      },
      project: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "SR-49 Safety Program",
        summary: "Countywide multimodal safety package.",
        status: "active",
        planType: "safety_plan",
        deliveryPhase: "analysis",
        updatedAt: "2026-03-21T17:00:00.000Z",
      },
      counts: {
        deliverables: 3,
        risks: 2,
        issues: 1,
        decisions: 4,
        meetings: 2,
        linkedDatasets: 2,
        overlayReadyDatasets: 1,
        recentRuns: 2,
      },
      stageGateSummary: {
        gates: [],
        passCount: 1,
        holdCount: 1,
        notStartedCount: 3,
        blockedGate: {
          gateId: "G03",
          name: "Environmental readiness",
          sequence: 3,
          workflowState: "hold",
          decisionLabel: "Hold",
          rationale: "CEQA memo still missing.",
          decidedAt: "2026-03-20T12:00:00.000Z",
          requiredEvidenceCount: 2,
          missingArtifacts: ["CEQA memo"],
          lapmMappings: [],
          ceqaVmtMappings: [],
          outreachMappings: [],
          stipRtipMappings: [],
          evidencePreview: [],
        },
        nextGate: {
          gateId: "G03",
          name: "Environmental readiness",
          sequence: 3,
          requiredEvidenceCount: 2,
        },
      },
      linkedDatasets: [],
      recentRuns: [],
    };

    const preview = buildAssistantPreview(context);
    const response = buildAssistantResponse(context, "project-blockers");

    expect(preview.title).toBe("SR-49 Safety Program");
    expect(response.title).toContain("Current blockers");
    expect(response.summary).toContain("Environmental readiness");
    expect(response.findings.join(" ")).toContain("CEQA memo");
  });

  it("builds run comparison responses from active and baseline run metrics", () => {
    const context: RunAssistantContext = {
      kind: "run",
      workspace: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Nevada County Vision Zero",
        plan: "pilot",
        role: "member",
      },
      run: {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Protected bike lane concept",
        summary: "Safety and access improved.",
        createdAt: "2026-03-21T15:00:00.000Z",
        queryText: "Evaluate protected bike lane concept.",
        metrics: {
          overallScore: 67,
          accessibilityScore: 63,
          safetyScore: 72,
          equityScore: 59,
          confidence: "medium",
        },
      },
      baselineRun: {
        id: "44444444-4444-4444-8444-444444444444",
        title: "Existing conditions",
        createdAt: "2026-03-20T15:00:00.000Z",
        metrics: {
          overallScore: 54,
          accessibilityScore: 56,
          safetyScore: 61,
          equityScore: 55,
        },
      },
    };

    const response = buildAssistantResponse(context, "run-compare");

    expect(response.title).toContain("Run comparison");
    expect(response.summary).toContain("+13");
    expect(response.findings.join(" ")).toContain("Current run confidence");
    expect(response.evidence.join(" ")).toContain("Baseline run");
  });
});

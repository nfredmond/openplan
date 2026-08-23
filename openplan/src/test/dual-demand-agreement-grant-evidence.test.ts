import { describe, expect, it } from "vitest";
import {
  buildProjectGrantDualDemandAgreementEvidenceByProjectId,
  type ProjectGrantDualDemandAgreementEvidence,
} from "@/lib/grants/modeling-evidence";
import {
  buildOpportunityFactList,
  type OpportunityEvidenceBundle,
} from "@/lib/grants/narrative-evidence";
import { validateGroundedNarrative } from "@/lib/planner-pack/grounding";

const PROJECT_ID = "project-1";
const REPORT_ID = "report-1";

function snapshot() {
  return {
    schemaVersion: "openplan.dual-demand-agreement-snapshot.v1",
    modelRunId: "22222222-2222-4222-8222-222222222222",
    artifactId: "66666666-6666-4666-8666-666666666666",
    artifactSha256: "a".repeat(64),
    assignmentProfileSha256: "b".repeat(64),
    networkSettingsSha256: "c".repeat(64),
    networkStateSha256: "d".repeat(64),
    methods: { first: "Trip-based", second: "Activity-based" },
    permittedAttributionScale: "corridor",
    thresholds: { minimumVolume: 50, gehClose: 5, gehMarginal: 10 },
    aggregate: {
      linksCompared: 12,
      linksCarryingMeaningfulTraffic: 10,
      agreeShareAllLinks: 0.75,
      agreeShareMeaningfulLinks: 0.8,
      divergeShareMeaningfulLinks: 0.1,
      agreeShareByVolume: 0.82,
      medianGehMeaningfulLinks: 3.25,
    },
    selectedCorridors: [
      {
        corridor: "Central Avenue",
        links: 3,
        firstVolume: 1200,
        secondVolume: 1050,
        geh: 4.472,
        classification: "agree",
      },
    ],
    mandatoryCaveats: [
      "Neither method is ground truth.",
      "Agreement does not mean either method is correct or establish accuracy.",
      "The methods are never averaged.",
      "GEH thresholds are borrowed screening thresholds, not local validation.",
    ],
    isAverage: false,
  };
}

function buildFrozenEvidence() {
  return buildProjectGrantDualDemandAgreementEvidenceByProjectId(
    [{
      id: REPORT_ID,
      project_id: PROJECT_ID,
      title: "Corridor Evidence Packet",
      updated_at: "2026-08-23T12:00:00.000Z",
      generated_at: "2026-08-23T12:00:00.000Z",
      latest_artifact_kind: "html",
    }],
    [{
      report_id: REPORT_ID,
      generated_at: "2026-08-23T12:00:00.000Z",
      metadata_json: { dualDemandAgreementSnapshotsV1: [snapshot()] },
    }],
  );
}

function bundle(evidence: ProjectGrantDualDemandAgreementEvidence): OpportunityEvidenceBundle {
  return {
    opportunity: {
      id: "opportunity-1",
      workspace_id: "workspace-1",
      program_id: null,
      project_id: PROJECT_ID,
      title: "Mobility grant",
      opportunity_status: "open",
      decision_state: "pursue",
    },
    projectName: "Corridor project",
    fundingSummary: null,
    modelingEvidence: null,
    modelingHeadline: null,
    modelingReadinessDetail: null,
    dualDemandAgreementEvidence: evidence,
    bcaScreening: null,
    engagementEvidence: null,
    evidenceReadinessSummary: "Review the frozen evidence before submission.",
    kbExcerpts: [],
    linkedProjectStage: null,
    rtpProgramming: null,
    completedProjects: null,
    readFailures: [],
  };
}

describe("frozen dual-demand agreement grant evidence", () => {
  it("reads the frozen report packet and emits one aggregate fact plus one fact per selected corridor", () => {
    const result = buildFrozenEvidence();
    expect(result.readFailures).toEqual([]);
    const evidence = result.evidenceByProjectId.get(PROJECT_ID);
    expect(evidence).toBeDefined();
    if (!evidence) return;

    const facts = buildOpportunityFactList(bundle(evidence), { suggestedEvidence: ["modeling"] });
    const agreementFacts = facts.filter((fact) => /dual-model agreement|Planner-selected corridor/.test(fact.claim_text));
    expect(agreementFacts).toHaveLength(2);
    expect(agreementFacts[0].claim_text).toContain("80.0%");
    expect(agreementFacts[1].claim_text).toContain("Trip-based volume 1200");
    expect(agreementFacts[1].claim_text).toContain("Activity-based volume 1050");
    expect(agreementFacts[1].claim_text).toContain("GEH 4.472");
    expect(agreementFacts.every((fact) => fact.claim_text.includes("never averaged"))).toBe(true);
    expect(agreementFacts.map((fact) => fact.claim_text).join(" ")).not.toMatch(/average volume|averaged volume/i);
    expect(agreementFacts.every((fact) => /not measure accuracy/i.test(fact.claim_text))).toBe(true);

    const corridorFact = agreementFacts[1];
    const cited = `Central Avenue has Trip-based volume 1200, Activity-based volume 1050, and GEH 4.472. [fact:${corridorFact.fact_id}]`;
    const grounded = validateGroundedNarrative(
      cited,
      facts.map((fact) => fact.fact_id),
      "annotated",
    );
    expect(grounded.isFullyGrounded).toBe(true);
  });

  it("reports an invalid frozen packet instead of falling back to live model evidence", () => {
    const invalid = snapshot();
    invalid.isAverage = true;
    const result = buildProjectGrantDualDemandAgreementEvidenceByProjectId(
      [{
        id: REPORT_ID,
        project_id: PROJECT_ID,
        title: "Corridor Evidence Packet",
        updated_at: "2026-08-23T12:00:00.000Z",
        generated_at: "2026-08-23T12:00:00.000Z",
        latest_artifact_kind: "html",
      }],
      [{
        report_id: REPORT_ID,
        generated_at: "2026-08-23T12:00:00.000Z",
        metadata_json: { dualDemandAgreementSnapshotsV1: [invalid] },
      }],
    );
    expect(result.evidenceByProjectId.has(PROJECT_ID)).toBe(false);
    expect(result.readFailures).toEqual([
      expect.objectContaining({ reportId: REPORT_ID, reason: expect.stringMatching(/failed verification/i) }),
    ]);
  });
});

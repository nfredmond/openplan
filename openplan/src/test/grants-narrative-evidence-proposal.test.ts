import { describe, expect, it } from "vitest";

import {
  buildOpportunityFactList,
  type OpportunityEvidenceBundle,
} from "@/lib/grants/narrative-evidence";

/**
 * Proposal pursuits ground on more than a grant does: the solicitation
 * fields, the linked project's stage data, and the workspace's
 * completed-projects history as past performance. Grant bundles must keep
 * exactly their old fact lists — the pursuit fields are additive.
 */

function bundle(overrides: Partial<OpportunityEvidenceBundle> = {}): OpportunityEvidenceBundle {
  return {
    opportunity: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      workspace_id: "33333333-3333-4333-8333-333333333333",
      program_id: null,
      project_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      title: "On-call planning services",
      opportunity_status: "open",
      decision_state: "pursue",
      agency_name: "A regional transportation agency",
      pursuit_kind: "proposal",
      solicitation_number: "RFP-2026-014",
      submission_format_note: "Portal upload, 20-page limit.",
      questions_due_at: "2026-08-15T00:00:00.000Z",
    },
    projectName: "Corridor study",
    fundingSummary: null,
    modelingEvidence: null,
    modelingHeadline: null,
    modelingReadinessDetail: null,
    bcaScreening: null,
    engagementEvidence: null,
    evidenceReadinessSummary: "Evidence summary.",
    kbExcerpts: [],
    linkedProjectStage: { name: "Corridor study", status: "active", deliveryPhase: "environmental" },
    completedProjects: [
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        name: "Downtown circulation plan",
        summary: "Adopted 2025 circulation element update.",
        deliveryPhase: "closeout",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function claims(factList: ReturnType<typeof buildOpportunityFactList>): string[] {
  return factList.map((fact) => fact.claim_text);
}

describe("buildOpportunityFactList — proposal pursuits", () => {
  it("includes the solicitation anchors for a proposal", () => {
    const facts = claims(buildOpportunityFactList(bundle()));

    expect(facts).toContain('The solicitation number on record for this pursuit is "RFP-2026-014".');
    expect(
      facts.some((claim) =>
        claim.includes("Submission format note on record (verify against the current solicitation): Portal upload")
      )
    ).toBe(true);
    expect(facts).toContain("Written questions to the issuing agency are due 2026-08-15.");
  });

  it("grounds schedule and past performance on project records", () => {
    const facts = claims(buildOpportunityFactList(bundle()));

    expect(
      facts.some((claim) =>
        claim.includes('The linked project Corridor study is recorded in status "active" and delivery phase "environmental".')
      )
    ).toBe(true);
    expect(
      facts.some((claim) =>
        claim.includes(
          "Completed project on record (past performance): Downtown circulation plan — Adopted 2025 circulation element update. (delivery phase: closeout)."
        )
      )
    ).toBe(true);
  });

  it("keeps solicitation anchors citable even for a kb-scoped section, but scopes project facts out", () => {
    const facts = claims(buildOpportunityFactList(bundle(), { suggestedEvidence: ["kb"] }));

    // Identity anchors always survive scoping.
    expect(facts).toContain('The solicitation number on record for this pursuit is "RFP-2026-014".');
    // Project-family facts (schedule stage, past performance) are out of scope
    // for a kb-only section like team_qualifications.
    expect(facts.some((claim) => claim.includes("Completed project on record"))).toBe(false);
    expect(facts.some((claim) => claim.includes("recorded in status"))).toBe(false);
  });

  it("adds no proposal facts to a grant pursuit — the old fact list is unchanged", () => {
    const grantFacts = claims(
      buildOpportunityFactList(
        bundle({
          opportunity: {
            ...bundle().opportunity,
            pursuit_kind: "grant",
          },
        })
      )
    );

    expect(grantFacts.some((claim) => claim.includes("solicitation number"))).toBe(false);
    expect(grantFacts.some((claim) => claim.includes("Completed project on record"))).toBe(false);
    expect(grantFacts.some((claim) => claim.includes("Written questions"))).toBe(false);
  });

  it("omits absent solicitation fields instead of inventing them", () => {
    const facts = claims(
      buildOpportunityFactList(
        bundle({
          opportunity: {
            ...bundle().opportunity,
            solicitation_number: null,
            submission_format_note: null,
            questions_due_at: null,
          },
          linkedProjectStage: null,
          completedProjects: null,
        })
      )
    );

    expect(facts.some((claim) => claim.includes("solicitation number"))).toBe(false);
    expect(facts.some((claim) => claim.includes("Submission format note"))).toBe(false);
    expect(facts.some((claim) => claim.includes("Completed project on record"))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  buildOpportunityFactList,
  type OpportunityEvidenceBundle,
} from "@/lib/grants/narrative-evidence";
import {
  withPursuitColumns,
  type OpportunityPursuitContext,
} from "@/lib/grants/pursuit";

/**
 * Proposal pursuits ground on more than a grant does: the solicitation
 * fields and the workspace's completed-projects history as past performance.
 * The linked project's identity facts (name, status, phase, summary) ground
 * BOTH pursuit kinds — a grant narrative cannot describe a project the fact
 * list never mentions. Solicitation fields stay proposal-only.
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
    linkedProjectStage: {
      name: "Corridor study",
      status: "active",
      deliveryPhase: "environmental",
      summary: "Multimodal corridor study for the main street spine.",
    },
    completedProjects: [
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        name: "Downtown circulation plan",
        summary: "Adopted 2025 circulation element update.",
        deliveryPhase: "closeout",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    readFailures: [],
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

  it("grounds grant pursuits on the linked project's identity facts too", () => {
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

    expect(grantFacts).toContain(
      'The linked project Corridor study is recorded in status "active" and delivery phase "environmental".'
    );
    expect(grantFacts).toContain(
      "The linked project's recorded summary: Multimodal corridor study for the main street spine."
    );
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

/**
 * THE TWO DOORS INTO ONE FEATURE, AND WHY THIS EXISTS.
 *
 * `loadFundingOpportunityAccess` selects a FIXED column list that omits
 * `pursuit_kind`, `solicitation_number`, `submission_format_note` and
 * `questions_due_at`. Every drafting path that used its row directly therefore
 * saw `pursuit_kind: undefined` and `isProposal` was PERMANENTLY FALSE — a
 * planner answering an RFP got a draft with no solicitation number, no
 * submission-format note, no questions-due date and no past-performance
 * grounding, and nothing said anything had been dropped.
 *
 * The per-section drafter worked around it by spreading the pursuit context
 * over the row BY HAND. The standalone narrative drafter did not. That is the
 * whole defect: one merge, written once, in one of the two callers.
 * `withPursuitColumns` is now the only merge, and this asserts what it must do.
 *
 * Found by the 2026-08-06 foundation audit as SWEEP_A3, which recorded it as
 * "a LIVE PRODUCTION DEFECT, not only an unguarded claim".
 */
describe("withPursuitColumns — the merge both drafting doors share", () => {
  const proposalContext: OpportunityPursuitContext = {
    pursuitKind: "proposal",
    solicitationNumber: "RFP-2026-014",
    submissionFormatNote: "Portal upload, 20-page limit.",
    questionsDueAt: "2026-08-15T00:00:00.000Z",
    schemaPending: false,
  };

  /** Exactly what `loadFundingOpportunityAccess` returns: no pursuit columns. */
  function accessRow() {
    return {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      workspace_id: "33333333-3333-4333-8333-333333333333",
      program_id: null,
      project_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      title: "On-call planning services",
      opportunity_status: "open",
      decision_state: "pursue",
      agency_name: "A regional transportation agency",
    };
  }

  it("puts back the four columns the access loader never selected", () => {
    const bare = accessRow() as Record<string, unknown>;
    // The starting state IS the defect: undefined, not false, not null.
    expect(bare.pursuit_kind).toBeUndefined();
    expect(bare.solicitation_number).toBeUndefined();
    expect(bare.submission_format_note).toBeUndefined();
    expect(bare.questions_due_at).toBeUndefined();

    const merged = withPursuitColumns(accessRow(), proposalContext);
    expect(merged.pursuit_kind).toBe("proposal");
    expect(merged.solicitation_number).toBe("RFP-2026-014");
    expect(merged.submission_format_note).toBe("Portal upload, 20-page limit.");
    expect(merged.questions_due_at).toBe("2026-08-15T00:00:00.000Z");
  });

  it("keeps every other column the access loader did select", () => {
    const merged = withPursuitColumns(accessRow(), proposalContext) as Record<string, unknown>;
    for (const [key, value] of Object.entries(accessRow())) {
      expect(merged[key], `${key} survived the merge`).toEqual(value);
    }
  });

  it("produces the proposal facts a draft needs, which the bare row does not", () => {
    // The consequence, asserted end to end through the real fact builder: the
    // unmerged row yields a grant fact list with no solicitation grounding.
    const bareFacts = claims(buildOpportunityFactList(bundle({ opportunity: accessRow() as never })));
    expect(bareFacts.some((claim) => claim.includes("RFP-2026-014"))).toBe(false);

    const mergedFacts = claims(
      buildOpportunityFactList(
        bundle({ opportunity: withPursuitColumns(accessRow(), proposalContext) as never })
      )
    );
    expect(mergedFacts.some((claim) => claim.includes("RFP-2026-014"))).toBe(true);
    expect(mergedFacts.some((claim) => claim.includes("Portal upload"))).toBe(true);
    expect(mergedFacts.some((claim) => claim.includes("2026-08-15"))).toBe(true);
  });

  it("carries a grant pursuit through unchanged, so the merge is not a promotion", () => {
    const grantContext: OpportunityPursuitContext = {
      pursuitKind: "grant",
      solicitationNumber: null,
      submissionFormatNote: null,
      questionsDueAt: null,
      schemaPending: false,
    };
    const merged = withPursuitColumns(accessRow(), grantContext);
    expect(merged.pursuit_kind).toBe("grant");
    expect(merged.solicitation_number).toBeNull();

    const facts = claims(buildOpportunityFactList(bundle({ opportunity: merged as never })));
    expect(facts.some((claim) => claim.includes("RFP-2026-014"))).toBe(false);
  });

  it("carries a PENDING pursuit schema through as a grant, never as a gap", () => {
    // A deployment predating migration 20260727000015 has no pursuit columns and
    // therefore no proposal rows, so 'grant' is the truthful answer rather than
    // a guess — and the merge must not turn it into undefined again.
    const pendingContext: OpportunityPursuitContext = {
      pursuitKind: "grant",
      solicitationNumber: null,
      submissionFormatNote: null,
      questionsDueAt: null,
      schemaPending: true,
    };
    const merged = withPursuitColumns(accessRow(), pendingContext);
    expect(merged.pursuit_kind).toBe("grant");
    expect(merged.pursuit_kind).not.toBeUndefined();
  });
});

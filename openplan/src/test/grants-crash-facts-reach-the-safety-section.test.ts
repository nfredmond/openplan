import { describe, expect, it } from "vitest";

import {
  buildOpportunityFactList,
  type OpportunityEvidenceBundle,
} from "@/lib/grants/narrative-evidence";
import { usFederalPrograms } from "@/lib/grants/programs/us-federal";
import {
  summarizeCampaignCorroboration,
  type NearbyCrashRow,
} from "@/lib/engagement/crash-corroboration";

/**
 * THE SECTION A REVIEWER SCORES THE SAFETY PROBLEM IN MUST BE ABLE TO CITE WHAT
 * RESIDENTS REPORTED ABOUT IT.
 *
 * A section's `suggestedEvidence` decides which facts the model may cite there;
 * anything outside the scope is flagged by the grounding validator, so a
 * narrowed scope does not fail loudly — the evidence just quietly stops being
 * usable. This is the repository's recorded shipped-invisible defect class:
 * complete, tested capability that nothing can reach.
 *
 * When the crash-proximity facts first shipped they were citable only in SS4A's
 * outreach-process section, where a reviewer scoring the PROBLEM STATEMENT would
 * never look. This test walks the real catalog and the real fact builder, so it
 * fails if either the scope or the fact family narrows again.
 */

function corroboration() {
  const row = (over: Partial<NearbyCrashRow>): NearbyCrashRow => ({
    id: "item-1",
    campaign_id: "campaign-1",
    category_id: null,
    title: null,
    body: "cars run this crossing",
    latitude: 38.5968,
    longitude: -121.49,
    votes_count: 0,
    covered_by_ingest: true,
    coverage_years: [2024, 2025],
    coverage_severity_completeness: ["kabco_full"],
    crash_total: 0,
    fatal_count: 0,
    severe_injury_count: 0,
    injury_count: 0,
    pdo_count: 0,
    killed_total: 0,
    injured_total: 0,
    pedestrian_crashes: 0,
    bicyclist_crashes: 0,
    nearest_crash_meters: null,
    earliest_crash_year: null,
    latest_crash_year: null,
    ...over,
  });
  return summarizeCampaignCorroboration(
    [
      row({ id: "a", crash_total: 6 }),
      row({ id: "b", covered_by_ingest: false, coverage_years: null }),
    ],
    100
  );
}

function bundle(): OpportunityEvidenceBundle {
  return {
    opportunity: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      workspace_id: "33333333-3333-4333-8333-333333333333",
      program_id: null,
      project_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      title: "Safe Streets and Roads for All",
      opportunity_status: "open",
      decision_state: "pursue",
      agency_name: "USDOT",
    },
    projectName: "Ridge Road",
    fundingSummary: null,
    modelingEvidence: null,
    modelingHeadline: null,
    modelingReadinessDetail: null,
    bcaScreening: null,
    engagementEvidence: {
      projectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      campaignCount: 1,
      leadCampaign: {
        id: "campaign-1",
        title: "Ridge Road Listening Campaign",
        status: "active",
        synthesis: null,
        synthesizedAt: null,
        representativeness: null,
        representativenessComputedAt: null,
        crashCorroboration: corroboration(),
      },
    },
    evidenceReadinessSummary: "Evidence summary.",
    kbExcerpts: [],
    linkedProjectStage: null,
    rtpProgramming: null,
    completedProjects: null,
    readFailures: [],
  };
}

/** The catalog's own section, found by key — never a copy of its scope. */
function sectionScope(programKey: string, sectionKey: string) {
  const program = usFederalPrograms.programs.find((entry) => entry.key === programKey);
  if (!program) throw new Error(`no program ${programKey} in the catalog`);
  const section = program.applicationSections?.find((entry) => entry.key === sectionKey);
  if (!section) throw new Error(`no section ${sectionKey} on ${programKey}`);
  return section.suggestedEvidence ?? [];
}

describe("crash-proximity facts reach the sections that score a safety problem", () => {
  const SAFETY_SECTIONS: Array<[string, string]> = [
    ["ss4a", "safety-problem-and-impact"],
    ["hsip", "crash-history-analysis"],
  ];

  for (const [programKey, sectionKey] of SAFETY_SECTIONS) {
    it(`${programKey} → ${sectionKey} can cite what residents reported`, () => {
      const facts = buildOpportunityFactList(bundle(), {
        suggestedEvidence: sectionScope(programKey, sectionKey),
      }).map((fact) => fact.claim_text);

      expect(
        facts.some((claim) => claim.includes("sit within 100 m of at least one reported collision")),
        `${sectionKey} cannot cite the collision-proximity reading`
      ).toBe(true);
      // And the data gap travels with it — a section allowed to cite the
      // corroborated half but not the unmeasured half would let a drafter imply
      // the whole campaign had been checked.
      expect(
        facts.some((claim) => claim.includes("fall outside every completed crash acquisition")),
        `${sectionKey} cannot cite the data gap`
      ).toBe(true);
    });
  }

  it("still scopes the facts out of a section that asks for none of this evidence", () => {
    // The scoping mechanism has to still work, or the test above would pass
    // for a fact list that ignores scope entirely.
    const facts = buildOpportunityFactList(bundle(), { suggestedEvidence: ["funding"] }).map(
      (fact) => fact.claim_text
    );

    expect(facts.some((claim) => claim.includes("reported collision"))).toBe(false);
  });
});

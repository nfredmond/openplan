import { describe, expect, it } from "vitest";
import { ENGAGEMENT_SENTIMENTS } from "@/lib/engagement/ai-synthesis";
import { REPRESENTATIVENESS_SCREENING_CAVEAT } from "@/lib/engagement/representativeness";
import {
  ENGAGEMENT_NARRATIVE_CAVEAT,
  buildEngagementFactClaims,
  buildProjectEngagementEvidenceByProjectId,
  parseStoredEngagementSynthesis,
  parseStoredRepresentativeness,
  summarizeEngagementForCue,
  type ProjectEngagementCampaignRowLike,
  type ProjectEngagementEvidence,
} from "@/lib/grants/engagement-evidence";

const validSynthesis = {
  source: "ai",
  model: "claude-haiku-4-5-20251001",
  fallback_reason: null,
  item_count: 50,
  analyzed_item_count: 42,
  overall_sentiment: "mixed",
  themes: [
    { label: "Crossing safety", sentiment: "negative", item_count: 12, fact_ids: [], summary: "" },
    { label: "Bike lanes", sentiment: "positive", item_count: 18, fact_ids: [], summary: "" },
    { label: "Parking", sentiment: "negative", item_count: 5, fact_ids: [], summary: "" },
    { label: "Transit stops", sentiment: "neutral", item_count: 7, fact_ids: [], summary: "" },
  ],
  narrative: "…",
  caveat: "…",
};

const validRepresentativeness = {
  computedAt: "2026-07-19T12:00:00.000Z",
  locatedRespondentCount: 40,
  studyAreaSource: "respondent_extent",
  respondentCount: 38,
  tractCount: 9,
  underRepresented: ["zeroVehicle"],
  caveat: "…",
  metrics: [
    { key: "minority", label: "Residents of color (ACS)", baselinePct: 30, respondentPct: 28, representationRatio: 0.93, status: "balanced" },
    { key: "zeroVehicle", label: "Zero-vehicle households", baselinePct: 12, respondentPct: 6, representationRatio: 0.5, status: "under" },
  ],
};

function campaignRow(
  overrides: Partial<ProjectEngagementCampaignRowLike>
): ProjectEngagementCampaignRowLike {
  return {
    id: "camp-1",
    project_id: "project-1",
    title: "Main St corridor feedback",
    status: "active",
    updated_at: "2026-07-18T00:00:00.000Z",
    ai_synthesis_json: null,
    ai_synthesized_at: null,
    representativeness_json: null,
    representativeness_computed_at: null,
    ...overrides,
  };
}

describe("parseStoredEngagementSynthesis", () => {
  it("parses a stored synthesis down to citable fields, top themes first", () => {
    const parsed = parseStoredEngagementSynthesis(validSynthesis);
    expect(parsed).not.toBeNull();
    expect(parsed?.source).toBe("ai");
    expect(parsed?.analyzedItemCount).toBe(42);
    expect(parsed?.overallSentiment).toBe("mixed");
    // Top 3 by item_count, descending — "Parking" (5) is cut.
    expect(parsed?.themes.map((theme) => theme.label)).toEqual([
      "Bike lanes",
      "Crossing safety",
      "Transit stops",
    ]);
  });

  it("rejects malformed payloads instead of guessing", () => {
    expect(parseStoredEngagementSynthesis(null)).toBeNull();
    expect(parseStoredEngagementSynthesis("summary text")).toBeNull();
    expect(parseStoredEngagementSynthesis({ ...validSynthesis, source: "human" })).toBeNull();
    expect(
      parseStoredEngagementSynthesis({ ...validSynthesis, analyzed_item_count: "42" })
    ).toBeNull();
    expect(
      parseStoredEngagementSynthesis({ ...validSynthesis, overall_sentiment: "angry" })
    ).toBeNull();
    // Malformed themes are skipped, not fatal.
    const parsed = parseStoredEngagementSynthesis({
      ...validSynthesis,
      themes: [{ label: "ok", sentiment: "positive", item_count: 3 }, { label: "", item_count: 2 }, null],
    });
    expect(parsed?.themes).toEqual([{ label: "ok", sentiment: "positive", itemCount: 3 }]);
  });

  it("stays in lock-step with the ai-synthesis sentiment vocabulary", () => {
    for (const sentiment of ENGAGEMENT_SENTIMENTS) {
      expect(
        parseStoredEngagementSynthesis({ ...validSynthesis, overall_sentiment: sentiment })
          ?.overallSentiment
      ).toBe(sentiment);
    }
  });
});

describe("parseStoredRepresentativeness", () => {
  it("parses the screening verdict and collects under-represented labels", () => {
    const parsed = parseStoredRepresentativeness(validRepresentativeness);
    expect(parsed).toEqual({
      respondentCount: 38,
      tractCount: 9,
      underRepresentedLabels: ["Zero-vehicle households"],
      insufficient: false,
    });
  });

  it("marks an all-insufficient screening and rejects malformed payloads", () => {
    const insufficient = parseStoredRepresentativeness({
      ...validRepresentativeness,
      metrics: validRepresentativeness.metrics.map((metric) => ({ ...metric, status: "insufficient" })),
    });
    expect(insufficient?.insufficient).toBe(true);

    expect(parseStoredRepresentativeness(null)).toBeNull();
    expect(parseStoredRepresentativeness({ respondentCount: 38 })).toBeNull();
    expect(
      parseStoredRepresentativeness({ ...validRepresentativeness, metrics: [] })
    ).toBeNull();
    expect(
      parseStoredRepresentativeness({ ...validRepresentativeness, respondentCount: -1 })
    ).toBeNull();
  });
});

describe("buildProjectEngagementEvidenceByProjectId", () => {
  it("groups by project, skips archived/unlinked, and leads with the largest synthesis", () => {
    const evidence = buildProjectEngagementEvidenceByProjectId([
      campaignRow({ id: "camp-unsynth", updated_at: "2026-07-19T00:00:00.000Z" }),
      campaignRow({
        id: "camp-synth",
        title: "Downtown circulation",
        ai_synthesis_json: validSynthesis,
        ai_synthesized_at: "2026-07-18T12:00:00.000Z",
      }),
      campaignRow({ id: "camp-archived", status: "archived" }),
      campaignRow({ id: "camp-unlinked", project_id: null }),
      campaignRow({ id: "camp-other", project_id: "project-2" }),
    ]);

    expect([...evidence.keys()].sort()).toEqual(["project-1", "project-2"]);
    const projectOne = evidence.get("project-1");
    // Archived is excluded from the count; the synthesized campaign leads even
    // though the unsynthesized one is newer.
    expect(projectOne?.campaignCount).toBe(2);
    expect(projectOne?.leadCampaign.id).toBe("camp-synth");
    expect(projectOne?.leadCampaign.synthesis?.analyzedItemCount).toBe(42);
    expect(evidence.get("project-2")?.leadCampaign.synthesis).toBeNull();
  });
});

describe("buildEngagementFactClaims", () => {
  const fullEvidence = (): ProjectEngagementEvidence =>
    buildProjectEngagementEvidenceByProjectId([
      campaignRow({
        ai_synthesis_json: validSynthesis,
        ai_synthesized_at: "2026-07-18T12:00:00.000Z",
        representativeness_json: validRepresentativeness,
        representativeness_computed_at: "2026-07-19T12:00:00.000Z",
      }),
    ]).get("project-1")!;

  it("emits campaign, synthesis, theme, and representativeness claims with verbatim caveats", () => {
    const claims = buildEngagementFactClaims(fullEvidence(), "Main St Bridge");

    expect(claims).toHaveLength(4);
    expect(claims[0]).toContain('1 public engagement campaign(s) are on record for the Main St Bridge project');
    expect(claims[1]).toContain("An AI-assisted synthesis of 42 approved public comments");
    expect(claims[1]).toContain("Jul 18, 2026");
    expect(claims[1]).toContain("mixed community sentiment");
    expect(claims[1]).toContain(ENGAGEMENT_NARRATIVE_CAVEAT);
    expect(claims[2]).toContain('"Bike lanes" (18 comment(s), positive)');
    expect(claims[2]).toContain(ENGAGEMENT_NARRATIVE_CAVEAT);
    expect(claims[3]).toContain("38 geolocated respondents across 9 study-area tracts");
    expect(claims[3]).toContain("Zero-vehicle households");
    expect(claims[3]).toContain(REPRESENTATIVENESS_SCREENING_CAVEAT);
  });

  it("labels a deterministic-fallback synthesis as keyword-based, never as AI", () => {
    const evidence = buildProjectEngagementEvidenceByProjectId([
      campaignRow({
        ai_synthesis_json: { ...validSynthesis, source: "deterministic-fallback" },
        ai_synthesized_at: "2026-07-18T12:00:00.000Z",
      }),
    ]).get("project-1")!;

    const claims = buildEngagementFactClaims(evidence, null);
    expect(claims[1]).toContain("A keyword-based synthesis (computed while AI was offline)");
    expect(claims[1]).not.toContain("AI-assisted");
  });

  it("keeps an unsynthesized campaign to the record claim only — no sentiment to cite", () => {
    const evidence = buildProjectEngagementEvidenceByProjectId([campaignRow({})]).get("project-1")!;
    const claims = buildEngagementFactClaims(evidence, null);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toContain("the linked project");
  });

  it("reports an insufficient representativeness sample as such", () => {
    const evidence = buildProjectEngagementEvidenceByProjectId([
      campaignRow({
        representativeness_json: {
          ...validRepresentativeness,
          metrics: validRepresentativeness.metrics.map((metric) => ({ ...metric, status: "insufficient" })),
        },
        representativeness_computed_at: "2026-07-19T12:00:00.000Z",
      }),
    ]).get("project-1")!;

    const claims = buildEngagementFactClaims(evidence, null);
    expect(claims[1]).toContain("too few geolocated respondents");
    expect(claims[1]).toContain(REPRESENTATIVENESS_SCREENING_CAVEAT);
  });
});

describe("summarizeEngagementForCue", () => {
  it("compresses the evidence to one line and never overstates missing pieces", () => {
    const unsynthesized = buildProjectEngagementEvidenceByProjectId([campaignRow({})]).get("project-1")!;
    expect(summarizeEngagementForCue(unsynthesized)).toContain("No comment synthesis is saved yet");

    const synthesized = buildProjectEngagementEvidenceByProjectId([
      campaignRow({ ai_synthesis_json: validSynthesis, ai_synthesized_at: "2026-07-18T12:00:00.000Z" }),
    ]).get("project-1")!;
    const summary = summarizeEngagementForCue(synthesized);
    expect(summary).toContain("AI synthesis of 42 approved comment(s)");
    expect(summary).toContain("no representativeness screening saved");
  });
});

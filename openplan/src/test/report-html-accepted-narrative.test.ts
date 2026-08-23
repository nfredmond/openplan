import { describe, expect, it } from "vitest";
import {
  buildProjectStageGateSnapshot,
  buildProjectStageGateSummary,
} from "@/lib/stage-gates/summary";
import {
  AI_NARRATIVE_ACCEPTED_LABEL,
  AI_NARRATIVE_STALE_NOTICE,
  buildReportHtml,
  type ReportGenerationData,
} from "@/lib/reports/html";
import {
  buildAcceptedSectionNarratives,
  type AcceptedSectionNarrative,
} from "@/lib/reports/narrative-drafts";

/**
 * Inclusion contract: only ACCEPTED narrative rows reach a packet, always
 * under the AI-assistance label with grounding stats, staleness is disclosed
 * visibly, and citation tokens never render.
 */

function baseData(overrides?: Partial<ReportGenerationData>): ReportGenerationData {
  return {
    report: {
      id: "report-1",
      title: "Main St Bridge Board Packet",
      summary: null,
      report_type: "board_packet",
      created_at: "2026-07-01T00:00:00.000Z",
    },
    workspace: { id: "ws-1", name: "Test Workspace" },
    project: {
      id: "project-1",
      name: "Main St Bridge",
      summary: null,
      status: "active",
      plan_type: "capital",
      delivery_phase: "design",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z",
    },
    runs: [],
    sections: [
      {
        id: "section-1",
        section_key: "executive_summary",
        title: "Executive summary",
        enabled: true,
        sort_order: 0,
        config_json: {},
      },
      {
        id: "section-2",
        section_key: "assumptions_provenance",
        title: "Methods and provenance",
        enabled: true,
        sort_order: 1,
        config_json: {},
      },
    ],
    deliverables: [],
    risks: [],
    issues: [],
    decisions: [],
    meetings: [],
    engagement: null,
    scenarioSetLinks: [],
    projectFundingSnapshot: null,
    projectRecordsSnapshot: {
      deliverables: { count: 0, latestTitle: null, latestAt: null },
      risks: { count: 0, latestTitle: null, latestAt: null },
      issues: { count: 0, latestTitle: null, latestAt: null },
      decisions: { count: 0, latestTitle: null, latestAt: null },
      meetings: { count: 0, latestTitle: null, latestAt: null },
    },
    stageGateSnapshot: buildProjectStageGateSnapshot(buildProjectStageGateSummary([], { templateId: "ca_stage_gates_v0_1" })),
    modelingEvidence: [],
    ...overrides,
  };
}

function narrative(overrides?: Partial<AcceptedSectionNarrative>): AcceptedSectionNarrative {
  return {
    draftId: "draft-1",
    sectionKey: "executive_summary",
    bodyMarkdown: "The Main St Bridge project is in design.\n\nFunding posture is documented.",
    model: "claude-opus-4-8",
    groundedSentenceCount: 3,
    totalSentenceCount: 3,
    acceptedAt: "2026-07-26T00:00:00.000Z",
    operatorEdited: false,
    stale: false,
    ...overrides,
  };
}

describe("buildReportHtml accepted-narrative rendering", () => {
  it("renders frozen aggregate evidence and only planner-selected corridor rows without an average", () => {
    const html = buildReportHtml(baseData({
      dualDemandAgreementSnapshotsV1: [{
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
        selectedCorridors: [{
          corridor: "Central Avenue",
          links: 3,
          firstVolume: 1200,
          secondVolume: 1050,
          geh: 4.472,
          classification: "agree",
        }],
        mandatoryCaveats: [
          "Neither method is ground truth.",
          "Agreement does not mean either method is correct or establish accuracy.",
          "The methods are never averaged.",
          "GEH thresholds are borrowed screening thresholds, not local validation.",
        ],
        isAverage: false,
      }],
    }));

    expect(html).toContain("Dual-model agreement evidence");
    expect(html).toContain("Central Avenue");
    expect(html).toContain("Trip-based volume");
    expect(html).toContain("Activity-based volume");
    expect(html).toContain("4.472");
    expect(html).toContain("Source run 22222222-2222-4222-8222-222222222222");
    expect(html).toContain("Methodological sensitivity, not accuracy");
    expect(html).toContain("never averaged");
    expect(html).not.toMatch(/average volume/i);
  });

  it("renders the accepted block under its section with the AI label and grounding stats", () => {
    const html = buildReportHtml(baseData({ acceptedNarratives: [narrative()] }));

    expect(html).toContain(AI_NARRATIVE_ACCEPTED_LABEL);
    expect(html).toContain("The Main St Bridge project is in design.");
    expect(html).toContain("3 of 3 draft sentences cited verifiable workspace facts");
    expect(html).toContain("model claude-opus-4-8");
    // Fresh narrative carries no staleness disclosure.
    expect(html).not.toContain(AI_NARRATIVE_STALE_NOTICE);
  });

  it("renders a VISIBLE staleness disclosure when the underlying facts changed", () => {
    const html = buildReportHtml(baseData({ acceptedNarratives: [narrative({ stale: true })] }));

    expect(html).toContain("Underlying data changed since acceptance.");
    expect(html).toContain(AI_NARRATIVE_STALE_NOTICE);
    // The block itself still renders — disclosed, never silently dropped.
    expect(html).toContain("The Main St Bridge project is in design.");
  });

  it("discloses every AI-assisted block in the methods/provenance section", () => {
    const html = buildReportHtml(baseData({ acceptedNarratives: [narrative({ stale: true })] }));

    expect(html).toContain("AI-assisted narrative blocks");
    expect(html).toContain("Executive Summary");
    expect(html).toContain("UNDERLYING DATA CHANGED SINCE ACCEPTANCE");
  });

  it("renders no AI markup at all when no accepted narratives are passed", () => {
    const html = buildReportHtml(baseData());

    expect(html).not.toContain(AI_NARRATIVE_ACCEPTED_LABEL);
    expect(html).not.toContain("AI-assisted narrative blocks");
  });

  it("marks operator-edited blocks in the stats line", () => {
    const html = buildReportHtml(
      baseData({ acceptedNarratives: [narrative({ operatorEdited: true })] })
    );

    expect(html).toContain("operator-edited before acceptance");
  });
});

describe("buildAcceptedSectionNarratives", () => {
  const storedRow = (overrides?: Record<string, unknown>) => ({
    id: "draft-1",
    workspace_id: "ws-1",
    target_kind: "report_section",
    target_id: "report-1",
    section_key: "executive_summary",
    draft_markdown: "Grounded sentence. [fact:fact_1]",
    model: "claude-opus-4-8",
    grounding_json: { mode: "annotated" },
    grounded_sentence_count: 1,
    total_sentence_count: 1,
    facts_hash: "hash-current",
    status: "accepted",
    accepted_markdown: "Grounded sentence. [fact:fact_1]",
    accepted_by: "user-1",
    accepted_at: "2026-07-26T00:00:00.000Z",
    created_by: "user-1",
    created_at: "2026-07-25T00:00:00.000Z",
    ...overrides,
  });

  const currentHash = () => "hash-current";

  it("ignores draft and dismissed rows — only accepted rows reach a packet", () => {
    const resolved = buildAcceptedSectionNarratives(
      [
        storedRow({ id: "draft-a", status: "draft" }),
        storedRow({ id: "draft-b", status: "dismissed" }),
      ],
      currentHash
    );
    expect(resolved).toEqual([]);
  });

  it("strips citation tokens from the included body while the stored row keeps them", () => {
    const [resolved] = buildAcceptedSectionNarratives([storedRow()], currentHash);
    expect(resolved.bodyMarkdown).toBe("Grounded sentence.");
  });

  it("keeps the latest acceptance per section when several accepted rows exist", () => {
    const resolved = buildAcceptedSectionNarratives(
      [
        storedRow({ id: "older", accepted_at: "2026-07-20T00:00:00.000Z" }),
        storedRow({ id: "newer", accepted_at: "2026-07-26T00:00:00.000Z" }),
      ],
      currentHash
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0].draftId).toBe("newer");
  });

  it("flags staleness when the recomputed facts hash differs from the stored one", () => {
    const [fresh] = buildAcceptedSectionNarratives([storedRow()], currentHash);
    expect(fresh.stale).toBe(false);

    const [stale] = buildAcceptedSectionNarratives([storedRow()], () => "hash-moved");
    expect(stale.stale).toBe(true);
  });

  it("marks operator-edited only when the accepted text genuinely differs from the draft", () => {
    const [asIs] = buildAcceptedSectionNarratives([storedRow()], currentHash);
    expect(asIs.operatorEdited).toBe(false);

    // Token-stripped but otherwise identical text is not an edit.
    const [strippedOnly] = buildAcceptedSectionNarratives(
      [storedRow({ accepted_markdown: "Grounded sentence." })],
      currentHash
    );
    expect(strippedOnly.operatorEdited).toBe(false);

    const [edited] = buildAcceptedSectionNarratives(
      [storedRow({ accepted_markdown: "Rewritten by the operator." })],
      currentHash
    );
    expect(edited.operatorEdited).toBe(true);
    expect(edited.bodyMarkdown).toBe("Rewritten by the operator.");
  });

  it("skips malformed rows and rtp_chapter rows", () => {
    const resolved = buildAcceptedSectionNarratives(
      [
        { garbage: true },
        storedRow({ target_kind: "rtp_chapter", section_key: null }),
        storedRow(),
      ],
      currentHash
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0].sectionKey).toBe("executive_summary");
  });
});

/**
 * BOTH SAFETY EXPORTS PRINT STORED IDENTIFIERS AS WORDS (KI-2026-11-14-340).
 *
 * The first proven job's six PDFs printed the codes the product stores:
 * `review-required` and `annual-ledger-1` in the benefit-cost summary,
 * `source ccrs-ca`, `source fars-national` and `segment road:534444c2:53` in
 * its input table, and `us_federal_aid_stage_gates_v0_1`,
 * `programming-eligibility` and `Scope: external_handoff` in each plan. A
 * county public works director or a tribal transportation planner reads these
 * documents; none of those codes means anything to them.
 *
 * This renders the whole safety action plan report and the whole SS4A packet
 * from one fixture that carries every block the proof job printed, and looks
 * for code-shaped text in what a reader sees. The patterns come from the code:
 *  - snake_case ids (stage-gate template ids, scopes, stored enums);
 *  - high-injury segment ids, from the attachment pattern in
 *    `safety-action-plan.ts` (`road:<key>:<piece>`, `grid:<col>:<row>`);
 *  - schema names (`openplan.<name>.v<n>`);
 *  - the hyphenated values the product stores and could print bare: every
 *    crash source id in the source registry, every stage-gate template id and
 *    gate id in the template registry, the benefit-cost engine versions, and
 *    the workbench's hyphenated calculation and input statuses.
 *
 * Allowed, because there the identifier is the point (a reviewer follows it
 * to a record or checks a hash against it):
 *  - "Payload schema: <schema>." in the jurisdiction context block, the name
 *    a reviewer validates the attached readiness payload against;
 *  - a jurisdiction declaration's "Source reference", which is what staff
 *    typed, printed as typed;
 *  - repository file paths beside their SHA-256 in the readiness appendix;
 *  - record UUIDs and hashes in source lines (not code-shaped by these
 *    patterns, so they need no entry).
 *
 * Blind category: text a planner typed into a section (printed as written),
 * sections seeded before a wording change (stored text, kept), codes in a
 * block this fixture does not reach (other report sections, other grant
 * programs), and a code that is an ordinary English word ("calculated").
 */
import { describe, expect, it } from "vitest";
import { addBcaSafetyStream } from "@/lib/bca/workbench/safety-evidence";
import { exampleBcaDocument } from "@/lib/bca/workbench/document";
import { BCA_ENGINE_VERSION } from "@/lib/bca/parameters";
import { calculateBcaDocument, WORKBENCH_ENGINE_VERSION } from "@/lib/bca/workbench/engine";
import type { BcaDocument } from "@/lib/bca/workbench/schema";
import { buildGrantApplicationHtml, type GrantApplicationExportSection } from "@/lib/grants/application-html";
import type { ApplicationSectionRow } from "@/lib/grants/application";
import { SS4A_APPENDIX_KEYS } from "@/lib/grants/ss4a-appendix-keys";
import { buildSs4aEvidenceAppendices } from "@/lib/grants/ss4a-evidence-appendices";
import { buildSs4aSafetyDrafts } from "@/lib/grants/ss4a-safety-seed";
import { buildProjectJurisdictionReadinessExportPayload } from "@/lib/jurisdiction-readiness/payload";
import { clearedProjectPlace } from "@/lib/projects/project-place";
import { buildReportHtml, type ReportGenerationData } from "@/lib/reports/html";
import { buildSafetyActionPlanSection } from "@/lib/reports/safety-action-plan";
import { buildSafetyPlanNetworkMap, buildSafetyPlanSupport } from "@/lib/reports/safety-plan-support";
import type { BcaCountedSegment, BcaSafetyPlanOffer } from "@/lib/safety/bca-evidence";
import { buildSafetyCrashEvidence } from "@/lib/safety/crash-evidence";
import { CRASH_SOURCE_ADAPTERS } from "@/lib/safety/sources/registry";
import { buildProjectStageGateSnapshot, buildProjectStageGateSummary } from "@/lib/stage-gates/summary";
import { stageGateTemplateRegistry } from "@/lib/stage-gates/template-registry";
import { BCA_VERSION_ROW, completeEvidenceRecords, EVIDENCE_DATE, EVIDENCE_IDS, evidenceRoads, evidenceSnapshot, fixtureNetwork, STUDY_AREA } from "./fixtures/grants/ss4a-evidence";

// ---------------------------------------------------------------------------
// The patterns, from the code.
// ---------------------------------------------------------------------------

const calculationStatuses: Array<ReturnType<typeof calculateBcaDocument>["status"]> = ["calculated", "review-required", "incomplete"];
const inputStatuses: Array<BcaDocument["evidence"][number]["status"]> = ["documented", "assumption", "missing", "model-screening"];

/** Stored values with a hyphen: a word a reader would never write that way. */
const HYPHENATED_CODES = [
  ...CRASH_SOURCE_ADAPTERS.map((adapter) => adapter.id),
  ...stageGateTemplateRegistry.list().flatMap((descriptor) => [
    descriptor.templateId,
    ...(stageGateTemplateRegistry.get(descriptor.templateId)?.document.gates.map((gate) => gate.gate_id) ?? []),
  ]),
  WORKBENCH_ENGINE_VERSION,
  BCA_ENGINE_VERSION,
  ...calculationStatuses,
  ...inputStatuses,
].filter((code) => /[-_]/.test(code));

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const CODE_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // Either case: stage-gate evidence ids are upper case ("G02_E03").
  { name: "snake_case id", pattern: /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/g },
  { name: "high-injury segment id", pattern: /\b(?:road|grid):[^\s,;)]+/g },
  { name: "schema name", pattern: /\bopenplan\.[a-z0-9_.-]+\.v\d+\b/g },
  { name: "stored code value", pattern: new RegExp(`(?<![\\w-])(?:${HYPHENATED_CODES.map(escape).join("|")})(?![\\w-])`, "g") },
];

/** Where an identifier is the point. Each match is removed before the patterns run. */
const ALLOWED: Array<{ name: string; pattern: RegExp }> = [
  { name: "the readiness payload's schema", pattern: /Payload schema: openplan\.[a-z0-9_.-]+\.v\d+\./g },
  { name: "a declaration's source reference, as staff typed it", pattern: /Source reference: [^.]+\./g },
  { name: "a repository file path beside its hash", pattern: /\b[\w.-]+(?:\/[\w.-]+)+\.(?:ts|tsx|md|json|mjs)\b/g },
];

/** What a reader sees: no markup, styles, drawings, or link targets; entities decoded. */
function readerText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ");
}

/** Every code-shaped token a reader would see, with the pattern that found it. */
function codesIn(html: string): string[] {
  let text = readerText(html);
  for (const { pattern } of ALLOWED) text = text.replace(pattern, " ");
  return CODE_PATTERNS.flatMap(({ name, pattern }) => [...text.matchAll(pattern)].map((match) => `${name}: ${match[0]}`));
}

// ---------------------------------------------------------------------------
// One project, every block the proof job printed.
// ---------------------------------------------------------------------------

/** A saved analysis with one safety stream from the plan's top segment, as the workbench adds it. */
function bcaWithSafetyStream(): BcaDocument {
  const network = fixtureNetwork();
  const segment = network.segments[0];
  const counted: BcaCountedSegment = {
    status: "counted", segmentId: segment.id, segmentLabel: segment.label,
    countermeasures: [{ id: "walkways", name: "Walkways", cmfNote: "[VERIFY]", listStatus: null }],
    years: [{ year: 2023, fatalCrashes: 2, seriousInjuryCrashes: null }, { year: 2024, fatalCrashes: 1, seriousInjuryCrashes: null }],
    fatalCrashes: 3, seriousInjuryCrashes: null, fatalities: 3, fatalCrashesWithoutPersonCount: 0,
  };
  const plan: Extract<BcaSafetyPlanOffer, { status: "ready" }> = {
    status: "ready", reportId: EVIDENCE_IDS.report, reportTitle: "Example safety action plan", ingestId: EVIDENCE_IDS.ingest,
    sourceId: "fars-national", sourceLabel: "NHTSA Fatality Analysis Reporting System (FARS)", coverage: "Fatal crashes only.",
    years: [2023, 2024], seriousInjury: "not_in_source", caveats: [], segments: [counted],
  };
  return addBcaSafetyStream(exampleBcaDocument(EVIDENCE_IDS.project), plan, counted, { outcome: "fatality", persons: null, cmf: 0.84, cmfId: 2438 });
}

function bcaRead() {
  return { status: "version" as const, row: { ...BCA_VERSION_ROW(), document_json: bcaWithSafetyStream() } };
}

function planEvidence() {
  return buildSafetyCrashEvidence({
    id: EVIDENCE_IDS.ingest, projectId: EVIDENCE_IDS.project, status: "ready", severityCompleteness: "fatal_only",
    sourceLabel: "NHTSA Fatality Analysis Reporting System (FARS)", attribution: null, crashCount: 4, geocodedCount: 4, storedCount: 4, truncated: false,
    yearsRequested: [2023, 2024], createdAt: EVIDENCE_DATE, dimensionCoverage: null, partyCompleteness: "not_supported", partyCount: null, involvementBasis: null,
  }, { severity: { fatal: 4, severe_injury: 0, injury: 0, pdo: 0, unknown: 0 }, role: null });
}

const PROJECT = {
  ...clearedProjectPlace(), id: EVIDENCE_IDS.project, workspace_id: EVIDENCE_IDS.workspace, name: "Example safety project", summary: null,
  status: "active", plan_type: "safety_plan", delivery_phase: "scoping", latitude: null, longitude: null,
  created_at: "2026-10-15T00:00:00.000Z", updated_at: "2026-10-15T01:00:00.000Z",
  place_source: "uploaded", place_label: "Uploaded study boundary", place_geometry_geojson: STUDY_AREA, jurisdiction_context: null,
};

function reportHtml(): string {
  const network = fixtureNetwork();
  const plan = { ingestId: EVIDENCE_IDS.ingest, attachments: [{ segmentId: network.segments[0].id, segmentLabel: network.segments[0].label, countermeasureIds: ["walkways"] }] };
  const draft = buildSafetyActionPlanSection({ plan, evidence: planEvidence(), network });
  const support = buildSafetyPlanSupport({
    reads: { engagement: completeEvidenceRecords().engagement, bca: bcaRead() as never }, projectId: EVIDENCE_IDS.project, projectName: PROJECT.name,
    networkMap: buildSafetyPlanNetworkMap({ network, roads: evidenceRoads(), projectGeometry: STUDY_AREA }), network,
  });
  const data = {
    report: { id: EVIDENCE_IDS.report, title: "Example safety action plan", summary: null, report_type: "project_status", created_at: "2026-11-14T17:33:55.000Z" },
    workspace: { id: EVIDENCE_IDS.workspace, name: "Example workspace" },
    project: PROJECT,
    jurisdictionReadiness: buildProjectJurisdictionReadinessExportPayload(PROJECT as never, "a".repeat(64)),
    runs: [], sections: [], deliverables: [], risks: [], issues: [], decisions: [], meetings: [], engagement: null, scenarioSetLinks: [],
    projectFundingSnapshot: null,
    projectRecordsSnapshot: Object.fromEntries(["deliverables", "risks", "issues", "decisions", "meetings"].map((key) => [key, { count: 0, latestTitle: null, latestAt: null }])),
    stageGateSnapshot: buildProjectStageGateSnapshot(buildProjectStageGateSummary([], { templateId: "us_federal_aid_stage_gates_v0_1" })),
    modelingEvidence: [],
    safetyActionPlan: draft,
    safetyActionPlanSupport: support,
  } as unknown as ReportGenerationData;
  return buildReportHtml(data);
}

function packetHtml(): string {
  const records = completeEvidenceRecords();
  records.bca = bcaRead() as never;
  const snapshot = evidenceSnapshot({ source_id: "fars-national" });
  records.safety = { status: "ready", snapshot, otherSeededArtifactCount: 0 };
  const drafts = buildSs4aSafetyDrafts(snapshot, PROJECT.name);
  const sections: GrantApplicationExportSection[] = drafts.map((draft, index) => {
    const row: ApplicationSectionRow = {
      id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`, workspace_id: EVIDENCE_IDS.workspace,
      opportunity_id: EVIDENCE_IDS.opportunity, section_key: draft.section_key, title: draft.section_key, guidance: null, sort_order: index,
      source: "catalog", suggested_evidence: [], ai_drafting_enabled: true, status: "final", final_markdown: draft.draft_markdown,
      finalized_from_draft_id: null, finalized_by: null, finalized_at: null, updated_by: null,
      created_at: "2026-11-14T00:00:00.000Z", updated_at: "2026-11-14T05:54:00.000Z",
    };
    return { section: row, provenance: { origin: "safety_seed_unedited", safetySeed: draft.provenance, model: null, groundedSentenceCount: null,
      totalSentenceCount: null, finalizedBy: null, finalizedAt: null } };
  });
  return buildGrantApplicationHtml({
    opportunity: { id: EVIDENCE_IDS.opportunity, title: "Safe Streets and Roads for All (SS4A)", agency_name: "U.S. Department of Transportation", summary: null,
      expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
    programTitle: null, sections, attachments: [], generatedAt: "2026-11-14T17:57:00.000Z",
    evidenceAppendices: buildSs4aEvidenceAppendices(records, new Set(SS4A_APPENDIX_KEYS)),
    safetySeedHistory: [drafts[0].provenance],
  });
}

describe("the patterns can fail", () => {
  it("find every code the proof job's PDFs printed, and the allow list hides none of them", () => {
    // Lines as pdftotext read them from the six PDFs (review 43, finding B4).
    const printed = [
      "CALCULATION STATUS review-required",
      "ENGINE annual-ledger-1",
      "segment road:534444c2:53, acquisition 393b9b7d-2f4d-4e43-8eb3-9fda2cb3f0c8, source ccrs-ca",
      "source fars-national",
      "TEMPLATE us_federal_aid_stage_gates_v0_1",
      "NEXT GATE programming-eligibility · Programmed and eligible",
      "Scope: external_handoff.",
      "Payload schema: openplan.project-jurisdiction-readiness-export.v4. Scope: external_handoff.",
    ];
    for (const line of printed) expect(codesIn(`<p>${line}</p>`), line).not.toEqual([]);
    // What replaced them reads clean.
    for (const line of [
      "Calculation status Calculated, with checks open for review",
      "Engine OpenPlan annual ledger, version 1",
      "high-injury network row No. 2, near 39.6802, -120.4980, acquisition 393b9b7d-2f4d-4e43-8eb3-9fda2cb3f0c8, source California Crash Reporting System (CCRS)",
      "Template U.S. federal-aid stage gates",
      "Payload schema: openplan.project-jurisdiction-readiness-export.v4. Scope: external handoff.",
    ]) expect(codesIn(`<p>${line}</p>`), line).toEqual([]);
  });
});

describe("the fixture reaches every block the proof job printed codes in", () => {
  it("renders the benefit-cost safety input, the stage-gate snapshot and the readiness payload", () => {
    const report = readerText(reportHtml());
    const packet = readerText(packetHtml());
    for (const text of [report, packet]) {
      expect(text).toContain("Calculation status");
      expect(text).toContain("Engine");
      expect(text).toContain(": recorded fatalities");
    }
    expect(report).toContain("Governance and stage-gate provenance");
    expect(report).toContain("Payload schema: openplan.project-jurisdiction-readiness-export.v4.");
    expect(HYPHENATED_CODES).toEqual(expect.arrayContaining(["ccrs-ca", "fars-national", "annual-ledger-1", "review-required", "programming-eligibility"]));
  });
});

describe("no stored identifier reaches a reader", () => {
  it("the safety action plan report", () => {
    expect(codesIn(reportHtml())).toEqual([]);
  });

  it("the SS4A packet", () => {
    expect(codesIn(packetHtml())).toEqual([]);
  });

  it("names the segment by its row and the source by its name in the input table", () => {
    const network = fixtureNetwork();
    for (const html of [reportHtml(), packetHtml()]) {
      const text = readerText(html);
      expect(text).toContain(`high-injury network row No. 1, near `);
      expect(text).toContain("source NHTSA Fatality Analysis Reporting System (FARS)");
      expect(text).not.toContain(network.segments[0].id);
      // The acquisition id stays: a reviewer opens that record in Safety.
      expect(text).toContain(`acquisition ${EVIDENCE_IDS.ingest}`);
      expect(text).toMatch(/Calculation status (Calculated|Calculated, with checks open for review|Incomplete) /);
      expect(text).not.toMatch(/Calculation status (calculated|review-required|incomplete) /);
      expect(text).toContain("Engine OpenPlan annual ledger, version 1");
    }
  });
});

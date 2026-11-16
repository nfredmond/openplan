/**
 * BOTH SAFETY EXPORTS PRINT STORED IDENTIFIERS AS WORDS (KI-2026-11-14-304).
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
import { BCA_ENGINE_VERSION } from "@/lib/bca/parameters";
import { calculateBcaDocument, WORKBENCH_ENGINE_VERSION } from "@/lib/bca/workbench/engine";
import type { BcaDocument } from "@/lib/bca/workbench/schema";
import { CRASH_SOURCE_ADAPTERS } from "@/lib/safety/sources/registry";
import { stageGateTemplateRegistry } from "@/lib/stage-gates/template-registry";
import { safetyReportHtml, ss4aPacketHtml } from "./fixtures/grants/safety-exports";
import { EVIDENCE_IDS, fixtureNetwork } from "./fixtures/grants/ss4a-evidence";

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
    const report = readerText(safetyReportHtml());
    const packet = readerText(ss4aPacketHtml());
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
    expect(codesIn(safetyReportHtml())).toEqual([]);
  });

  it("the SS4A packet", () => {
    expect(codesIn(ss4aPacketHtml())).toEqual([]);
  });

  it("names the segment by its row and the source by its name in the input table", () => {
    const network = fixtureNetwork();
    for (const html of [safetyReportHtml(), ss4aPacketHtml()]) {
      const text = readerText(html);
      expect(text).toContain(`high-injury network row No. 1, near `);
      expect(text).toContain("source NHTSA Fatality Analysis Reporting System (FARS)");
      expect(text).not.toContain(network.segments[0].id);
      // The acquisition id stays: a reviewer opens that record in Safety.
      expect(text).toContain(`acquisition ${EVIDENCE_IDS.ingest}`);
      // The report prints a label beside its value; an application appendix prints "Label: value" on
      // one line (KI-2026-11-16-040). Either way the value is the planner's word, not the stored code.
      expect(text).toMatch(/Calculation status:? (Calculated|Calculated, with checks open for review|Incomplete) /);
      expect(text).not.toMatch(/Calculation status:? (calculated|review-required|incomplete) /);
      expect(text).not.toMatch(/review-required|annual-ledger-1/);
      expect(text).toMatch(/Engine:? OpenPlan annual ledger, version 1/);
    }
  });
});

/**
 * EACH COUNTERMEASURE NOTE NAMES CMF CLEARINGHOUSE ENTRIES SOMEONE READ, AND
 * EVERY ENTRY IT NAMES IS IN THE SOURCES FILE (KI-2026-11-14-290).
 *
 * Until November 14, 2026 every note in the countermeasure list said no CMF
 * Clearinghouse entry had been read, and the safety plan report and SS4A
 * Appendix C printed that marker beside each item. The notes now name up to
 * three entries read live on that day, each with its factor and star rating.
 * The list still applies no factor (`cmf` stays null); the planner chooses.
 *
 * These tests hold the notes to the sources file beside the catalog
 * (`cmf-clearinghouse-entries.md`): every id a note names has a row there with
 * the same countermeasure, URL, factor, stars and read date, and every row
 * there is named by a note. They check that a new report and Appendix C print
 * the new notes, that a Safety snapshot frozen before the change keeps the
 * text it froze, and (where Chrome and poppler exist) that both PDFs read the
 * longer notes back inside the page.
 *
 * Blind category: whether the Clearinghouse pages still say what they said on
 * November 14, 2026, and whether a planner would choose these entries for a
 * given site. The sources file is the record of what was read; this test
 * cannot reread the Clearinghouse. Layout at 390 px is not checked here.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import rawFile from "@/lib/safety/countermeasures/fhwa-proven-safety-countermeasures.v1.json";
import { buildGrantApplicationHtml } from "@/lib/grants/application-html";
import { buildSs4aEvidenceAppendices } from "@/lib/grants/ss4a-evidence-appendices";
import { buildReportHtml, safetyActionPlanMarkup, type ReportGenerationData } from "@/lib/reports/html";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import { buildSafetyActionPlanSection } from "@/lib/reports/safety-action-plan";
import { safetyPlanDraftSchema } from "@/lib/reports/safety-plan-snapshot";
import { buildSafetyCrashEvidence } from "@/lib/safety/crash-evidence";
import { getSafetyCountermeasure, parseCountermeasureFile, SAFETY_COUNTERMEASURES } from "@/lib/safety/countermeasures";
import { buildProjectStageGateSnapshot, buildProjectStageGateSummary } from "@/lib/stage-gates/summary";
import { findPdfPhrase } from "../../scripts/lib/pdf-text-match.mjs";
import { completeEvidenceRecords, EVIDENCE_DATE, EVIDENCE_IDS, evidenceSnapshot, fixtureNetwork } from "./fixtures/grants/ss4a-evidence";

const SOURCES_FILE = path.join(process.cwd(), "src/lib/safety/countermeasures/cmf-clearinghouse-entries.md");
const OLD_MARKER = "[VERIFY] No CMF Clearinghouse entry read; no value given.";

type SourceRow = { countermeasure: string; id: number; url: string; says: string; readOn: string };

/** The rows of the sources table, one per Clearinghouse entry cited. */
function sourceRows(): SourceRow[] {
  return readFileSync(SOURCES_FILE, "utf8").split(/\r?\n/)
    .filter((line) => /^\| [a-z0-9-]+ \| \d+ \|/.test(line))
    .map((line) => {
      const cells = line.split(" | ").map((cell) => cell.replace(/^\| |\s*\|$/g, "").trim());
      return { countermeasure: cells[0], id: Number(cells[1]), url: cells[2], says: cells[3], readOn: cells[4] };
    });
}

/** The ids a note names, each written "entry 1234". */
function idsNamed(note: string): number[] {
  return [...note.matchAll(/\bentry (\d+)/g)].map((match) => Number(match[1]));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("the notes and the sources file agree", () => {
  const rows = sourceRows();

  it("reads every one of the 20 items from the Clearinghouse, with no marker left in a note", () => {
    expect(SAFETY_COUNTERMEASURES).toHaveLength(20);
    for (const entry of SAFETY_COUNTERMEASURES) {
      expect(entry.cmf, entry.id).toBeNull();
      expect(entry.cmfEntries?.length ?? 0, entry.id).toBeGreaterThan(0);
      expect(entry.cmfReadOn, entry.id).toBe("2026-11-14");
      expect(entry.cmfNote, entry.id).toMatch(/^CMF Clearinghouse, read November 14, 2026: entry \d+/);
      expect(entry.cmfNote, entry.id).not.toContain("[");
    }
  });

  it("names in each note exactly the entries the item lists, and each one has a row in the sources file", () => {
    expect(SAFETY_COUNTERMEASURES.flatMap((entry) => entry.cmfEntries ?? [])).toHaveLength(rows.length);
    for (const entry of SAFETY_COUNTERMEASURES) {
      const named = idsNamed(entry.cmfNote ?? "");
      expect(named, entry.id).toEqual((entry.cmfEntries ?? []).map((cited) => cited.id));
      for (const cited of entry.cmfEntries ?? []) {
        const row = rows.find((candidate) => candidate.id === cited.id && candidate.countermeasure === entry.id);
        expect(row, `${entry.id} entry ${cited.id} has no row in cmf-clearinghouse-entries.md`).toBeDefined();
        expect(row!.url).toBe(cited.url);
        expect(row!.readOn).toBe(entry.cmfReadOn);
        expect(row!.says).toContain(`CMF ${cited.factor};`);
        expect(row!.says).toContain(cited.stars === null ? "star quality rating cannot be rated (HSM)" : `star quality rating ${cited.stars} stars`);
      }
    }
  });

  it("has no row in the sources file that a note does not name", () => {
    const named = new Set(SAFETY_COUNTERMEASURES.flatMap((entry) => idsNamed(entry.cmfNote ?? "").map((id) => `${entry.id} ${id}`)));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => !named.has(`${row.countermeasure} ${row.id}`))).toEqual([]);
    expect(new Set(rows.map((row) => `${row.countermeasure} ${row.id}`)).size).toBe(rows.length);
  });

  it("keeps each note to two sentences and three entries", () => {
    for (const entry of SAFETY_COUNTERMEASURES) {
      expect(entry.cmfEntries!.length, entry.id).toBeLessThanOrEqual(3);
      // Sentence ends: a period before a space and a capital, or at the end.
      expect((entry.cmfNote!.match(/\.(?= [A-Z])|\.$/g) ?? []).length, entry.id).toBeLessThanOrEqual(2);
    }
  });
});

describe("the catalog refuses a note that does not match its entries", () => {
  it("refuses a note that names an entry the item does not list", () => {
    const broken = clone(rawFile) as { countermeasures: Array<{ cmfNote: string }> };
    broken.countermeasures[0].cmfNote = broken.countermeasures[0].cmfNote.replace("entry 9903", "entry 9904");
    expect(() => parseCountermeasureFile(broken)).toThrow(/name exactly its read Clearinghouse entries/);
  });

  it("refuses a note whose factor or stars differ from the entry", () => {
    const factor = clone(rawFile) as { countermeasures: Array<{ cmfNote: string }> };
    factor.countermeasures[0].cmfNote = factor.countermeasures[0].cmfNote.replace("0.81", "0.71");
    expect(() => parseCountermeasureFile(factor)).toThrow(/factor and stars/);
    const stars = clone(rawFile) as { countermeasures: Array<{ cmfNote: string }> };
    stars.countermeasures[0].cmfNote = stars.countermeasures[0].cmfNote.replace("0.81 for pedestrian crashes, five stars", "0.81 for pedestrian crashes, four stars");
    expect(() => parseCountermeasureFile(stars)).toThrow(/factor and stars/);
  });

  it("refuses a read note that keeps a marker, or entries with no read date", () => {
    const marked = clone(rawFile) as { countermeasures: Array<{ cmfNote: string }> };
    marked.countermeasures[0].cmfNote = `[VERIFY] ${marked.countermeasures[0].cmfNote}`;
    expect(() => parseCountermeasureFile(marked)).toThrow(/with no marker/);
    const undated = clone(rawFile) as { countermeasures: Array<Record<string, unknown>> };
    delete undated.countermeasures[0].cmfReadOn;
    expect(() => parseCountermeasureFile(undated)).toThrow(/date they were read/);
  });

  it("still accepts an item with no entry read when its note carries the marker", () => {
    const unread = clone(rawFile) as { countermeasures: Array<Record<string, unknown>> };
    delete unread.countermeasures[0].cmfEntries;
    delete unread.countermeasures[0].cmfReadOn;
    unread.countermeasures[0].cmfNote = "[VERIFY] The CMF Clearinghouse was searched on November 14, 2026 and no entry was read; no value given.";
    expect(() => parseCountermeasureFile(unread)).not.toThrow();
    unread.countermeasures[0].cmfNote = "No entry was read.";
    expect(() => parseCountermeasureFile(unread)).toThrow(/VERIFY/);
  });
});

// ---------------------------------------------------------------------------
// The exports: a new report prints the new note; a frozen snapshot keeps its own.
// ---------------------------------------------------------------------------

const NETWORK = fixtureNetwork();
const SEGMENT = NETWORK.segments[0];
const IDS = ["enhanced-delineation-horizontal-curves", "longitudinal-rumble-strips-and-stripes", "roadside-design-improvements-curves"];

function planWith(countermeasureIds: string[]) {
  return { ingestId: EVIDENCE_IDS.ingest, attachments: [{ segmentId: SEGMENT.id, segmentLabel: SEGMENT.label, countermeasureIds }] };
}

function evidence() {
  return buildSafetyCrashEvidence({
    id: EVIDENCE_IDS.ingest, projectId: EVIDENCE_IDS.project, status: "ready", severityCompleteness: "fatal_only",
    sourceLabel: "NHTSA Fatality Analysis Reporting System (FARS)", attribution: null, crashCount: 4, geocodedCount: 4, storedCount: 4, truncated: false,
    yearsRequested: [2023, 2024], createdAt: EVIDENCE_DATE, dimensionCoverage: null, partyCompleteness: "not_supported", partyCount: null, involvementBasis: null,
  }, { severity: { fatal: 4, severe_injury: 0, injury: 0, pdo: 0, unknown: 0 }, role: null });
}

function draftFor(countermeasureIds: string[]) {
  return buildSafetyActionPlanSection({ plan: planWith(countermeasureIds), evidence: evidence(), network: NETWORK });
}

function text(html: string) {
  return html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
}

function appendixC(snapshot: ReturnType<typeof evidenceSnapshot>) {
  const records = completeEvidenceRecords();
  records.safety = { status: "ready", snapshot, otherSeededArtifactCount: 0 };
  return buildSs4aEvidenceAppendices(records, new Set(["countermeasures"] as const)).find((appendix) => appendix.key === "countermeasures")!;
}

/** A snapshot as one generated before November 14, 2026 froze it: the old marker in every note. */
function frozenBeforeChange(countermeasureIds: string[]) {
  const snapshot = evidenceSnapshot({}, countermeasureIds);
  const frozen = clone(snapshot);
  for (const treatment of frozen.draft.treatments) {
    for (const item of treatment.countermeasures) item.cmfNote = OLD_MARKER;
  }
  return frozen;
}

describe("a new export prints the read notes, and an old one keeps what it printed", () => {
  it("prints each item's note in a newly generated report section", () => {
    const printed = text(safetyActionPlanMarkup(draftFor(IDS)));
    for (const id of IDS) expect(printed).toContain(getSafetyCountermeasure(id)!.cmfNote);
    expect(printed).not.toContain("No CMF Clearinghouse entry read");
  });

  it("prints each item's note in Appendix C from a snapshot taken now", () => {
    const appendix = appendixC(evidenceSnapshot({}, IDS));
    const all = JSON.stringify(appendix);
    for (const id of IDS) expect(all).toContain(JSON.stringify(getSafetyCountermeasure(id)!.cmfNote).slice(1, -1));
    expect(all).not.toContain("No CMF Clearinghouse entry read");
  });

  it("keeps the old marker in Appendix C from a snapshot frozen before the change", () => {
    const frozen = frozenBeforeChange(IDS);
    expect(safetyPlanDraftSchema.safeParse(frozen.draft).success).toBe(true);
    const all = JSON.stringify(appendixC(frozen));
    expect(all.split(OLD_MARKER).length - 1).toBe(IDS.length);
    expect(all).not.toContain("CMF Clearinghouse, read November 14, 2026");
  });
});

// ---------------------------------------------------------------------------
// Both exports as PDFs, read back with poppler and the shared matcher.
// ---------------------------------------------------------------------------

const CHROME = [process.env.CHROME_EXECUTABLE_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
/** Poppler's folder: another pdftotext (xpdf) can come first on PATH on Windows. */
function popplerDir(): string | null {
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && ["pdftoppm", "pdftotext", "pdfinfo"].every((name) => existsSync(path.join(dir, `${name}${exe}`)))) return dir;
  }
  return null;
}
const POPPLER = popplerDir();
const PDF_TOOLS = Boolean(CHROME) && POPPLER !== null;
function tool(name: "pdftotext" | "pdfinfo"): string {
  return path.join(POPPLER!, `${name}${process.platform === "win32" ? ".exe" : ""}`);
}
const workDir = PDF_TOOLS ? mkdtempSync(path.join(tmpdir(), "openplan-cmf-notes-")) : "";
afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

async function pdf(name: string, html: string) {
  process.env.CHROME_EXECUTABLE_PATH = CHROME;
  const file = path.join(workDir, `${name}.pdf`);
  writeFileSync(file, await renderHtmlToPdf(html, { footerLabel: name }));
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync(tool("pdfinfo"), [file]).toString())![1]);
  const pageText = Array.from({ length: pages }, (_, index) =>
    execFileSync(tool("pdftotext"), ["-f", String(index + 1), "-l", String(index + 1), file, "-"]).toString());
  return { file, pageText };
}

/**
 * Words past the right edge of a section's text column, footer excluded. The
 * report prints on Letter with 72.75 pt from the page edge to the column's
 * right side (48 px margin, 24 px padding, 1 px border, 24 px padding). The
 * application's print layout has no main side padding since
 * KI-2026-11-16-104, so its column ends 54.75 pt from the page edge.
 */
const REPORT_CARD_INSET_PT = 72.75;
const APPLICATION_CARD_INSET_PT = 54.75;
function wordsPastCard(file: string, insetPt: number): string[] {
  const xml = execFileSync(tool("pdftotext"), ["-bbox", file, "-"]).toString();
  const past: string[] = [];
  for (const pageMatch of xml.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)) {
    const [width, height] = [Number(pageMatch[1]), Number(pageMatch[2])];
    for (const word of pageMatch[3].matchAll(/<word xMin="[\d.]+" yMin="[\d.]+" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      if (Number(word[2]) < height - 36 && Number(word[1]) > width - insetPt + 1) past.push(word[3]);
    }
  }
  return past;
}

function reportHtml(countermeasureIds: string[]): string {
  return buildReportHtml({
    report: { id: "r1", title: "Safety action plan report", summary: null, report_type: "project_status", created_at: "2026-11-03T00:00:00.000Z" },
    workspace: { id: "ws-1", name: "Test Workspace" },
    project: { id: EVIDENCE_IDS.project, name: "Example safety project", summary: null, status: "active", plan_type: "corridor_plan",
      delivery_phase: "analysis", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-11-03T00:00:00.000Z" },
    runs: [], sections: [], deliverables: [], risks: [], issues: [], decisions: [], meetings: [], engagement: null, scenarioSetLinks: [],
    projectFundingSnapshot: null,
    projectRecordsSnapshot: {
      deliverables: { count: 0, latestTitle: null, latestAt: null }, risks: { count: 0, latestTitle: null, latestAt: null },
      issues: { count: 0, latestTitle: null, latestAt: null }, decisions: { count: 0, latestTitle: null, latestAt: null },
      meetings: { count: 0, latestTitle: null, latestAt: null },
    },
    stageGateSnapshot: buildProjectStageGateSnapshot(buildProjectStageGateSummary([], { templateId: "ca_stage_gates_v0_1" })),
    modelingEvidence: [],
    safetyActionPlan: draftFor(countermeasureIds),
    safetyActionPlanSupport: null,
  } as unknown as ReportGenerationData);
}

function ss4aHtml(countermeasureIds: string[]): string {
  const records = completeEvidenceRecords();
  records.safety = { status: "ready", snapshot: evidenceSnapshot({}, countermeasureIds), otherSeededArtifactCount: 0 };
  return buildGrantApplicationHtml({
    opportunity: { id: EVIDENCE_IDS.opportunity, title: "SS4A application", agency_name: null, summary: null, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
    programTitle: null, sections: [], attachments: [], generatedAt: "2026-11-01T00:00:00.000Z",
    evidenceAppendices: buildSs4aEvidenceAppendices(records, new Set(["countermeasures"] as const)),
  });
}

/** Phrases from each note short enough that the matcher finds them on one page. */
const PHRASES = [
  "entry 10612, improve curve delineation, 0.82 for fatal and injury",
  "entry 3357, centerline rumble strips, 0.55 for fatal and injury head-on",
  "not star-rated (from the Highway Safety Manual",
  "so neither is a curve factor",
];

describe.runIf(PDF_TOOLS)("both exports as PDFs, read back with pdftotext", () => {
  it("the report PDF prints the read notes inside the card", async () => {
    const doc = await pdf("report-cmf-notes", reportHtml(IDS));
    for (const phrase of PHRASES) expect(findPdfPhrase(doc.pageText, phrase), phrase).not.toEqual([]);
    expect(doc.pageText.join(" ")).not.toContain("No CMF Clearinghouse entry read");
    expect(wordsPastCard(doc.file, REPORT_CARD_INSET_PT)).toEqual([]);
  }, 120_000);

  it("the SS4A PDF prints the read notes in Appendix C inside the card", async () => {
    const doc = await pdf("ss4a-cmf-notes", ss4aHtml(IDS));
    expect(findPdfPhrase(doc.pageText, "Appendix C. Countermeasures")).not.toEqual([]);
    for (const phrase of PHRASES) expect(findPdfPhrase(doc.pageText, phrase), phrase).not.toEqual([]);
    expect(doc.pageText.join(" ")).not.toContain("No CMF Clearinghouse entry read");
    expect(wordsPastCard(doc.file, APPLICATION_CARD_INSET_PT)).toEqual([]);
  }, 120_000);
});

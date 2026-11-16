// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildRunTitle } from "@/app/(app)/explore/_components/_helpers";
import { buildCatalogAttachmentSeeds, buildCatalogSectionSeeds, findGrantProgramCatalogEntry } from "@/lib/grants/application";
import { applicationDraftStamps, countOutstandingRequiredAttachments } from "@/lib/grants/application-draft-stamps";
import { buildGrantApplicationHtml, type GrantApplicationExportData } from "@/lib/grants/application-html";
import { ifApplicableAttachmentKeys, listGrantApplicationTemplates } from "@/lib/grants/application-templates";
import { ATP_APPENDIX_FRAME, atpCoverLines, atpRunTitleLine, buildAtpEvidenceAppendices } from "@/lib/grants/atp-evidence-appendices";
import { absentEvidenceAppendix, type EvidenceAppendix } from "@/lib/grants/evidence-appendices";
import { ATP_APPENDIX_KEYS } from "@/lib/grants/evidence-appendix-keys";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import { pdfTextHasPhrase } from "../../scripts/lib/pdf-text-match.mjs";
import { ATP_IDS, atpProject, atpRun, completeAtpRecords } from "./fixtures/grants/atp-evidence";

/**
 * THE ATP APPLICATION PDF READS AS A DOCUMENT (KI-2026-11-16-104).
 *
 * The third proven job's three hosted PDFs stated honest facts in a layout
 * that got in a reader's way: the cover's last two boxes began page two, a
 * section's card split across two pages, an appendix heading could end a page
 * with its facts on the next, the provenance table wrapped each time over
 * seven lines so ten rows took more than two pages, a run's title was cut
 * mid-word with four dots, and an optional checklist row read "Missing".
 *
 * Where a block lands depends on the machine's fonts, so no check here trusts
 * one print to put a heading at a page foot by chance. The first document
 * forces each case:
 * - its opportunity summary is six times the catalog's, longer than a page
 *   holds, so a cover whose boxes sit under the summary cannot keep them on
 *   page one on any font;
 * - each test appendix follows a blank figure of a set height that starts a
 *   new page, so the appendix begins a set distance above the page foot. The
 *   distances step by 20 px across the height where a heading with its first
 *   line of content stops fitting. A fact line is 31 px tall, so on any font
 *   at least one step falls where the heading and its source line fit and
 *   the first fact does not. Each check confirms the steps straddled that
 *   height: some headings stayed on the figure's page and some moved on;
 * - the provenance appendix begins 160 px above a page foot, room for its
 *   heading and opening paragraph and not for its table.
 * The blank figure is a test device. The product draws no such figure.
 *
 * The second document is the application the product builds from the 2027
 * template and the real appendix builders, with a run title the product cut.
 *
 * Blind category: the hosted site's Chrome and its font; a heading no fixture
 * here puts at a page foot (the "Attachment checklist" and "Evidence
 * appendices" headings are read where one print happens to put them); how the
 * page looks, which the lane's page images are for. Skipped where Chrome or
 * Poppler is missing: a skipped run proves nothing.
 */

const CHROME = [process.env.CHROME_EXECUTABLE_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));

function popplerDir(): string | null {
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && ["pdftoppm", "pdftotext"].every((name) => existsSync(path.join(dir, `${name}${exe}`)))) return dir;
  }
  return null;
}
const POPPLER = popplerDir();
const PDF_TOOLS = Boolean(CHROME) && POPPLER !== null;
const workDir = PDF_TOOLS ? mkdtempSync(path.join(tmpdir(), "openplan-atp-layout-")) : "";
// Set OPENPLAN_KEEP_ATP_PDFS=1 to keep the printed PDFs and look at them; the folder is then named in the output.
afterAll(() => {
  if (!workDir) return;
  if (process.env.OPENPLAN_KEEP_ATP_PDFS) console.info(`ATP layout PDFs kept in ${workDir}`);
  else rmSync(workDir, { recursive: true, force: true });
});

const ATP = findGrantProgramCatalogEntry("atp")!;
const TEMPLATE = listGrantApplicationTemplates().find((entry) => entry.templateKey === "atp-2027")!;
const FOOTER_LABEL = "Active Transportation Program (ATP)";
const FOOTER = /· Page \d+ of \d+\s*$/;
const ROW = { workspace_id: ATP_IDS.workspace, opportunity_id: ATP_IDS.opportunity, updated_by: null, created_at: "", updated_at: "" };
const COVER_LABELS = ["PROJECT", "WORKSPACE", "FUNDER / AGENCY", "EXPECTED AWARD", "CLOSES", "SECTIONS FINAL", "ASSEMBLED"];
const PLACE_LINE = "Study place: Trinity County, CA (county, GEOID 06105)";
const APPLICANT_LINE = "Applicant not entered in OpenPlan";

/** The question the third job's journey asks, and the title the product stores for it. */
const RUN_QUESTION = "Demonstration by an automated OpenPlan proof run: what crash history involves people walking and bicycling in this study area?";
const STORED_RUN_TITLE = buildRunTitle(RUN_QUESTION);

/** The 2027 template's ten sections, final, each a few short paragraphs that end in a word found nowhere else. */
function sections(paragraphs: number): GrantApplicationExportData["sections"] {
  return buildCatalogSectionSeeds(ATP).map((seed, index) => ({
    section: {
      ...ROW, id: `section-${index}`, section_key: seed.section_key, title: seed.title, guidance: seed.guidance, sort_order: seed.sort_order,
      source: seed.source, suggested_evidence: seed.suggested_evidence, ai_drafting_enabled: seed.ai_drafting_enabled, status: "final" as const,
      final_markdown: [
        ...Array.from({ length: paragraphs }, () => "Demonstration text, typed by an agent for a layout check. It describes no real project and makes no claim about any agency, place or community."),
        `Closing line EndOfSection${index}`,
      ].join("\n\n"),
      finalized_from_draft_id: null, finalized_by: null, finalized_at: null,
    },
    // Each row's minute is its own, so a row is found by its time.
    provenance: { origin: "operator_authored" as const, model: null, groundedSentenceCount: null, totalSentenceCount: null, finalizedBy: "Workspace owner", finalizedAt: `2026-11-16T10:${String(index + 1).padStart(2, "0")}:00.000Z` },
  }));
}

/** The 2027 template's 26 checklist rows, nothing attached. */
function attachments(): GrantApplicationExportData["attachments"] {
  return buildCatalogAttachmentSeeds(ATP).map((seed, index) => ({
    ...ROW, id: `attachment-${index}`, attachment_key: seed.attachment_key, title: seed.title, guidance: seed.guidance, required: seed.required,
    status: "missing" as const, kb_document_id: null, report_artifact_id: null, note: null, sort_order: seed.sort_order,
  }));
}

function application(overrides: Partial<GrantApplicationExportData>): string {
  const records = { ...completeAtpRecords(), project: { status: "ready" as const, project: atpProject({ place_source: "tigerweb", place_kind: "county", place_ref: "06105", place_label: "Trinity County, CA" }) } };
  return buildGrantApplicationHtml({
    opportunity: {
      id: ATP_IDS.opportunity, title: FOOTER_LABEL, agency_name: ATP.administeringAgency, summary: ATP.summary,
      expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null,
    },
    programTitle: null,
    sections: sections(1),
    attachments: attachments(),
    generatedAt: "2026-11-16T04:00:00.000Z",
    evidenceAppendices: buildAtpEvidenceAppendices({ ...records, run: { status: "ready", run: atpRun({ title: STORED_RUN_TITLE }) } }, new Set<string>(ATP_APPENDIX_KEYS)),
    evidenceAppendixFrame: ATP_APPENDIX_FRAME,
    coverLines: atpCoverLines(records.project),
    applicant: { project: { status: "named", name: "Trinity County ATP demonstration" }, workspace: { status: "named", name: "OpenPlan proof run, Trinity County" } },
    ifApplicableAttachmentKeys: ifApplicableAttachmentKeys(TEMPLATE),
    attachmentDocumentTitles: new Map(),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// The forcing device: a blank figure of a set height that starts a new page.
// ---------------------------------------------------------------------------

/** A Letter page less the export's 48 px margins, in CSS pixels. */
const PAGE_HEIGHT = 960;
/** From the figure's foot to the next appendix heading: the appendix's top margin, rule and padding. */
const TO_NEXT_APPENDIX_HEADING = 37;
/** From the figure's foot to the provenance heading: the figure's margin, and two cards' padding, rules and the gap between them. */
const TO_PROVENANCE_HEADING = 86;

const included = (key: string, letter: string, title: string): EvidenceAppendix =>
  ({ key, letter, title, status: "included", statusNote: null, source: null, facts: [], table: null, figureSvg: null, notes: [] });

/** An appendix that is only a figure, which starts a new page and leaves `room` px under it for what follows. */
function spacer(id: string, room: number, toHeading: number): EvidenceAppendix {
  const height = PAGE_HEIGHT - toHeading - room;
  return {
    ...included(`spacer-${id}`, `S${id}`, `Spacer${id}`),
    figureSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="${height}" style="display:block;break-before:page"><rect width="24" height="${height}" fill="#d7dde0"/></svg>`,
  };
}

/** `first` is the first line of content under the heading; `firstIsLine` when it must be read as a whole line. */
type Target = { id: string; heading: string; first: string; firstIsLine: boolean; spacerHeading: string };
const KINDS = {
  /** A source line, then facts: the heading must stay with the first fact. */
  facts: { rooms: [60, 80, 100, 120, 140, 160, 180, 200, 220], build: (id: string) => ({
    ...included(`target-${id}`, `T${id}`, `Heading${id}`),
    source: { record: "Stress record", id: `stress-${id}`, date: "2026-11-02", dateLabel: "Saved", hash: null, hashLabel: "No content hash is stored for this record", link: null, details: [] },
    facts: [{ label: "First fact", value: `First${id}` }, { label: "Second fact", value: "second" }, { label: "Third fact", value: "third" }],
  }) },
  /** No record: the heading must stay with the box that says so. */
  missing: { rooms: [30, 50, 70, 90, 110, 130, 150], build: (id: string) =>
    absentEvidenceAppendix({ key: `target-${id}`, letter: `T${id}`, title: `Heading${id}` }, "missing", `First${id} no record is saved.`) },
  /** A table and no source line: the heading must stay with the table's first row. */
  table: { rooms: [40, 60, 80, 100, 120, 140, 160], build: (id: string) => ({
    ...included(`target-${id}`, `T${id}`, `Heading${id}`),
    table: { headers: ["Input", "Status"], rows: [[`First${id}`, "Documented"], ["Second input", "Assumption"], ["Third input", "Assumption"]] },
  }) },
} satisfies Record<string, { rooms: number[]; build: (id: string) => EvidenceAppendix }>;

const targets: Record<keyof typeof KINDS, Target[]> = { facts: [], missing: [], table: [] };
const stressAppendices: EvidenceAppendix[] = [];
for (const kind of Object.keys(KINDS) as Array<keyof typeof KINDS>) {
  for (const room of KINDS[kind].rooms) {
    const id = `${kind[0].toUpperCase()}${room}`;
    stressAppendices.push(spacer(id, room, TO_NEXT_APPENDIX_HEADING), KINDS[kind].build(id));
    // The index of appendices prints a missing appendix's reason too, in a column; the box under the heading is a line of its own.
    const first = kind === "missing" ? `Missing. First${id} no record is saved.` : `First${id}`;
    targets[kind].push({ id, heading: `Appendix T${id}. Heading${id}`, first, firstIsLine: kind === "missing", spacerHeading: `Appendix S${id}. Spacer${id}` });
  }
}
stressAppendices.push(spacer("Last", 160, TO_PROVENANCE_HEADING));

// ---------------------------------------------------------------------------
// Reading a printed PDF
// ---------------------------------------------------------------------------

type Printed = { pages: string[]; lines: string[][] };

/** Print with Chrome, then read each page's text as the proven jobs' checker does (`pdftotext -layout`). */
async function print(name: string, html: string): Promise<Printed> {
  process.env.CHROME_EXECUTABLE_PATH = CHROME;
  const file = path.join(workDir, `${name}.pdf`);
  writeFileSync(file, await renderHtmlToPdf(html, { footerLabel: FOOTER_LABEL }));
  const pdftotext = path.join(POPPLER!, `pdftotext${process.platform === "win32" ? ".exe" : ""}`);
  const pages = execFileSync(pdftotext, ["-layout", "-enc", "UTF-8", file, "-"]).toString("utf8").split("\f").filter((page) => page.trim() !== "");
  // A page's lines as a reader meets them: no footer, no blank lines.
  return { pages, lines: pages.map((page) => page.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "" && !FOOTER.test(line))) };
}

const squash = (text: string) => text.replace(/\s+/g, " ");
/** The one page (counted from 1) that holds a line equal to this text. */
function pageOfLine(printed: Printed, line: string): number {
  const found = printed.lines.flatMap((lines, index) => (lines.includes(line) ? [index + 1] : []));
  expect(found, `"${line}" is a line of its own on exactly one page`).toHaveLength(1);
  return found[0];
}
/** The one page that holds this word, which the fixture prints once. */
function pageOfWord(printed: Printed, word: string): number {
  const found = printed.pages.flatMap((page, index) => (new RegExp(`(^|\\s)${word}(\\s|$)`).test(page) ? [index + 1] : []));
  expect(found, `"${word}" is on exactly one page`).toHaveLength(1);
  return found[0];
}
const lastLine = (printed: Printed, page: number) => printed.lines[page - 1][printed.lines[page - 1].length - 1];

describe.runIf(PDF_TOOLS)("the ATP application PDF, printed with every hard case forced", () => {
  let printed: Printed;
  const tenSections = sections(4);
  beforeAll(async () => {
    printed = await print("atp-layout-forced", application({
      opportunity: {
        id: ATP_IDS.opportunity, title: FOOTER_LABEL, agency_name: ATP.administeringAgency,
        // Six times the catalog's summary: more than one page holds, on any font.
        summary: Array(6).fill(ATP.summary).join(" "),
        expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null,
      },
      sections: tenSections,
      evidenceAppendices: stressAppendices,
    }));
  }, 170_000);

  it("keeps every cover box on page one, under the stamp and the place and applicant lines, whatever the summary's length", () => {
    const first = squash(printed.pages[0]);
    for (const label of COVER_LABELS) {
      expect(first, `the cover box ${label} is on page one`).toContain(label);
      for (const later of printed.pages.slice(1)) expect(squash(later), `the cover box ${label} is on page one only`).not.toContain(label);
    }
    // The boxes' values with them.
    expect(first).toContain("10 of 10");
    expect(first).toContain("Trinity County ATP demonstration");
    // As before: the place line, the applicant line and the stamp, in that order, above the boxes.
    const order = [PLACE_LINE, APPLICANT_LINE, "DRAFT: 25 required attachment(s) outstanding", "PROJECT"].map((text) => first.indexOf(text));
    expect(order.every((position) => position > 0), "the place line, the applicant line, the stamp and the first box are on page one").toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The summary is long enough that it could not have shared page one with the boxes above it.
    expect(printed.pages.length).toBeGreaterThan(2);
    expect(squash(printed.pages[1])).toContain("Competitive California program");
  });

  it("keeps a section's card whole on one page when it is shorter than a page", () => {
    const pagesOfCards = tenSections.map(({ section }, index) => {
      const titlePages = printed.pages.flatMap((page, pageIndex) => {
        // The provenance table prints the title again, in a narrow column; a card's title is a heading of its own.
        const provenance = printed.lines[pageIndex].includes("Provenance appendix");
        return !provenance && pdfTextHasPhrase(page, section.title) ? [pageIndex + 1] : [];
      });
      expect(titlePages, `"${section.title}" is whole on one page`).toHaveLength(1);
      expect(pageOfWord(printed, `EndOfSection${index}`), `the card "${section.title}" ends on the page it starts on`).toBe(titlePages[0]);
      return titlePages[0];
    });
    // The ten cards run over more than one page, so a page break did fall among them.
    expect(new Set(pagesOfCards).size).toBeGreaterThan(1);
  });

  it.each(Object.keys(KINDS) as Array<keyof typeof KINDS>)("never leaves an appendix heading at the foot of a page without its first line of content (%s)", (kind) => {
    const moved: boolean[] = [];
    for (const target of targets[kind]) {
      const page = pageOfLine(printed, target.heading);
      expect(lastLine(printed, page), `${target.heading} is not the last line of page ${page}`).not.toBe(target.heading);
      const firstPage = target.firstIsLine ? pageOfLine(printed, target.first) : pageOfWord(printed, target.first);
      expect(firstPage, `${target.heading} and its first line of content are on one page`).toBe(page);
      // The blank figure starts the page after its own heading's. The heading under test is on that page, or moved to the next.
      const afterFigure = page - pageOfLine(printed, target.spacerHeading);
      expect([1, 2], `${target.heading} follows its blank figure`).toContain(afterFigure);
      moved.push(afterFigure === 2);
    }
    // The steps straddled the height where the heading stops fitting: the smallest room moved it, the largest kept it.
    expect(moved[0], "with the least room the heading moved to the next page").toBe(true);
    expect(moved[moved.length - 1], "with the most room the heading stayed under the figure").toBe(false);
    // And it moved once: every heading with less room than the first that stayed has moved.
    expect(moved.join(",")).toBe([...moved].sort((a, b) => Number(b) - Number(a)).join(","));
  });

  it("keeps the provenance appendix's heading, its ten rows and its time zone note on one page", () => {
    const page = pageOfLine(printed, "Provenance appendix");
    // The fixture left room for the heading and its paragraph only, so the appendix moved to the next page.
    expect(page - pageOfLine(printed, "Appendix SLast. SpacerLast"), "the provenance appendix moved past the blank figure's page").toBe(2);
    expect(lastLine(printed, page)).not.toBe("Provenance appendix");
    const text = squash(printed.pages[page - 1]);
    for (let row = 1; row <= 10; row += 1) {
      // The day and the time each print whole, in the short form, with the zone.
      expect(text, `row ${row} of the provenance table is on the heading's page`).toContain(`10:${String(row).padStart(2, "0")} UTC`);
    }
    expect(text.match(/Nov 16, 2026,/g)).toHaveLength(10);
    expect(text.match(/no workspace time zone is set/g), "the note prints once, under the table").toHaveLength(1);
    expect(text).not.toContain("November 16, 2026 at");
    // The cover still says it of its own times, and no row repeats it.
    expect(squash(printed.pages.join(" ")).match(/no workspace time zone/g)).toHaveLength(2);
  });

  it("does not leave the checklist's heading or the appendices' heading as a page's last line", () => {
    for (const heading of ["Attachment checklist", "Evidence appendices"]) {
      const page = pageOfLine(printed, heading);
      expect(lastLine(printed, page), heading).not.toBe(heading);
    }
    // The checklist's heading has its first row with it.
    expect(squash(printed.pages[pageOfLine(printed, "Attachment checklist") - 1])).toContain("Letter of Intent");
  });
});

describe.runIf(PDF_TOOLS)("the ATP application PDF the product builds from the 2027 template", () => {
  let printed: Printed;
  beforeAll(async () => {
    printed = await print("atp-layout-real", application({}));
  }, 170_000);

  it("keeps every cover box on page one under the catalog's own summary", () => {
    const first = squash(printed.pages[0]);
    for (const label of COVER_LABELS) expect(first, label).toContain(label);
    expect(first).toContain(PLACE_LINE);
    expect(first).toContain("DRAFT: 25 required attachment(s) outstanding");
  });

  it("prints the run's title cut at a word, with three dots, under Appendices A and E", () => {
    const everything = printed.pages.join("\n");
    // The product stored the question cut mid-word.
    expect(STORED_RUN_TITLE).toBe("Demonstration by an automated OpenPlan proof run: what cr...");
    const line = "Run title: Demonstration by an automated OpenPlan proof run: what...";
    for (const heading of ["Appendix A. ATP screening packet", "Appendix E. Disadvantaged-community and equity inputs"]) {
      const page = printed.pages[pageOfLine(printed, heading) - 1];
      expect(pdfTextHasPhrase(page, line), `${heading} prints "${line}"`).toBe(true);
    }
    expect(squash(everything)).not.toContain("what cr");
    expect(everything).not.toMatch(/\.{4}/);
  });

  it("reads Not attached on the optional row and Missing on a required one, with the stamp's count unchanged", () => {
    // The status column is narrow, so "Not attached" may wrap; the row's first line holds its first word either way.
    const optionalRows = printed.lines.flat().filter((line) => /(^|\s)Optional(\s|$)/.test(line));
    expect(optionalRows, "the one optional row").toHaveLength(1);
    expect(optionalRows[0]).toMatch(/Optional\s+Not(\s|$)/);
    expect(optionalRows[0]).not.toContain("Missing");
    const everything = squash(printed.pages.join(" "));
    expect(everything).toMatch(/Required Missing/);
    expect(everything).toContain("DRAFT: 25 required attachment(s) outstanding");
  });
});

describe("the application document's words, with no browser", () => {
  const optional = attachments().filter((row) => !row.required);
  const required = attachments().filter((row) => row.required);

  it("has a fixture with one optional row and 25 required rows, none attached", () => {
    expect(optional.map((row) => row.title)).toEqual(["Additional attachments"]);
    expect(required).toHaveLength(25);
  });

  it("prints Not attached for the optional row with nothing attached, and leaves it out of the DRAFT count", () => {
    const html = application({});
    expect(html).toContain("<td>Additional attachments</td>\n          <td>Optional</td>\n          <td>Not attached</td>");
    expect(html).toContain("<td>Project Programming Request (PPR)</td>\n          <td>Required</td>\n          <td>Missing</td>");
    // The stamp counts required rows only: 25 with the optional row, 25 without it.
    expect(countOutstandingRequiredAttachments(attachments())).toBe(25);
    expect(applicationDraftStamps([], attachments())).toEqual(applicationDraftStamps([], required));
    expect(html).toContain("DRAFT: 25 required attachment(s) outstanding");
    // Every other state keeps its word, required or not.
    const states = (["in_progress", "attached", "not_applicable"] as const).map((status) => ({ ...optional[0], status }));
    const others = application({ attachments: [...required, ...states] });
    for (const word of ["In progress", "Attached", "Not applicable"]) expect(others).toContain(`<td>Optional</td>\n          <td>${word}</td>`);
    expect(others).not.toContain("Not attached");
  });

  it("cuts a stored run title back to a whole word and never adds a fourth dot", () => {
    expect(atpRunTitleLine(STORED_RUN_TITLE)).toBe("Run title: Demonstration by an automated OpenPlan proof run: what...");
    // A short title prints whole, as before.
    expect(atpRunTitleLine("Main Street ATP screen")).toBe("Run title: Main Street ATP screen.");
    // A question shorter than the cut keeps its own mark and gets no period after it.
    expect(atpRunTitleLine("What crash history involves people walking?")).toBe("Run title: What crash history involves people walking?");
    // The cut fell after a space: the last word is whole and stays.
    const afterSpace = buildRunTitle(`${"a".repeat(49)} second ${"b".repeat(20)}`);
    expect(afterSpace).toBe(`${"a".repeat(49)} second ...`);
    expect(atpRunTitleLine(afterSpace)).toBe(`Run title: ${"a".repeat(49)} second...`);
    // The cut fell on a word's last letter. Nothing in the stored title says so, so that word goes too:
    // a shorter title of whole words, never half a word.
    const onLastLetter = buildRunTitle(`${"a".repeat(50)} second ${"b".repeat(20)}`);
    expect(onLastLetter).toBe(`${"a".repeat(50)} second...`);
    expect(atpRunTitleLine(onLastLetter)).toBe(`Run title: ${"a".repeat(50)}...`);
    // One long word cannot be cut at a word; it keeps what was stored.
    expect(atpRunTitleLine(buildRunTitle("x".repeat(80)))).toBe(`Run title: ${"x".repeat(57)}...`);
    // A planner's own three dots, on a title the product did not cut, stay as typed.
    expect(atpRunTitleLine("Walking and bicycling...")).toBe("Run title: Walking and bicycling...");
    for (const title of [STORED_RUN_TITLE, "Main Street ATP screen", "Walking and bicycling..."]) expect(atpRunTitleLine(title)).not.toMatch(/\.{4}/);
  });

  it("prints each finalized time once, in the short form with its zone, and says once that no zone is set", () => {
    const html = application({});
    expect(html.match(/<span class="nowrap">Nov 16, 2026,<\/span> <span class="nowrap">10:\d\d UTC<\/span>/g)).toHaveLength(10);
    expect(html.match(/Finalized times are in UTC: no workspace time zone is set\./g)).toHaveLength(1);
    // The long form stays on the cover, where it prints once.
    expect(html.match(/\(UTC, no workspace time zone set\)/g)).toHaveLength(1);
  });

  it("prints a workspace's own zone in each cell, with no note, and the day on that zone's calendar", () => {
    const html = application({ calendar: { timeZone: "America/Los_Angeles", source: "workspace_setting" } });
    // 10:01 UTC on November 16 is 02:01 that day in Los Angeles.
    expect(html).toContain('<span class="nowrap">Nov 16, 2026,</span> <span class="nowrap">02:01</span> (America/<wbr>Los_Angeles)');
    expect(html).not.toContain("no workspace time zone");
    const utc = application({ calendar: { timeZone: "UTC", source: "workspace_setting" } });
    expect(utc).toContain('<span class="nowrap">10:01 UTC</span>');
    expect(utc).not.toContain("no workspace time zone");
  });

  it("says nothing about a time zone under a table that prints no time", () => {
    const none = sections(1).map((entry) => ({ ...entry, provenance: { ...entry.provenance, finalizedAt: null } }));
    const html = application({ sections: none });
    expect(html).not.toContain("Finalized times are in UTC");
    expect(html.match(/<td>Not recorded<\/td>/g)).toHaveLength(10);
  });
});

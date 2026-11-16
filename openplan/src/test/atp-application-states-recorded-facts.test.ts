import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildGrantApplicationHtml } from "@/lib/grants/application-html";
import {
  ATP_APPENDIX_FRAME,
  ATP_CENSUS_TRIBAL_AREA_NOTE,
  ATP_GUIDELINES_DAC_CRITERIA,
  atpCoverLines,
  buildAtpEvidenceAppendices,
  type AtpAppendix,
  type AtpEvidenceRecords,
} from "@/lib/grants/atp-evidence-appendices";
import { atpStudyPlaceLine } from "@/lib/grants/atp-packet";
import { ATP_APPENDIX_KEYS } from "@/lib/grants/evidence-appendix-keys";
import { GRANT_PROGRAM_CATALOG } from "@/lib/grants/program-catalog";
import { ATP_VERIFY_GUIDELINES } from "@/lib/planner-pack/render";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import { htmlToPdfBlocks } from "@/lib/reports/pdf-text";
// The shared matcher the proven jobs' checker reads PDF text with.
import { pdfTextHasPhrase } from "../../scripts/lib/pdf-text-match.mjs";
import { ATP_IDS, atpCrashEvidence, atpProject, atpRun, atpRunMetrics, completeAtpRecords } from "./fixtures/grants/atp-evidence";
import { seedId } from "./fixtures/grants/safety-seed";

/**
 * THE ATP APPLICATION PDF STATES THE FACTS OPENPLAN HOLDS, EACH ON ONE LINE A
 * TEXT SEARCH FINDS WHOLE (KI-2026-11-16-031, -032, -034, -035, -038, -040).
 *
 * The third proven job's checker will read an ATP application PDF's text with
 * Poppler. A hand run-through and a fresh-context review found that the PDF
 * printed "Lead agency to be provided" and "Location to be provided by lead
 * agency" for a project whose study place was recorded, named the place
 * nowhere outside text the planner typed, listed criteria the ATP does not
 * use, and set its facts in a two-column grid that extracted text read side
 * by side.
 *
 * These tests build the real application HTML from the real appendix
 * builders and read it three ways: the HTML, the text the built-in PDF writer
 * extracts, and, where Chrome and Poppler are installed, the PDF Chrome
 * prints, read back with `pdftotext -layout` and the shared matcher.
 *
 * The place fixtures are test values that follow the Census Bureau's GEOID
 * forms for a county and for a tribal area; no claim is made about any place.
 *
 * Blind category: a real database and the export route's reads (the route
 * tests cover those with fakes), the hosted site's Chrome and its one font, a
 * fact a future appendix adds without a fixture here, and tables that really
 * are tables (the appendix index, the benefit-cost input sources, the
 * attachment checklist), whose cells still read side by side. The applicant
 * line cannot vary: nothing in OpenPlan holds an applicant's name yet. The
 * PDF block is skipped where Chrome or Poppler is missing, so CI checks the
 * HTML and the built-in writer's text only.
 */

const ALL = new Set<string>(ATP_APPENDIX_KEYS);

const COUNTY = { place_source: "tigerweb", place_kind: "county", place_ref: "06105", place_label: "Trinity County, CA" };
const TRIBAL_AREA = { place_source: "tigerweb", place_kind: "aiannh", place_ref: "1490R", place_label: "Hoopa Valley Reservation, CA" };
const COUNTY_LINE = "Study place: Trinity County, CA (county, GEOID 06105)";
const TRIBAL_AREA_LINE = "Study place: Hoopa Valley Reservation, CA (Census tribal area, GEOID 1490R)";
const APPLICANT_LINE = "Applicant not entered in OpenPlan";
const NO_PLACE_LINE = "Study place not recorded in OpenPlan";
const ATTACHED_DOCUMENT = seedId(830);
const TRACKED_SUMMARY = GRANT_PROGRAM_CATALOG.find((entry) => entry.key === "atp")!.summary;

function recordsFor(place: Record<string, string | null>, overrides: Partial<AtpEvidenceRecords> = {}): AtpEvidenceRecords {
  return { ...completeAtpRecords(), project: { status: "ready", project: atpProject(place) }, ...overrides };
}

function byKey(appendices: AtpAppendix[], key: AtpAppendix["key"]): AtpAppendix {
  return appendices.find((appendix) => appendix.key === key)!;
}

/** The real application document for one set of records, prepared in a workspace of the given name. */
function applicationHtml(records: AtpEvidenceRecords, workspaceName: string, options: { documentTitles?: ReadonlyMap<string, string>; programTitle?: string | null } = {}): string {
  const row = { workspace_id: ATP_IDS.workspace, opportunity_id: ATP_IDS.opportunity, updated_by: null, created_at: "", updated_at: "" };
  return buildGrantApplicationHtml({
    opportunity: {
      id: ATP_IDS.opportunity, title: "Active Transportation Program (ATP)", agency_name: "California Transportation Commission / Caltrans",
      // Tracking from the catalog card copies the program's summary, which is long. With the
      // short default text the cover had room to spare and the lines could not leave page one.
      summary: TRACKED_SUMMARY, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null,
    },
    programTitle: options.programTitle ?? null,
    sections: [{
      section: {
        ...row, id: "section-0", section_key: "project-narrative", title: "Project description and scope", guidance: null, sort_order: 0,
        source: "catalog", suggested_evidence: [], ai_drafting_enabled: true, status: "final",
        final_markdown: "Demonstration text, typed by an agent for a layout check.", finalized_from_draft_id: null, finalized_by: null, finalized_at: null,
      },
      provenance: { origin: "operator_authored", model: null, groundedSentenceCount: null, totalSentenceCount: null, finalizedBy: "Workspace owner", finalizedAt: "2026-11-16T04:00:00.000Z" },
    }],
    attachments: [
      { ...row, id: "attachment-0", attachment_key: "location-vicinity-map", title: "Project location and vicinity map", guidance: null, required: true, status: "attached", kb_document_id: ATTACHED_DOCUMENT, report_artifact_id: null, note: null, sort_order: 0 },
      { ...row, id: "attachment-1", attachment_key: "engineers-cost-estimate", title: "Engineer's cost estimate", guidance: null, required: true, status: "missing", kb_document_id: null, report_artifact_id: null, note: null, sort_order: 1 },
    ],
    generatedAt: "2026-11-16T04:00:00.000Z",
    evidenceAppendices: buildAtpEvidenceAppendices(records, ALL),
    evidenceAppendixFrame: ATP_APPENDIX_FRAME,
    coverLines: atpCoverLines(records.project),
    applicant: { project: { status: "named", name: "Main Street sidewalk gap closure" }, workspace: { status: "named", name: workspaceName } },
    attachmentDocumentTitles: options.documentTitles ?? new Map([[ATTACHED_DOCUMENT, "Main Street vicinity map (demonstration)"]]),
  });
}

/** The document as the built-in PDF writer reads it: one string per block of text. */
function textBlocks(html: string): string[] {
  return htmlToPdfBlocks(html).flatMap((block) => ("text" in block ? [block.text] : "cells" in block ? [block.cells.join(" | ")] : []));
}

/** The cover: everything before the first section. */
function coverOf(html: string): string {
  return html.slice(html.indexOf('<header class="hero">'), html.indexOf("</header>"));
}

/** Each fact of an included appendix as the one line it prints. */
function factLines(appendices: AtpAppendix[]): string[] {
  return appendices.filter((appendix) => appendix.status === "included").flatMap((appendix) =>
    appendix.facts.map((fact) => (fact.label ? `${fact.label}: ${fact.value}` : fact.value)));
}

describe("the study place line of an ATP application", () => {
  it("names the place the project row records, a different line for a different place, on the cover and in Appendix A", () => {
    const county = applicationHtml(recordsFor(COUNTY), "Demonstration Planning Consultants");
    const tribal = applicationHtml(recordsFor(TRIBAL_AREA), "Demonstration Planning Consultants");

    // Two places give two lines: a constant cannot pass both.
    for (const [html, line, other] of [[county, COUNTY_LINE, TRIBAL_AREA_LINE], [tribal, TRIBAL_AREA_LINE, COUNTY_LINE]] as const) {
      expect(coverOf(html)).toContain(`<p>${line}</p>`);
      expect(html).toContain(`<div><dd>${line}</dd></div>`);
      const blocks = textBlocks(html);
      // Once on the cover and once in Appendix A, each a block of its own.
      expect(blocks.filter((text) => text === line)).toHaveLength(2);
      expect(html).not.toContain(other);
    }
    expect(atpStudyPlaceLine(atpProject(COUNTY))).toBe(COUNTY_LINE);
    expect(atpStudyPlaceLine(atpProject(TRIBAL_AREA))).toBe(TRIBAL_AREA_LINE);
  });

  it("prints on the cover whichever appendices are selected, in text the planner did not type", () => {
    const records = recordsFor(COUNTY);
    const html = buildGrantApplicationHtml({
      opportunity: { id: ATP_IDS.opportunity, title: "ATP application", agency_name: null, summary: null, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
      programTitle: null, sections: [], attachments: [], generatedAt: "2026-11-16T04:00:00.000Z",
      // Every appendix turned off, the screening packet included.
      evidenceAppendices: buildAtpEvidenceAppendices(records, new Set()), evidenceAppendixFrame: ATP_APPENDIX_FRAME,
      coverLines: atpCoverLines(records.project),
    });
    expect(textBlocks(html).filter((text) => text === COUNTY_LINE)).toHaveLength(1);
    expect(coverOf(html)).toContain(`<p>${COUNTY_LINE}</p>`);
  });

  it("says a study place is not recorded when none is, and that a failed read is a failed read", () => {
    const none = recordsFor({});
    expect(atpCoverLines(none.project)[0]).toBe(NO_PLACE_LINE);
    expect(byKey(buildAtpEvidenceAppendices(none, ALL), "scoring_packet").facts.map((fact) => fact.value)).toContain(NO_PLACE_LINE);
    expect(atpCoverLines({ status: "no_project" })[0]).toBe(NO_PLACE_LINE);
    // Not "not recorded": the record was not read.
    expect(atpCoverLines({ status: "unreadable", reason: "The linked project could not be read." })[0]).toBe(
      "Study place could not be read while this package was assembled"
    );
  });

  it("calls the area the study place and never the project's limits or location", () => {
    const html = applicationHtml(recordsFor(COUNTY), "Demonstration Planning Consultants");
    const blocks = textBlocks(html);
    const note = "The study place is the area recorded for the linked project in OpenPlan. It does not state the project limits.";
    // Said on the cover and under the screening packet.
    expect(blocks.filter((text) => text === note)).toHaveLength(2);
    expect(html).not.toMatch(/<dt>Location:?<\/dt>/);
    expect(html).not.toMatch(/<dt>Project limits:?<\/dt>/);
  });

  it("describes a drawn or uploaded area as what it is, with no place identity", () => {
    expect(atpStudyPlaceLine(atpProject({ place_source: "drawn", place_label: "Downtown core" }))).toBe(
      'Study place: an area drawn on the map, labeled "Downtown core"'
    );
    expect(atpStudyPlaceLine(atpProject({ place_source: "uploaded_file", place_label: null }))).toBe(
      "Study place: an area read from an uploaded file"
    );
    // A searched place whose stored id does not read as a GEOID of its kind claims no kind and no id.
    expect(atpStudyPlaceLine(atpProject({ place_source: "tigerweb", place_kind: "county", place_ref: "not-a-geoid", place_label: "Example County" }))).toBe(
      "Study place: Example County"
    );
  });
});

describe("the applicant line of an ATP application", () => {
  it("says the applicant is not entered, and never prints the workspace name as the applicant or a lead agency", () => {
    const records = recordsFor(COUNTY);
    const consultant = applicationHtml(records, "Demonstration Planning Consultants");
    const agency = applicationHtml(records, "Example Valley Transportation Commission");

    for (const [html, workspaceName] of [[consultant, "Demonstration Planning Consultants"], [agency, "Example Valley Transportation Commission"]] as const) {
      const blocks = textBlocks(html);
      // The same line whatever the workspace is called: on the cover and in Appendix A.
      expect(blocks.filter((text) => text === APPLICANT_LINE)).toHaveLength(2);
      // The workspace is named once, as the workspace.
      const naming = blocks.filter((text) => text.includes(workspaceName));
      expect(naming).toEqual([`Workspace ${workspaceName}`]);
      for (const text of blocks) {
        if (/applicant|lead agency/i.test(text)) expect(text).not.toContain(workspaceName);
      }
      expect(html).not.toMatch(/<dt>Lead agency:?<\/dt>/);
    }
  });
});

describe("refusals in an ATP application", () => {
  it("prints no \"to be provided\" for any record state", () => {
    const states: AtpEvidenceRecords[] = [
      recordsFor(COUNTY),
      recordsFor({}),
      // No summary, no estimate, no run, no crash acquisition, no campaign, no benefit-cost record.
      recordsFor({ summary: null, estimated_cost_amount: null, estimated_cost_currency: null }, {
        run: { status: "absent" }, crash: { status: "absent" }, bca: { status: "absent" }, engagement: { status: "absent" },
      }),
    ];
    for (const records of states) {
      const html = applicationHtml(records, "Demonstration Planning Consultants");
      expect(html).not.toMatch(/to be provided/i);
    }
    // A project with no summary says so as a fact about the record.
    const packet = byKey(buildAtpEvidenceAppendices(states[2], ALL), "scoring_packet");
    expect(packet.facts.find((fact) => fact.label === "Project description")?.value).toBe("Not recorded in OpenPlan. The project has no summary.");
  });

  it("prints words, not a dash, in an empty cell", () => {
    const html = applicationHtml(recordsFor(COUNTY), "Demonstration Planning Consultants");
    // No cell is a lone dash. (The engagement caveat's own sentence holds a dash; that text is fixed.)
    expect(html).not.toMatch(/<td>\s*—\s*<\/td>/);
    // The checklist row with nothing attached and no note, and the provenance row of a section a planner wrote.
    expect(html).toContain("<td>Nothing attached</td>\n          <td>None</td>");
    expect(html).toContain("<td>Operator-authored</td>\n          <td>No model</td>\n          <td>Not applicable</td>");
  });
});

describe("Appendix E of an ATP application", () => {
  /**
   * SOURCE. California Transportation Commission, 2027 Active Transportation
   * Program Guidelines, Resolution G-26-31, adopted March 19, 2026, section
   * 12.A "Disadvantaged Communities", pages 10 and 11, read November 15, 2026
   * from https://catc.ca.gov/-/media/ctc-media/documents/programs/atp/cycle8/2027-atp-guidelines-a11y.pdf
   * (SHA-256 afbd68c0aa24214e48ed2e0f2759c4da8376c2ae2de8898acc540abb63ac6ff3).
   * The Guidelines say: "To qualify as a disadvantaged community, the
   * community served by the project must meet at least one of the following
   * criteria:" and list six bullets. Each entry below is a bullet's name and
   * the words that open it, in the Guidelines' order.
   */
  const GUIDELINES_12A: Array<[name: string, opens: string]> = [
    ["Median Household Income", "(Table ID B19013) is less than 80% of the statewide median"],
    ["CalEnviroScreen", "An area identified as among the most disadvantaged 25% in the state"],
    ["National School Lunch Program", "At least 75% of public-school students in the project area are eligible to receive free or reduced-price meals"],
    ["Healthy Places Index", "The Healthy Places Index includes a composite score for each census tract in the State."],
    ["Native American Tribal Lands", "Projects located within federally recognized Tribal Lands"],
    ["Other", "If an applicant believes that the project benefits a disadvantaged community, but the project does not meet the above-mentioned criteria"],
  ];

  const criteriaRows = (appendix: AtpAppendix) => appendix.facts.filter((fact) => fact.label.startsWith("Guidelines criterion, "));

  it("lists the Guidelines' six criteria by the Guidelines' names, in the Guidelines' order", () => {
    expect([...ATP_GUIDELINES_DAC_CRITERIA]).toEqual(GUIDELINES_12A.map(([name]) => name));
    const equity = byKey(buildAtpEvidenceAppendices(recordsFor(COUNTY), ALL), "equity");
    expect(criteriaRows(equity).map((fact) => fact.label)).toEqual(GUIDELINES_12A.map(([name]) => `Guidelines criterion, ${name}`));
  });

  it("drops AB 1550, which is not an ATP criterion, and prints no yes or no for any criterion", () => {
    for (const place of [COUNTY, TRIBAL_AREA, {}]) {
      const equity = byKey(buildAtpEvidenceAppendices(recordsFor(place), ALL), "equity");
      const text = [...equity.facts.map((fact) => `${fact.label}: ${fact.value}`), ...equity.notes].join("\n");
      expect(text).not.toMatch(/AB 1550/);
      for (const row of criteriaRows(equity)) expect(row.value).not.toMatch(/^(Yes|No)\b/);
    }
  });

  it("states for a Census tribal area that the study place is one, in the Native American Tribal Lands row and nowhere else", () => {
    const tribal = byKey(buildAtpEvidenceAppendices(recordsFor(TRIBAL_AREA), ALL), "equity");
    expect(criteriaRows(tribal).map((fact) => fact.value)).toEqual([
      "Not recorded in OpenPlan",
      "Not recorded in OpenPlan",
      "Not recorded in OpenPlan",
      "Not recorded in OpenPlan",
      "The study place is a Census tribal area: Hoopa Valley Reservation, CA",
      "Not recorded in OpenPlan",
    ]);

    // A county, a city and a project with no study place hold nothing for any criterion.
    const CITY = { place_source: "tigerweb", place_kind: "city", place_ref: "0686944", place_label: "Yreka, CA" };
    for (const place of [COUNTY, CITY, {}]) {
      const equity = byKey(buildAtpEvidenceAppendices(recordsFor(place), ALL), "equity");
      expect(criteriaRows(equity).map((fact) => fact.value)).toEqual(Array(6).fill("Not recorded in OpenPlan"));
    }
  });

  it("says under Appendix E, for a Census tribal area only, that the area is not a finding about federally recognized Tribal Lands", () => {
    // Review 76: the Guidelines' criterion is a project within federally recognized
    // Tribal Lands, and a Census tribal area is wider than that and is not the project location.
    const note = "A Census tribal area is not a finding that the project is located within federally recognized Tribal Lands.";
    expect(ATP_CENSUS_TRIBAL_AREA_NOTE).toBe(note);
    const tribal = byKey(buildAtpEvidenceAppendices(recordsFor(TRIBAL_AREA), ALL), "equity");
    expect(tribal.notes.filter((text) => text === note)).toHaveLength(1);
    // It prints in the application document, with the appendix's other notes.
    const html = applicationHtml(recordsFor(TRIBAL_AREA), "Demonstration Planning Consultants");
    expect(textBlocks(html).filter((text) => text === note)).toHaveLength(1);

    // A county, a city and a project with no study place state no tribal-area fact, so the note has nothing to qualify.
    const CITY = { place_source: "tigerweb", place_kind: "city", place_ref: "0686944", place_label: "Yreka, CA" };
    for (const place of [COUNTY, CITY, {}]) {
      const equity = byKey(buildAtpEvidenceAppendices(recordsFor(place), ALL), "equity");
      expect(equity.notes).not.toContain(note);
      expect(applicationHtml(recordsFor(place), "Demonstration Planning Consultants")).not.toContain("federally recognized Tribal Lands");
    }
  });

  it("makes no determination, qualification or score out of the tribal-area fact", () => {
    const equity = byKey(buildAtpEvidenceAppendices(recordsFor(TRIBAL_AREA), ALL), "equity");
    const row = equity.facts.find((fact) => fact.label === "Guidelines criterion, Native American Tribal Lands")!;
    // The fact and nothing more.
    expect(row.value).toBe("The study place is a Census tribal area: Hoopa Valley Reservation, CA");
    const said = [...equity.facts.map((fact) => fact.value), ...equity.notes].join("\n");
    expect(said).not.toMatch(/\bqualif(y|ies|ied) as\b|\bis a disadvantaged community\b|\bmeets the\b|\bis eligible\b/i);
    expect(equity.facts.find((fact) => fact.label === "ATP disadvantaged-community criteria")?.value).toBe(
      `Not assessed. OpenPlan does not decide ATP eligibility; the CTC's guidelines set the criteria. ${ATP_VERIFY_GUIDELINES}`
    );
    expect(equity.notes).toContain("No row above is a determination that a community is disadvantaged or that the project benefits one. The applicant shows that in the application.");
  });

  it("says the run did not record whether tract data was retrieved, when the run stored no data-quality record", () => {
    const census = { census: { dataset: "ACS 5-Year", vintage: "2023", tractCount: 0, clipScale: "county" } };
    const source = (metrics: Record<string, unknown>) => {
      const records = recordsFor(COUNTY, { run: { status: "ready", run: atpRun({ metrics: atpRunMetrics(metrics) }) } });
      return byKey(buildAtpEvidenceAppendices(records, ALL), "equity").facts.find((fact) => fact.label === "Demographic source")?.value;
    };
    // No data-quality record: nothing is known either way.
    expect(source({ dataQuality: undefined, sourceSnapshots: census })).toBe("ACS 5-Year 2023: the run did not record whether tract data was retrieved");
    // The run recorded that its Census inputs were unavailable: that is known.
    expect(source({ dataQuality: { censusAvailable: false }, sourceSnapshots: census })).toBe("ACS 5-Year 2023: no tract data was retrieved for this run");
  });
});

describe("the crash appendix of an ATP application", () => {
  it("prints the requested years as one range and names the source's cutoff as the source's", () => {
    const fars = recordsFor(TRIBAL_AREA, {
      crash: {
        status: "ready",
        evidence: atpCrashEvidence(
          { source_id: "fars-national", source_label: "NHTSA Fatality Analysis Reporting System (FARS)", severity_completeness: "fatal_only", crash_count: 4, geocoded_count: 4, stored_count: 4, published_through: "2024-12-31" },
          [{ ingest_id: ATP_IDS.ingest, dimension: "severity", value: "fatal", record_count: 4 }]
        ),
        retrievedAt: "2026-11-16T01:55:00+00:00",
      },
    });
    const crash = byKey(buildAtpEvidenceAppendices(fars, ALL), "crash_summary");
    const fact = (label: string) => crash.facts.find((entry) => entry.label === label)?.value;
    expect(fact("Years requested")).toBe("2022–2025");
    expect(fact("Source published through")).toBe(
      "Dec 31, 2024, as the source states. The source holds no published crashes for 2025, which the request also covered."
    );
    // One way of writing a day: no stored calendar date in the notes.
    expect(crash.notes.join("\n")).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
    expect(crash.notes.join("\n")).toContain("published through Dec 31, 2024");
    // The citation's range is the requested range.
    expect(crash.notes.join("\n")).toContain("years 2022–2025");
  });

  it("prints no cutoff line when the source states none", () => {
    const crash = byKey(buildAtpEvidenceAppendices(recordsFor(COUNTY), ALL), "crash_summary");
    expect(crash.facts.map((fact) => fact.label)).not.toContain("Source published through");
  });
});

describe("the cover and checklist of an ATP application", () => {
  it("names each attached Knowledge Base document by its title", () => {
    const html = applicationHtml(recordsFor(COUNTY), "Demonstration Planning Consultants");
    expect(html).toContain("<td>Knowledge Base document: Main Street vicinity map (demonstration)</td>");
    expect(html).not.toContain("<td>Knowledge Base document</td>");
    // A title that was not read is said to be unread, never guessed.
    const unread = applicationHtml(recordsFor(COUNTY), "Demonstration Planning Consultants", { documentTitles: new Map() });
    expect(unread).toContain("<td>Knowledge Base document (its title could not be read)</td>");
    // Under the table, one line for the attached item and none for the item with nothing attached.
    expect(textBlocks(html).filter((text) => text.startsWith("Attached for "))).toEqual([
      "Attached for Project location and vicinity map: Knowledge Base document: Main Street vicinity map (demonstration)",
    ]);
    // A different title gives a different line: the title is read from the map the export passes.
    const other = applicationHtml(recordsFor(COUNTY), "Demonstration Planning Consultants", { documentTitles: new Map([[ATTACHED_DOCUMENT, "Second vicinity map (demonstration)"]]) });
    expect(textBlocks(other).filter((text) => text.startsWith("Attached for "))).toEqual([
      "Attached for Project location and vicinity map: Knowledge Base document: Second vicinity map (demonstration)",
    ]);
  });

  it("prints the study place and applicant above the cover's boxes, so a long summary cannot push them off the first page", () => {
    const cover = coverOf(applicationHtml(recordsFor(COUNTY), "Demonstration Planning Consultants"));
    expect(TRACKED_SUMMARY.length).toBeGreaterThan(300);
    expect(cover.indexOf('<div class="cover-lines">')).toBeGreaterThan(cover.indexOf("</h1>"));
    expect(cover.indexOf('<div class="cover-lines">')).toBeLessThan(cover.indexOf('<div class="facts"'));
  });

  it("leaves the Program box out when no program record is linked, and prints it when one is", () => {
    const unlinked = coverOf(applicationHtml(recordsFor(COUNTY), "Demonstration Planning Consultants"));
    expect(unlinked).not.toContain("<dt>Program</dt>");
    expect(unlinked).not.toContain("Not linked");
    const linked = coverOf(applicationHtml(recordsFor(COUNTY), "Demonstration Planning Consultants", { programTitle: "FY 2027 active transportation program" }));
    expect(linked).toContain("<div><dt>Program</dt><dd>FY 2027 active transportation program</dd></div>");
  });

  it("names source records in the appendix index by kind, and prints each id whole on its appendix's source line", () => {
    const html = applicationHtml(recordsFor(COUNTY), "Demonstration Planning Consultants");
    const index = html.slice(html.indexOf('<section id="evidence-appendices">'), html.indexOf('<article id="appendix-scoring_packet"'));
    expect(index).toContain("<td>Corridor analysis run</td>");
    expect(index).not.toContain(ATP_IDS.run);
    expect(index).not.toContain(ATP_IDS.ingest);
    expect(html).toContain(`<strong>Source:</strong> Corridor analysis run <span class="whole-id">${ATP_IDS.run}.</span>`);
    expect(html).toContain(`<strong>Source:</strong> Crash acquisition <span class="whole-id">${ATP_IDS.ingest}.</span>`);
    // A stored content hash is treated the same way: said to be stored in the index, printed whole under its appendix.
    const hash = byKey(buildAtpEvidenceAppendices(recordsFor(COUNTY), ALL), "bca").source!.hash!;
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(index).not.toContain(hash);
    expect(index).toContain("<td>Stored, printed under the appendix</td>");
    expect(index).toContain("<td>None stored</td>");
    expect(html.split(hash)).toHaveLength(2);
  });

  it("sets every record id and content hash in the appendices' running text as one piece that cannot break", () => {
    const html = applicationHtml(recordsFor(COUNTY), "Demonstration Planning Consultants");
    const appendices = html.slice(html.indexOf('<article id="appendix-scoring_packet"'), html.indexOf('<section id="provenance-appendix">'));
    const ids = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{40,}/gi;
    // The fixture prints several: the run, the acquisition (twice, once in its citation), the project link, a hash.
    expect((appendices.match(ids) ?? []).length).toBeGreaterThanOrEqual(6);
    // With each whole piece, each link address and the map's drawing taken out, no id is left loose in the text.
    const loose = appendices
      .replace(/<span class="whole-id">[^<]*<\/span>/g, "")
      .replace(/href="[^"]*"/g, "")
      .replace(/<svg[\s\S]*?<\/svg>/g, "");
    expect(loose.match(ids) ?? []).toEqual([]);
    // The citation's id is one piece with its full stop, so the stop cannot wrap alone.
    expect(appendices).toContain(`Source ingest <span class="whole-id">${ATP_IDS.ingest}.</span>`);
    // The piece has a style: a class with no rule would do nothing.
    expect(html).toMatch(/\.whole-id \{ display: inline-block; max-width: 100%; \}/);
  });
});

// ---------------------------------------------------------------------------
// The PDF Chrome prints, read back with Poppler.
// ---------------------------------------------------------------------------

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
const workDir = PDF_TOOLS ? mkdtempSync(path.join(tmpdir(), "openplan-atp-facts-")) : "";
afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

/** `pdftotext -layout`, one string per page. */
async function pdfPages(html: string, name: string): Promise<string[]> {
  process.env.CHROME_EXECUTABLE_PATH = CHROME;
  const file = path.join(workDir, `${name}.pdf`);
  writeFileSync(file, await renderHtmlToPdf(html, { footerLabel: "Active Transportation Program (ATP)" }));
  const pdftotext = path.join(POPPLER!, `pdftotext${process.platform === "win32" ? ".exe" : ""}`);
  const text = execFileSync(pdftotext, ["-layout", file, "-"]).toString();
  return text.split("\f").filter((page) => page.trim().length > 0);
}

/** The pages on which the shared matcher finds the phrase whole. */
function pagesWith(pages: string[], phrase: string): number[] {
  return pages.flatMap((page, index) => (pdfTextHasPhrase(page, phrase) ? [index + 1] : []));
}

/** True when some line of some page is exactly this text. */
function hasLine(pages: string[], line: string): boolean {
  return pages.some((page) => page.split(/\r?\n/).some((candidate) => candidate.trim() === line));
}

describe.runIf(PDF_TOOLS)("the ATP application PDF, read back with pdftotext -layout", () => {
  const cases = [
    { name: "county", place: COUNTY, line: COUNTY_LINE, other: TRIBAL_AREA_LINE, workspace: "Demonstration Planning Consultants" },
    { name: "tribal-area", place: TRIBAL_AREA, line: TRIBAL_AREA_LINE, other: COUNTY_LINE, workspace: "Example Valley Transportation Commission" },
  ];

  it.each(cases)("finds every fact of the $name application as one string on one page", async ({ name, place, line, other, workspace }) => {
    const records = recordsFor(place);
    const appendices = buildAtpEvidenceAppendices(records, ALL);
    const pages = await pdfPages(applicationHtml(records, workspace), name);
    const whole = pages.join("\n");

    // The place and the applicant: each a line of its own, on the cover page and again in Appendix A.
    expect(hasLine([pages[0]], line)).toBe(true);
    expect(hasLine([pages[0]], APPLICANT_LINE)).toBe(true);
    expect(pagesWith(pages, line).length).toBeGreaterThanOrEqual(2);
    expect(pagesWith(pages, APPLICANT_LINE).length).toBeGreaterThanOrEqual(2);
    expect(pagesWith(pages, other)).toEqual([]);

    // Short headline facts read as one line of the page, label and value together.
    for (const expected of [
      "Program: Active Transportation Program (ATP)",
      "Program page: https://catc.ca.gov/programs/active-transportation-program",
      "Safety, OpenPlan screening score (not a CTC score): 60.0",
      "Climate, OpenPlan screening score (not a CTC score): Not recorded",
      "Years requested: 2022–2025",
      "Crashes reported: 80",
      "Fatal crashes: 2",
      "Price year: 2026",
      "Guidelines criterion, CalEnviroScreen: Not recorded in OpenPlan",
    ]) {
      expect(hasLine(pages, expected), expected).toBe(true);
    }

    // Every fact of every included appendix, long or short, is one string on one page:
    // not split by a column gap, a blank line or a page break.
    const lines = factLines(appendices);
    expect(lines.length).toBeGreaterThan(50);
    for (const fact of lines) {
      expect(pagesWith(pages, fact).length, fact).toBeGreaterThanOrEqual(1);
    }

    // The four [VERIFY] markers the packet prints by design, each whole.
    const marker = ATP_VERIFY_GUIDELINES;
    expect(lines.filter((fact) => fact.includes(marker))).toHaveLength(3);
    expect(pagesWith(pages, ATP_APPENDIX_FRAME.verify)).toHaveLength(1);
    expect(whole.match(/\[VERIFY/g)).toHaveLength(4);

    // The workspace is named as the workspace and nowhere near the applicant.
    expect(pagesWith(pages, workspace)).toEqual([1]);
    expect(pdfTextHasPhrase(whole, `Applicant ${workspace}`)).toBe(false);
    expect(pdfTextHasPhrase(whole, `Applicant: ${workspace}`)).toBe(false);
    expect(pdfTextHasPhrase(whole, `Lead agency ${workspace}`)).toBe(false);

    // Refusals.
    expect(whole).not.toMatch(/to be provided/i);
    // No cell or line is a lone dash.
    expect(whole).not.toMatch(/(^|\s{2})—(\s{2}|$)/m);
    expect(whole).not.toMatch(/Program\s+Not linked|Not linked/);
    // One way of writing a day in the appendices.
    expect(whole).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
    // Each record id and the stored content hash print whole. With every line
    // break and space taken out, a string broken across lines is found again;
    // each must be found that way exactly as often as it is found on one line.
    const allLines = pages.flatMap((page) => page.split(/\r?\n/));
    const joined = whole.replace(/\s+/g, "");
    for (const token of [ATP_IDS.run, ATP_IDS.ingest, byKey(appendices, "bca").source!.hash!]) {
      const onOneLine = allLines.filter((candidate) => candidate.includes(token)).length;
      expect(onOneLine, token).toBeGreaterThanOrEqual(1);
      expect(joined.split(token).length - 1, token).toBe(onOneLine);
    }
    // The attached document's title is found whole, in the line under the checklist. In the
    // checklist's own cell it wraps beside the other columns and is not found.
    const attachedLine = "Attached for Project location and vicinity map: Knowledge Base document: Main Street vicinity map (demonstration)";
    expect(pagesWith(pages, attachedLine)).toHaveLength(1);
    expect(pagesWith(pages, "Attached Knowledge Base document: Main Street vicinity map (demonstration)")).toEqual([]);
  }, 120_000);

  it("never breaks a record id at a hyphen, wherever on the line it falls", async () => {
    // Forty facts, each a run of filler words and then the same id. The filler grows two characters at a
    // time, so the id starts at forty different places along the line. Printed as plain text, an id that
    // straddles the line end breaks at one of its hyphens. None may.
    const id = "0f3c9a1e-7b42-4d58-9c61-2e8a5b7d4f90";
    const facts = Array.from({ length: 40 }, (_, index) => ({ label: `Row ${index + 1}`, value: `${"x ".repeat(index + 20)}record ${id} follows` }));
    const appendix: AtpAppendix = {
      ...byKey(buildAtpEvidenceAppendices(recordsFor(COUNTY), ALL), "cost_estimate"),
      facts, notes: [`A note that names the record ${"filler ".repeat(11)}${id}.`],
    };
    const html = buildGrantApplicationHtml({
      opportunity: { id: ATP_IDS.opportunity, title: "ATP application", agency_name: null, summary: null, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
      programTitle: null, sections: [], attachments: [], generatedAt: "2026-11-16T04:00:00.000Z",
      evidenceAppendices: [appendix], evidenceAppendixFrame: ATP_APPENDIX_FRAME,
    });
    const pages = await pdfPages(html, "ids-along-the-line");
    const lines = pages.flatMap((page) => page.split(/\r?\n/));
    const whole = lines.filter((line) => line.includes(id)).length;
    // Every fact and the note print the id on one line.
    expect(whole).toBe(41);
    // No line ends partway through it.
    expect(lines.filter((line) => /0f3c9a1e(-[0-9a-f]{0,12})*-?\s*$/.test(line) && !line.includes(id))).toEqual([]);
    // The rows did wrap: some facts took two lines, so ids did reach the line end.
    expect(lines.filter((line) => /^\s*record 0f3c9a1e|^\s*0f3c9a1e/.test(line)).length).toBeGreaterThan(3);
  }, 120_000);

  it("never splits a not-final box across a page break", async () => {
    // Cover boxes are not checked here: a fresh-context review (review 76) removed the rule that
    // keeps a cover box whole and this test still passed. Only the byte pins see that rule.
    // Forty sections under the long cover of a tracked opportunity. Every other one has no final text
    // and prints a two-line box. Between them sit final sections whose text grows by one sentence each
    // time, so the boxes fall at many different heights on their pages. With nothing holding a box
    // together, some land across a page break (the mutation pair for this test shows it).
    const row = { workspace_id: ATP_IDS.workspace, opportunity_id: ATP_IDS.opportunity, updated_by: null, created_at: "", updated_at: "" };
    const records = recordsFor(COUNTY);
    const filler = "Demonstration text, typed by an agent for a layout check, long enough to fill most of one printed line.";
    const html = buildGrantApplicationHtml({
      opportunity: { id: ATP_IDS.opportunity, title: "Active Transportation Program (ATP)", agency_name: "California Transportation Commission / Caltrans", summary: TRACKED_SUMMARY, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
      programTitle: null,
      sections: Array.from({ length: 40 }, (_, index) => {
        const final = index % 2 === 1;
        return {
          section: {
            ...row, id: `section-${index}`, section_key: `demonstration-${index}`, title: `Demonstration section ${index + 1}`, guidance: null, sort_order: index,
            source: "custom" as const, suggested_evidence: [], ai_drafting_enabled: true, status: final ? ("final" as const) : ("not_started" as const),
            final_markdown: final ? Array.from({ length: (index % 9) + 1 }, () => filler).join(" ") : null,
            finalized_from_draft_id: null, finalized_by: null, finalized_at: null,
          },
          provenance: { origin: final ? ("operator_authored" as const) : ("none" as const), model: null, groundedSentenceCount: null, totalSentenceCount: null, finalizedBy: null, finalizedAt: null },
        };
      }),
      attachments: [], generatedAt: "2026-11-16T04:00:00.000Z",
      coverLines: atpCoverLines(records.project),
      applicant: { project: { status: "named", name: "Main Street sidewalk gap closure" }, workspace: { status: "named", name: "Demonstration Planning Consultants" } },
    });
    const pages = await pdfPages(html, "boxes-across-pages");
    expect(pages.length).toBeGreaterThanOrEqual(6);
    const count = (page: string, pattern: RegExp) => (page.match(pattern) ?? []).length;
    const split: number[] = [];
    let boxes = 0;
    pages.forEach((page, index) => {
      // Every box that starts on a page ends on it.
      const starts = count(page, /Not finalized: this section/g);
      if (starts !== count(page, /no approved text exists for it yet\./g)) split.push(index + 1);
      boxes += starts;
    });
    expect(split).toEqual([]);
    expect(boxes).toBe(20);
  }, 120_000);

  it("prints the DRAFT stamp on the first page, above the cover boxes", async () => {
    // Review 76: the cover lines and full-width boxes had pushed the stamp to page 2 in every export.
    const pages = await pdfPages(applicationHtml(recordsFor(COUNTY), "Demonstration Planning Consultants"), "stamp-first-page");
    const stamp = /DRAFT: \d+ required attachment\(s\) outstanding/;
    expect(pages[0]).toMatch(stamp);
    expect(pages.slice(1).some((page) => stamp.test(page))).toBe(false);
    // Above the boxes: the stamp comes before the first box label on the page.
    expect(pages[0].search(stamp)).toBeLessThan(pages[0].search(/FUNDER \/ AGENCY/i));
  }, 120_000);

  it("prints the tribal-area fact on one line in the tribal-area PDF only", async () => {
    const tribalFact = "Guidelines criterion, Native American Tribal Lands: The study place is a Census tribal area: Hoopa Valley Reservation, CA";
    const tribal = await pdfPages(applicationHtml(recordsFor(TRIBAL_AREA), "Demonstration Planning Consultants"), "tribal-row");
    const county = await pdfPages(applicationHtml(recordsFor(COUNTY), "Demonstration Planning Consultants"), "county-row");
    expect(pagesWith(tribal, tribalFact)).toHaveLength(1);
    expect(pagesWith(county, tribalFact)).toEqual([]);
    expect(pagesWith(county, "Guidelines criterion, Native American Tribal Lands: Not recorded in OpenPlan")).toHaveLength(1);
  }, 120_000);
});

/**
 * Synthetic files for the third proven job's example record
 * (schemas/examples/proven_job_record.v1.atp-application.synthetic.json).
 *
 * Each "PDF" is a text file read by a stand-in reader, as the first two
 * jobs' checker tests do: a first line that begins %PDF and says the file is
 * synthetic, then the pages, set apart by form feeds. The pages are written
 * here from the job's definition entry and the journey's own record, laid
 * out the way Poppler's `pdftotext -layout` prints a real ATP application
 * (long section titles wrapped, a footer on every page, facts one to a
 * line). They are the smallest files that carry the lines the checker
 * reads. They are not built by the product's export code;
 * proven-job-atp-application-real-pdf.test.ts does that, with a real PDF.
 *
 * Plain ESM with no dependencies, so the test and a reviewer's script can
 * both load it. Nothing here is evidence, and no place, run or file is real.
 */

export const SYNTHETIC_PDF_HEADER = "%PDF-1.4 synthetic test file for the proven job checker, not a real PDF";

const FOOTER = (page, pages) => `${" ".repeat(60)}Active Transportation Program (ATP) · Page ${page} of ${pages}`;

/** A count as the export prints it. */
const count = (value) => Number(value).toLocaleString("en-US");

/** Wrap a title the way a narrow heading column does: no more than `width` characters to a line. */
function wrapTitle(title, width = 54) {
  const lines = [];
  let line = "";
  for (const word of title.split(" ")) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  lines.push(line);
  return lines;
}

/** "November 20, 2026" for an ISO time, the day as the export prints it in UTC. */
function assembledDay(iso) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(new Date(iso));
}

/**
 * The pages of one journey's synthetic application, as page texts.
 * @param {Record<string, any>} journey one journey of the example record
 * @param {Record<string, any>} job the job's definition entry
 * @returns {string[]}
 */
export function syntheticApplicationPages(journey, job) {
  const rule = job.application;
  const { place, crashes, application } = journey;
  const headings = job.itemHeadings[rule.pdf];
  const label = rule.demonstrationLabel.text;
  const placeLine = rule.placeLine.template
    .replace("{label}", place.label)
    .replace("{kind}", rule.placeLine.kindWords[place.kind])
    .replace("{geoid}", place.geoid);
  const stamp = rule.draftStamp.phrase.replace("{count}", count(application.outstandingRequiredCount));
  const roleFacts = (item) => rule.appendices.roleFacts.filter((fact) => fact.item === item && fact.roles.includes(journey.role)).map((fact) => `      ${fact.phrase}`);

  const cover = [
    "OPENPLAN GRANTS: APPLICATION PACKET",
    "",
    "Active Transportation",
    "Program (ATP)",
    "",
    "Synthetic summary of the program, written for the checker tests.",
    "",
    placeLine,
    "",
    rule.applicant.line,
    "",
    "The study place is the area recorded for the linked project in OpenPlan. It does not state the",
    "project limits.",
    "",
    `  ${stamp}`,
    "",
    "  PROJECT",
    "",
    `  ${journey.projectName}`,
    "",
    "  WORKSPACE",
    "",
    `  ${journey.workspaceName}`,
    "",
    "  SECTIONS FINAL                  ASSEMBLED",
    "",
    // The Assembled box as the export prints it for a workspace with no time
    // zone: the export time's day, then the minute and the zone over three lines.
    `  ${rule.sections.list.length} of ${rule.sections.list.length}                        ${assembledDay(application.exportedAt)}`,
    `                                  at ${application.exportedAt.slice(11, 16)} (UTC, no`,
    "                                  workspace time",
    "                                  zone set)",
  ];

  const section = ({ title, disposition }) => [
    ...wrapTitle(title),
    "",
    `${label}. This synthetic text describes no real project and makes no claim about any`,
    disposition === "fixed-note" ? `agency, place or community. ${rule.sections.fixedNote}` : "agency, place or community. An agency would write its own answer here.",
    "",
  ];
  const sections = rule.sections.list.map(section);

  const checklist = [
    rule.sections.end,
    "",
    "ATTACHMENT                       REQUIRED      STATUS           FULFILLMENT          NOTE",
    ...application.rows.slice(0, 4).map((row, index) => {
      const defined = rule.rows.list[index];
      const required = { required: "Required", "if-applicable": "Required if", optional: "Optional" }[defined.requirement];
      const status = row.disposition === "not-applicable" ? "Not applicable" : "Missing";
      return `${defined.title.slice(0, 30).padEnd(33)}${required.padEnd(14)}${status.padEnd(17)}Nothing attached     None`;
    }),
    "",
  ];

  const frame = [
    "Evidence appendices",
    "",
    "Each appendix restates a saved OpenPlan record for the linked project, with its source",
    "record and date. Missing records are listed as missing. Scores are OpenPlan screening",
    "scores, not CTC scores. These appendices do not establish ATP eligibility or that this",
    "package meets the current call for projects.",
    "",
  ];
  const appendixA = [
    headings["appendix-a"],
    "",
    "Source: Corridor analysis run 00000000-0000-4000-8000-000000000301. Run saved: Nov 20, 2026, 10:20",
    "UTC. No content hash is stored for this record.",
    "",
    "Program: Active Transportation Program (ATP)",
    "",
    "Administering agency: California Transportation Commission / Caltrans",
    "",
    "Program page: https://catc.ca.gov/programs/active-transportation-program",
    "",
    `Project: ${journey.projectName}`,
    "",
    placeLine,
    "",
    rule.applicant.line,
    "",
    `Safety score source: California Crash Reporting System (CCRS), crash years ${crashes.years},`,
    "retrieved Nov 20, 2026.",
    "",
    "Safety, OpenPlan screening score (not a CTC score): 80.0",
    "",
    "Equity, OpenPlan screening score (not a CTC score): Not recorded. Equity is withheld",
    "because required demographic inputs are unavailable.",
    "",
    "Climate, OpenPlan screening score (not a CTC score): Not recorded",
    "",
    "Feasibility, OpenPlan screening score (not a CTC score): Not recorded",
    "",
    "Total (OpenPlan weights 30/25/25/20, not CTC points), OpenPlan screening",
    "score (not a CTC score): Not recorded",
    "",
    "      These are OpenPlan screening scores from the project's corridor analysis. The CTC",
    "      scores ATP applications under its current guidelines.",
    "",
    "      OpenPlan does not decide ATP eligibility.",
    "",
  ];
  const appendixB = [
    headings["appendix-b"],
    "",
    "Source: Crash acquisition 00000000-0000-4000-8000-000000000302. Retrieved: Nov 20, 2026, 10:10 UTC.",
    "",
    "Source: California Crash Reporting System (CCRS)",
    "",
    `Years requested: ${crashes.years}`,
    "",
    `Crashes reported: ${count(crashes.reportedCount)}`,
    "",
    `Crashes mapped: ${count(crashes.storedCount)}`,
    "",
    "      Crash records are reported collisions retrieved from the source agency, not",
    "      modeled estimates.",
    "",
    ...roleFacts("appendix-b"),
    "",
  ];
  const appendixC = [headings["appendix-c"], "", "Planning-level estimate: USD 1,850,000.00", "", "Price year: 2026", ""];
  const appendixD = [headings["appendix-d"], "", "  Missing. No public engagement campaign is linked to the project.", ""];
  const appendixE = [
    headings["appendix-e"],
    "",
    "Equity screening score (OpenPlan, not a CTC score): Not recorded. Equity is withheld",
    "because required demographic inputs are unavailable.",
    "",
    {
      retrieved: "Demographic source: ACS 5-Year 2023, 4 tracts, clipped to the corridor",
      "none-retrieved": "Demographic source: ACS 5-Year 2023: no tract data was retrieved for this run",
      "not-recorded": "Demographic source: Not recorded in the analysis run",
    }[application.tractData],
    "",
    "ATP disadvantaged-community criteria: Not assessed. OpenPlan does not decide ATP",
    "eligibility; the CTC's guidelines set the criteria.",
    "",
    "Guidelines criterion, Median Household Income: Not recorded in OpenPlan",
    "",
    "Guidelines criterion, CalEnviroScreen: Not recorded in OpenPlan",
    "",
    "Guidelines criterion, National School Lunch Program: Not recorded in OpenPlan",
    "",
    "Guidelines criterion, Healthy Places Index: Not recorded in OpenPlan",
    "",
    place.kind === "aiannh"
      ? `Guidelines criterion, Native American Tribal Lands: The study place is a Census\ntribal area: ${place.label}`
      : "Guidelines criterion, Native American Tribal Lands: Not recorded in OpenPlan",
    "",
    "Guidelines criterion, Other: Not recorded in OpenPlan",
    "",
    "      No row above is a determination that a community is disadvantaged or that the",
    "      project benefits one. The applicant shows that in the application.",
    "",
    ...roleFacts("appendix-e"),
    "",
  ];
  const appendixF = [headings["appendix-f"], "", "  Missing. No benefit-cost analysis or screening is saved for the linked project.", ""];
  const provenance = [rule.appendices.end, "", "How each section's text came to be, disclosed per section.", ""];

  const bodies = [
    cover,
    sections.slice(0, 4).flat(),
    sections.slice(4, 7).flat(),
    [...sections.slice(7).flat(), ...checklist],
    [...frame, ...appendixA],
    [...appendixB, ...appendixC, ...appendixD],
    [...appendixE, ...appendixF, ...provenance],
  ];
  return bodies.map((body, index) => [...body, "", FOOTER(index + 1, bodies.length)].join("\n"));
}

/** The synthetic file's whole text: the header line, then the pages set apart by form feeds. */
export function syntheticApplicationPdfText(journey, job) {
  return `${SYNTHETIC_PDF_HEADER}\n${syntheticApplicationPages(journey, job).join("\f")}`;
}

/**
 * The stand-in reader for a synthetic file's text: its pages, without the header line.
 * @param {string} text
 * @returns {string[]}
 */
export function syntheticPdfPages(text) {
  return text.replace(/^[^\n]*\n/, "").split("\f");
}

/** The page each appendix heading is on, as a record's PDF entry lists its items. */
export function syntheticApplicationItems(journey, job) {
  const pages = syntheticApplicationPages(journey, job);
  const headings = job.itemHeadings[job.application.pdf];
  return Object.keys(job.items).map((item) => ({
    item,
    page: pages.findIndex((page) => page.split("\n").includes(headings[item])) + 1,
    method: "pdftotext",
    text: headings[item],
  }));
}

import { describe, expect, it } from "vitest";
import { buildGrantApplicationHtml } from "@/lib/grants/application-html";
import { ATP_APPENDIX_FRAME, buildAtpEvidenceAppendices, type AtpAppendix } from "@/lib/grants/atp-evidence-appendices";
import { ATP_APPENDIX_KEYS } from "@/lib/grants/evidence-appendix-keys";
import { GRANT_PROGRAM_CATALOG } from "@/lib/grants/program-catalog";
import { ATP_VERIFY_GUIDELINES } from "@/lib/planner-pack/render";
import { htmlToPdfBlocks } from "@/lib/reports/pdf-text";
import { ATP_IDS, atpCrashEvidence, atpProject, atpRun, atpRunMetrics, completeAtpRecords, EQUITY_WITHHELD } from "./fixtures/grants/atp-evidence";
import { EVIDENCE_IDS } from "./fixtures/grants/ss4a-evidence";

/**
 * The ATP evidence appendices are funder-facing claims. These tests read the
 * render model and the TEXT the built-in PDF tier extracts, so every fact must
 * survive as text. Nothing here may print a score the run did not record, and
 * nothing may decide ATP eligibility.
 */

const ALL = new Set<string>(ATP_APPENDIX_KEYS);
const ATP_ENTRY = GRANT_PROGRAM_CATALOG.find((entry) => entry.key === "atp")!;

function byKey(appendices: AtpAppendix[], key: AtpAppendix["key"]) {
  return appendices.find((appendix) => appendix.key === key)!;
}

function fact(appendix: AtpAppendix, label: string): string | undefined {
  return appendix.facts.find((entry) => entry.label === label)?.value;
}

function score(appendix: AtpAppendix, dimension: string): string | undefined {
  return appendix.table?.rows.find((row) => row[0].startsWith(dimension))?.[1];
}

function packetText(appendices: AtpAppendix[]): string {
  const html = buildGrantApplicationHtml({
    opportunity: { id: ATP_IDS.opportunity, title: "ATP application", agency_name: null, summary: null, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
    programTitle: null, sections: [], attachments: [], generatedAt: "2026-11-02T18:30:00.000Z",
    evidenceAppendices: appendices, evidenceAppendixFrame: ATP_APPENDIX_FRAME,
  });
  return htmlToPdfBlocks(html).map((block) => ("text" in block ? block.text : JSON.stringify(block))).join("\n");
}

describe("ATP evidence appendices", () => {
  it("includes every appendix from the linked project's saved records, in the declared order", () => {
    const appendices = buildAtpEvidenceAppendices(completeAtpRecords(), ALL);
    expect(appendices.map((a) => [a.letter, a.key, a.status])).toEqual([
      ["A", "scoring_packet", "included"],
      ["B", "crash_summary", "included"],
      ["C", "cost_estimate", "included"],
      ["D", "engagement", "included"],
      ["E", "equity", "included"],
      ["F", "bca", "included"],
    ]);
    const text = packetText(appendices);
    for (const title of [
      "Appendix A. ATP screening packet",
      "Appendix B. Crash summary",
      "Appendix C. Cost estimate",
      "Appendix D. Engagement summary",
      "Appendix E. Disadvantaged-community and equity inputs",
      "Appendix F. Benefit-cost summary",
    ]) {
      expect(text).toContain(title);
    }
    expect(text).toContain(ATP_APPENDIX_FRAME.intro);
    expect(text).not.toContain("SS4A");
  });

  it("states program facts as the registry stores them, each cycle-dependent one marked [VERIFY] with the CTC page", () => {
    const packet = byKey(buildAtpEvidenceAppendices(completeAtpRecords(), ALL), "scoring_packet");
    expect(fact(packet, "Program")).toBe(ATP_ENTRY.name);
    expect(fact(packet, "Program page")).toBe(ATP_ENTRY.url);
    expect(fact(packet, "Cycle (program registry note)")).toBe(`${ATP_ENTRY.cycleNote} ${ATP_VERIFY_GUIDELINES}`);
    expect(fact(packet, "Local match (program registry note)")).toBe(`${ATP_ENTRY.matchRequirement} ${ATP_VERIFY_GUIDELINES}`);
    expect(ATP_VERIFY_GUIDELINES).toContain(ATP_ENTRY.url);
    // The registry stores no check date; the appendix does not invent one.
    expect(fact(packet, "Date these program facts were checked")).toBe("Not recorded. The program registry stores no check date.");
  });

  it("prints only the scores the run recorded and says the rest are not recorded, with the run's reason", () => {
    const packet = byKey(buildAtpEvidenceAppendices(completeAtpRecords(), ALL), "scoring_packet");
    expect(packet.table!.headers[1]).toBe("OpenPlan screening score (not a CTC score)");
    expect(score(packet, "Safety")).toBe("60.0");
    // The run stored a raw equity number, but its presentation record withheld it.
    expect(score(packet, "Equity")).toBe(`Not recorded. ${EQUITY_WITHHELD}`);
    expect(score(packet, "Climate")).toBe("Not recorded");
    expect(score(packet, "Feasibility")).toBe("Not recorded");
    expect(score(packet, "Total")).toBe("Not recorded");
    expect(packet.source).toMatchObject({ record: "Corridor analysis run", id: ATP_IDS.run });
    expect(fact(packet, "Safety score source")).toBe("California Crash Reporting System (CCRS), crash years 2022–2025, retrieved 2026-11-02.");
    expect(fact(packet, "Project description")).toBe(atpProject().summary);
    expect(fact(packet, "Lead agency")).toBe("Lead agency to be provided");
    expect(packet.notes).toContain("OpenPlan does not decide ATP eligibility.");
  });

  it("names the crash retrieval day on the workspace calendar", () => {
    const records = { ...completeAtpRecords(), timeZone: "America/Los_Angeles" };
    // 03:40 UTC on November 2 is the evening of November 1 in Los Angeles.
    expect(fact(byKey(buildAtpEvidenceAppendices(records, ALL), "scoring_packet"), "Safety score source")).toContain("retrieved 2026-11-01");
  });

  it("keeps the packet with every score not recorded when no run exists, and lists equity as missing", () => {
    const records = { ...completeAtpRecords(), run: { status: "absent" as const } };
    const appendices = buildAtpEvidenceAppendices(records, ALL);
    const packet = byKey(appendices, "scoring_packet");
    expect(packet.status).toBe("included");
    expect(packet.statusNote).toContain("every screening score reads Not recorded");
    expect(packet.table!.rows.map((row) => row[1])).toEqual(["Not recorded", "Not recorded", "Not recorded", "Not recorded", "Not recorded"]);
    expect(byKey(appendices, "equity")).toMatchObject({ status: "missing" });
    expect(byKey(appendices, "equity").statusNote).toContain("No corridor analysis run is saved");
  });

  it("refuses to turn a failed run read into not-recorded scores", () => {
    const records = { ...completeAtpRecords(), run: { status: "unreadable" as const, reason: "The project's corridor analysis runs could not be read." } };
    const appendices = buildAtpEvidenceAppendices(records, ALL);
    expect(byKey(appendices, "scoring_packet")).toMatchObject({ status: "unreadable", table: null });
    expect(byKey(appendices, "equity")).toMatchObject({ status: "unreadable" });
  });

  it("states the crash source, years, severity coverage and counts the acquisition holds", () => {
    const crash = byKey(buildAtpEvidenceAppendices(completeAtpRecords(), ALL), "crash_summary");
    expect(crash.source).toMatchObject({ record: "Crash acquisition", id: ATP_IDS.ingest, date: "2026-11-02T15:00:00+00:00" });
    expect(fact(crash, "Source")).toBe("California Crash Reporting System (CCRS)");
    expect(fact(crash, "Years requested")).toBe("2022, 2023, 2024, 2025");
    expect(fact(crash, "Recorded severity coverage")).toBe("kabco_full");
    expect(fact(crash, "Crash area")).toBe("Place boundary");
    expect(fact(crash, "Crashes outside the boundary, left out")).toBe("261");
    expect(fact(crash, "Fatal crashes")).toBe("2");
    expect(fact(crash, "Serious-injury crashes")).toBe("12");
    expect(fact(crash, "Other injury crashes")).toBe("63");
    expect(fact(crash, "Fatal and serious-injury crashes")).toBe("14");
    expect(crash.notes.join(" ")).toContain("Crashes are counted inside the place boundary.");
  });

  it("does not count serious injuries a fatality census or an unsplit injury source cannot show", () => {
    const records = completeAtpRecords();
    records.crash = { status: "ready", evidence: atpCrashEvidence({ severity_completeness: "fatal_only", crash_count: 2, geocoded_count: 2, stored_count: 2 }, [{ ingest_id: ATP_IDS.ingest, dimension: "severity", value: "fatal", record_count: 2 }]), retrievedAt: null };
    const fatalOnly = byKey(buildAtpEvidenceAppendices(records, ALL), "crash_summary");
    expect(fact(fatalOnly, "Serious-injury crashes")).toBe("Not in source (fatal crashes only)");
    expect(fact(fatalOnly, "Property-damage-only crashes")).toBe("Not in source (fatal crashes only)");
    expect(fact(fatalOnly, "Fatal and serious-injury crashes")).toBe("Not derivable from this source");

    records.crash = { status: "ready", evidence: atpCrashEvidence({ severity_completeness: "fatal_injury_only", crash_count: 77, geocoded_count: 77, stored_count: 77 }, [
      { ingest_id: ATP_IDS.ingest, dimension: "severity", value: "fatal", record_count: 2 },
      { ingest_id: ATP_IDS.ingest, dimension: "severity", value: "injury", record_count: 75 },
    ]), retrievedAt: null };
    const unsplit = byKey(buildAtpEvidenceAppendices(records, ALL), "crash_summary");
    expect(fact(unsplit, "Serious-injury crashes")).toBe("Not separated in source (injury crashes not split by severity)");
    expect(fact(unsplit, "Injury crashes")).toBe("75");
    expect(fact(unsplit, "Fatal and serious-injury crashes")).toBe("Not derivable from this source");
  });

  it("prints unreadable crash counts as unavailable, never as zero", () => {
    const records = completeAtpRecords();
    records.crash = { status: "ready", evidence: atpCrashEvidence({}, null), retrievedAt: null };
    const crash = byKey(buildAtpEvidenceAppendices(records, ALL), "crash_summary");
    expect(fact(crash, "Crashes by severity")).toMatch(/^Not available\./);
    expect(fact(crash, "Fatal crashes")).toBeUndefined();
    expect(crash.source!.date).toBeNull();
    expect(packetText([crash])).toContain("Retrieved: Not recorded.");
  });

  it("formats the recorded estimate from its exact digits and lists a missing estimate as missing", () => {
    const cost = byKey(buildAtpEvidenceAppendices(completeAtpRecords(), ALL), "cost_estimate");
    // Intl puts a no-break space after the currency code.
    expect(fact(cost, "Planning-level estimate")).toMatch(/^USD\s2,850,000\.00$/);
    expect(fact(cost, "Price year")).toBe("2026");
    expect(cost.source).toMatchObject({ record: "Project record", date: "2026-11-02T16:05:00+00:00", dateLabel: "Estimate recorded" });
    expect(cost.notes[0]).toBe("Planning-level estimate recorded on the project, not an engineer's estimate.");

    const records = completeAtpRecords();
    records.project = { status: "ready", project: atpProject({ estimated_cost_amount: null, estimated_cost_currency: null, estimated_cost_basis_year: null }) };
    expect(byKey(buildAtpEvidenceAppendices(records, ALL), "cost_estimate")).toMatchObject({
      status: "missing",
      statusNote: "No planning-level estimate is recorded on the linked project.",
    });
  });

  it("keeps disadvantaged-community designations OpenPlan has no source for as not recorded, and decides no eligibility", () => {
    const equity = byKey(buildAtpEvidenceAppendices(completeAtpRecords(), ALL), "equity");
    expect(fact(equity, "Equity screening score (OpenPlan, not a CTC score)")).toBe(`Not recorded. ${EQUITY_WITHHELD}`);
    // The run had no Census inputs, so its stored zero tract counts are not findings.
    expect(fact(equity, "Tracts the ACS income and burden proxy flags")).toBe("Not recorded");
    expect(fact(equity, "Demographic source")).toBe("Not recorded in the analysis run");
    for (const label of ["SB 535 disadvantaged community", "AB 1550 low-income community", "Tribal area"]) {
      expect(fact(equity, label)).toBe("Not recorded");
    }
    expect(fact(equity, "ATP disadvantaged-community criteria")).toBe(
      `Not assessed. OpenPlan does not decide ATP eligibility; the CTC's guidelines set the criteria. ${ATP_VERIFY_GUIDELINES}`
    );
  });

  it("reports the proxy tract counts and Census source a run with Census inputs recorded", () => {
    const records = completeAtpRecords();
    records.run = { status: "ready", run: atpRun({ metrics: atpRunMetrics({
      dataQuality: { censusAvailable: true },
      disadvantagedTracts: 3,
      lowIncomeTracts: 5,
      sourceSnapshots: { census: { dataset: "ACS 5-Year", vintage: 2023, tractCount: 9, clipScale: "corridor" } },
    }) }) };
    const equity = byKey(buildAtpEvidenceAppendices(records, ALL), "equity");
    expect(fact(equity, "Tracts the ACS income and burden proxy flags")).toBe("3");
    expect(fact(equity, "Low-income tracts (ACS proxy)")).toBe("5");
    expect(fact(equity, "Demographic source")).toBe("ACS 5-Year 2023, 9 tracts, clipped to the corridor");
    expect(fact(equity, "SB 535 disadvantaged community")).toBe("Not recorded");
  });

  it("lists every appendix as missing when the application has no linked project", () => {
    const appendices = buildAtpEvidenceAppendices({
      projectId: null, project: { status: "no_project" }, run: { status: "no_project" }, crash: { status: "no_project" },
      bca: { status: "no_project" }, engagement: { status: "no_project" }, generatedAt: "2026-11-02T18:30:00.000Z", timeZone: "UTC",
    }, ALL);
    expect(appendices.map((a) => a.status)).toEqual(["missing", "missing", "missing", "missing", "missing", "missing"]);
    expect(packetText(appendices).match(/Missing\. This application is not linked to a project/g)).toHaveLength(6);
  });

  it("lists a missing acquisition, BCA and campaign as missing, and a deselected appendix as not selected", () => {
    const records = { ...completeAtpRecords(), crash: { status: "absent" as const }, bca: { status: "absent" as const }, engagement: { status: "absent" as const } };
    const appendices = buildAtpEvidenceAppendices(records, new Set(["crash_summary", "bca", "engagement", "equity"]));
    expect(appendices.map((a) => a.status)).toEqual(["omitted", "missing", "omitted", "missing", "included", "missing"]);
    const text = packetText(appendices);
    expect(text).toContain("Missing. No finished crash acquisition is saved for the linked project. That is a gap in what has been retrieved, not a finding that no crashes occurred.");
    expect(text).toContain("Not selected. Not selected for this export.");
    expect(byKey(appendices, "bca").statusNote).toBe("No benefit-cost analysis or screening is saved for the linked project.");
  });

  it("cites the BCA version and engagement campaign by their record ids", () => {
    const appendices = buildAtpEvidenceAppendices(completeAtpRecords(), ALL);
    expect(byKey(appendices, "bca").source).toMatchObject({ id: EVIDENCE_IDS.bcaVersion, hashLabel: "Input SHA-256" });
    expect(byKey(appendices, "engagement").source).toMatchObject({ id: EVIDENCE_IDS.campaign });
  });
});

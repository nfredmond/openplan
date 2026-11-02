import { describe, expect, it } from "vitest";
import { buildGrantApplicationHtml } from "@/lib/grants/application-html";
import { SS4A_APPENDIX_KEYS } from "@/lib/grants/ss4a-appendix-keys";
import {
  buildSs4aEvidenceAppendices,
  HIN_MAP_MISMATCH_REASON,
  type Ss4aAppendix,
  type Ss4aEvidenceRecords,
} from "@/lib/grants/ss4a-evidence-appendices";
import { htmlToPdfBlocks } from "@/lib/reports/pdf-text";
import { BCA_VERSION_ROW, completeEvidenceRecords, CRASH_ROWS, EVIDENCE_IDS, evidenceSnapshot, fixtureNetwork } from "./fixtures/grants/ss4a-evidence";

/**
 * The SS4A evidence appendices are public-record claims in a funder-facing
 * document. These tests read the render model and the TEXT the built-in PDF
 * tier extracts (which drops SVG), so every fact must survive as text.
 */

const ALL = new Set(SS4A_APPENDIX_KEYS);

function byKey(appendices: Ss4aAppendix[], key: Ss4aAppendix["key"]) {
  return appendices.find((appendix) => appendix.key === key)!;
}

function packetText(appendices: Ss4aAppendix[]): string {
  const html = buildGrantApplicationHtml({
    opportunity: { id: EVIDENCE_IDS.opportunity, title: "SS4A application", agency_name: null, summary: null, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
    programTitle: null, sections: [], attachments: [], generatedAt: "2026-11-01T00:00:00.000Z", evidenceAppendices: appendices,
  });
  return htmlToPdfBlocks(html).map((block) => ("text" in block ? block.text : JSON.stringify(block))).join("\n");
}

function factValue(appendix: Ss4aAppendix, label: string): string | undefined {
  return appendix.facts.find((fact) => fact.label === label)?.value;
}

describe("SS4A evidence appendices", () => {
  it("includes every appendix from linked Safety, BCA and engagement records, with source identity", () => {
    const records = completeEvidenceRecords();
    const appendices = buildSs4aEvidenceAppendices(records, ALL);
    expect(appendices.map((a) => [a.key, a.status])).toEqual(SS4A_APPENDIX_KEYS.map((key) => [key, "included"]));

    const snapshot = records.safety.status === "ready" ? records.safety.snapshot : null;
    const hin = byKey(appendices, "hin_map");
    expect(hin.figureSvg).toContain("<svg");
    expect(hin.figureSvg).toContain("Ranked high-injury network segments");
    // Both ranked segments are drawn over the context roads, numbered by rank.
    expect(hin.figureSvg!.match(/stroke="#b42318" stroke-width="5"/g)).toHaveLength(2);
    expect(hin.figureSvg).toContain('fill="#fff">2</text>');
    expect(hin.statusNote).toBeNull();
    expect(hin.source).toMatchObject({ id: EVIDENCE_IDS.artifact, hash: snapshot!.hash, date: snapshot!.generatedAt });
    expect(hin.table!.rows[0][1]).toBe(fixtureNetwork().segments[0].label);

    const countermeasures = byKey(appendices, "countermeasures");
    expect(countermeasures.table!.rows).toHaveLength(1);
    expect(countermeasures.notes[0]).toContain("not an engineering finding");

    const bca = byKey(appendices, "bca");
    expect(bca.source).toMatchObject({ id: EVIDENCE_IDS.bcaVersion, hashLabel: "Input SHA-256" });
    expect(bca.source!.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(bca.notes.join(" ")).toContain("Responsible analyst review and program acceptance are not established by this calculation.");

    const engagement = byKey(appendices, "engagement");
    expect(engagement.source).toMatchObject({ id: EVIDENCE_IDS.campaign });
    expect(engagement.notes.join(" ")).toContain("not a statistically representative survey");

    const text = packetText(appendices);
    for (const title of ["Appendix A. High-injury network map", "Appendix B. Crash summary", "Appendix C. Countermeasures", "Appendix D. Benefit-cost summary", "Appendix E. Engagement summary"]) {
      expect(text).toContain(title);
    }
    expect(text).toContain(snapshot!.hash);
    expect(text).toContain(bca.source!.hash!);
    expect(text).toContain("[VERIFY] Confirm the required attachments against the current SS4A notice");
  });

  it("labels FARS-only coverage as fatal crashes only and keeps serious injuries out of the counts", () => {
    const appendices = buildSs4aEvidenceAppendices(completeEvidenceRecords(), ALL);
    const crash = byKey(appendices, "crash_summary");
    expect(factValue(crash, "Severity coverage")).toMatch(/^Fatal crashes only\./);
    expect(factValue(crash, "Recorded severity coverage")).toBe("fatal_only");
    expect(factValue(crash, "Years requested")).toBe("2023, 2024");
    expect(byKey(appendices, "hin_map").table!.rows[0][4]).toBe("Not in source (fatal crashes only)");
    expect(packetText(appendices)).toContain("Fatal crashes only. The source records only crashes in which someone was killed");
  });

  it("keeps a count the acquisition does not carry as not recorded, never zero", () => {
    const records = completeEvidenceRecords();
    records.safety = { status: "ready", snapshot: evidenceSnapshot({ crash_count: null, stored_count: null, truncated: null, severity_completeness: null }), otherSeededArtifactCount: 0 };
    const crash = byKey(buildSs4aEvidenceAppendices(records, ALL), "crash_summary");
    expect(factValue(crash, "Crashes reported")).toBe("Not recorded");
    expect(factValue(crash, "Crashes stored")).toBe("Not recorded");
    expect(factValue(crash, "Retrieval truncated")).toBe("Not recorded");
    expect(factValue(crash, "Severity coverage")).toBe("Severity coverage is unknown.");
    expect(factValue(crash, "Crashes geocoded")).toBe("4");
  });

  it("explains a missing serious-injury count from the acquisition's coverage, matching the crash summary", () => {
    for (const [completeness, cell, coverage] of [
      ["fatal_only", "Not in source (fatal crashes only)", /^Fatal crashes only\./],
      ["fatal_injury_only", "Not separated in source (injury crashes not split by severity)", /^Fatal and injury crashes\. The source does not separate serious injuries/],
    ] as const) {
      const records = completeEvidenceRecords();
      records.safety = { status: "ready", snapshot: evidenceSnapshot({ severity_completeness: completeness }), otherSeededArtifactCount: 0 };
      const appendices = buildSs4aEvidenceAppendices(records, ALL);
      const hin = byKey(appendices, "hin_map");
      expect(hin.table!.rows.map((row) => row[4])).toEqual([cell, cell]);
      expect(factValue(hin, "Source severity coverage")).toMatch(coverage);
      expect(factValue(hin, "Source severity coverage")).toBe(factValue(byKey(appendices, "crash_summary"), "Severity coverage"));
    }
  });

  it("never prints a source file update as a publication cutoff", () => {
    const cases = [
      { provenance: { basis: "resource_updates", resources: [{ year: 2024, lastModified: "2025-06-01" }] }, cutoff: false },
      { provenance: { label: "Last-Modified header" }, cutoff: false },
      { provenance: { basis: "source_metadata", label: "Dataset metadata" }, cutoff: true },
    ];
    for (const { provenance, cutoff } of cases) {
      const records = completeEvidenceRecords();
      records.safety = { status: "ready", snapshot: evidenceSnapshot({ published_through: "2025-06-01", published_through_provenance: provenance }), otherSeededArtifactCount: 0 };
      const crash = byKey(buildSs4aEvidenceAppendices(records, ALL), "crash_summary");
      const value = factValue(crash, "Source publication cutoff")!;
      if (cutoff) {
        expect(value).toBe("2025-06-01");
      } else {
        expect(value).not.toBe("2025-06-01");
        expect(value).toContain("A file update is not a crash-coverage cutoff.");
        // The appendix line agrees with the frozen caveat the snapshot carries.
        expect(crash.notes).toContain(value);
      }
    }
  });

  it("lists missing evidence as missing instead of omitting it", () => {
    const records: Ss4aEvidenceRecords = {
      ...completeEvidenceRecords(),
      safety: { status: "absent" },
      hinRecompute: { status: "not_attempted" },
      bca: { status: "absent" },
      engagement: { status: "unreadable", reason: "Engagement campaigns could not be read." },
    };
    const appendices = buildSs4aEvidenceAppendices(records, ALL);
    expect(appendices.map((a) => a.status)).toEqual(["missing", "missing", "missing", "missing", "unreadable"]);
    expect(byKey(appendices, "crash_summary").statusNote).toContain("No saved Safety plan has been seeded");
    expect(byKey(appendices, "bca").statusNote).toContain("No benefit-cost analysis or screening is saved");
    const text = packetText(appendices);
    expect(text.match(/Appendix [A-E]\./g)).toHaveLength(5);
    expect(text).toContain("Missing. No benefit-cost analysis or screening is saved");
    expect(text).toContain("Could not be read. Engagement campaigns could not be read.");
  });

  it("lists a deselected appendix as not selected and draws nothing for it", () => {
    const appendices = buildSs4aEvidenceAppendices(completeEvidenceRecords(), new Set(["crash_summary", "bca"] as const));
    expect(appendices.map((a) => a.status)).toEqual(["omitted", "included", "omitted", "included", "omitted"]);
    expect(byKey(appendices, "hin_map").figureSvg).toBeNull();
    expect(packetText(appendices)).toContain("Not selected. Not selected for this export.");
  });

  it("draws no map when the export-time recomputation does not reproduce the frozen ranking", () => {
    const records = completeEvidenceRecords();
    // One fewer crash on the top road: same segments, different counts.
    records.hinRecompute = { status: "computed", network: fixtureNetwork(CRASH_ROWS.slice(1)), roads: [] };
    const hin = byKey(buildSs4aEvidenceAppendices(records, ALL), "hin_map");
    expect(hin.status).toBe("included");
    expect(hin.figureSvg).toBeNull();
    expect(hin.statusNote).toBe(`Map not drawn. ${HIN_MAP_MISMATCH_REASON}`);
    expect(hin.table!.rows.length).toBeGreaterThan(0);
  });

  it("refuses a BCA version that belongs to another project", () => {
    const records = completeEvidenceRecords();
    records.bca = { status: "workbench", row: { ...BCA_VERSION_ROW(), document_json: { ...BCA_VERSION_ROW().document_json, projectId: EVIDENCE_IDS.workspace } } };
    expect(byKey(buildSs4aEvidenceAppendices(records, ALL), "bca").status).toBe("unreadable");
  });
});

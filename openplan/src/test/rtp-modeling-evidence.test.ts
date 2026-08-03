import { describe, expect, it } from "vitest";
import { formatRtpModelingEvidenceLine, summarizeRtpModelingEvidence } from "@/lib/rtp/modeling-evidence";

describe("summarizeRtpModelingEvidence", () => {
  it("reads VMT/GHG KPIs for the run and ignores other runs", () => {
    const rows = [
      { run_id: "run-1", kpi_name: "resident_vmt_per_capita", value: 24.5 },
      { run_id: "run-1", kpi_name: "co2e_metric_tons_year", value: 120000 },
      { run_id: "run-2", kpi_name: "resident_vmt_per_capita", value: 99 },
    ];
    const evidence = summarizeRtpModelingEvidence("run-1", "Grass Valley screening", rows);
    expect(evidence.residentVmtPerCapita).toBe(24.5);
    expect(evidence.ghgTonsPerYear).toBe(120000);
    expect(evidence.hasVmt).toBe(true);
    expect(evidence.hasGhg).toBe(true);
    expect(evidence.runTitle).toBe("Grass Valley screening");
  });

  it("flags missing KPIs", () => {
    const evidence = summarizeRtpModelingEvidence("run-x", null, []);
    expect(evidence.hasVmt).toBe(false);
    expect(evidence.hasGhg).toBe(false);
    expect(evidence.residentVmtPerCapita).toBeNull();
    expect(evidence.kpiReadFailed).toBe(false);
  });

  it("ignores geometry-scoped KPI slices — a corridor's VMT is not the run's VMT", () => {
    const rows = [
      // Only a geometry-scoped slice exists: it must not become run evidence.
      { run_id: "run-1", kpi_name: "resident_vmt_per_capita", value: 99.9, geometry_ref: "corridor-1" },
      // A run-level row alongside a slice: the run-level value must win
      // regardless of row order.
      { run_id: "run-2", kpi_name: "vmt_per_capita", value: 88.8, geometry_ref: "corridor-2" },
      { run_id: "run-2", kpi_name: "vmt_per_capita", value: 24.5, geometry_ref: null },
    ];
    const sliceOnly = summarizeRtpModelingEvidence("run-1", null, rows);
    expect(sliceOnly.hasVmt).toBe(false);
    expect(sliceOnly.residentVmtPerCapita).toBeNull();

    const mixed = summarizeRtpModelingEvidence("run-2", null, rows);
    expect(mixed.vmtPerCapita).toBe(24.5);
  });

  it("carries a failed KPI read as its own state, never as absence", () => {
    const evidence = summarizeRtpModelingEvidence("run-x", null, [], { kpiReadFailed: true });
    expect(evidence.kpiReadFailed).toBe(true);
    expect(evidence.hasVmt).toBe(false);
    const line = formatRtpModelingEvidenceLine(evidence);
    expect(line).toMatch(/could not be read/);
    expect(line).not.toMatch(/No VMT\/GHG KPIs/);
  });
});

describe("formatRtpModelingEvidenceLine", () => {
  it("formats a screening-grade one-liner", () => {
    const line = formatRtpModelingEvidenceLine(
      summarizeRtpModelingEvidence("r", "R", [
        { run_id: "r", kpi_name: "resident_vmt_per_capita", value: 24.5 },
        { run_id: "r", kpi_name: "co2e_metric_tons_year", value: 120000 },
      ]),
    );
    expect(line).toContain("resident VMT/capita 24.5");
    expect(line).toContain("GHG 120,000");
    expect(line).toContain("screening-grade");
  });

  it("says no KPIs when empty", () => {
    expect(formatRtpModelingEvidenceLine(summarizeRtpModelingEvidence("r", "R", []))).toMatch(/No VMT\/GHG KPIs/);
  });
});

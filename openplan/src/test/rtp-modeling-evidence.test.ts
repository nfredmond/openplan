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

import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StructuralDiagnosisExplanation } from "@/components/models/structural-diagnosis-explanation";

const REPOSITORY = path.resolve(process.cwd(), "..");
const DIRECTORY = path.join(REPOSITORY, "data/modeling/model-validation-structural-diagnosis-2026-08-28");
const study = JSON.parse(readFileSync(`${DIRECTORY}/study-result.json`, "utf8"));
const selected = study.counties[0].methods.aequilibrae;
const frozen = JSON.parse(readFileSync(path.join(REPOSITORY, selected.diagnosis_path), "utf8"));

describe("shared structural diagnosis explanation", () => {
  it("shows separate recorded categories, zero counts, nested unknown facts and exact custody from a frozen file", () => {
    const before = JSON.stringify(frozen);
    render(<StructuralDiagnosisExplanation diagnosis={frozen} sha256={selected.diagnosis_sha256} downloadHref="/exact-frozen-diagnosis.json" />);
    const explanation = screen.getByRole("region", { name: "Why this model validation is inconclusive" });
    for (const name of ["Observation coverage", "Observation matching", "Network loading", "Comparison basis", "Method disagreement"]) {
      expect(within(explanation).getByRole("heading", { name })).toBeVisible();
    }
    for (const finding of frozen.findings) {
      expect(explanation).toHaveTextContent(`${finding.count.toLocaleString()} · ${finding.statement}`);
    }
    const matching = within(explanation).getByRole("heading", { name: "Observation matching" }).parentElement!;
    expect(within(matching).getAllByRole("listitem")).toHaveLength(frozen.findings.filter((finding: { category: string }) => finding.category === "matching").length);
    expect(explanation).toHaveTextContent("0 · No frozen network link geometry lies within the search distance");
    expect(explanation).toHaveTextContent("model_year");
    expect(explanation).toHaveTextContent("day_basis");
    expect(explanation).toHaveTextContent("population_vintage");
    expect(explanation).toHaveTextContent("coefficients");
    expect(explanation).toHaveTextContent("without averaging or selecting a method");
    expect(screen.getByTestId("diagnosis-sha256")).toHaveTextContent(selected.diagnosis_sha256);
    expect(screen.getByRole("link", { name: "Download exact structural diagnosis" })).toHaveAttribute("download");
    expect(screen.getByRole("link", { name: "Download exact structural diagnosis" })).toHaveAttribute("href", "/exact-frozen-diagnosis.json");
    const ledger = screen.getByText("Recorded comparison-basis facts").closest("details")!;
    ledger.open = true;
    expect(within(ledger).getByText("model year").nextElementSibling).toHaveTextContent("Status: unknown · Value: unknown");
    expect(within(ledger).getByText("direction").nextElementSibling).toHaveTextContent('"basis":"two_way"');
    expect(within(ledger).getByText("vehicle pce basis").nextElementSibling).toHaveTextContent('"unit":"pce"');
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it("keeps legacy root unknown facts and missing counts distinct from recorded zeros", () => {
    render(<StructuralDiagnosisExplanation diagnosis={{ unknown_facts: ["model_year", "day_basis"], findings: [{ category: "matching", statement: "No measured count was supplied." }] }} sha256={null} downloadHref="/legacy.json" />);
    expect(screen.getByText(/Evidence ledger still unknown/)).toHaveTextContent("model_year, day_basis");
    expect(screen.getByText(/Count unavailable/)).toHaveTextContent("Count unavailable · No measured count was supplied.");
    expect(screen.getByText(/Detailed comparison facts were not supplied here/)).toBeVisible();
    expect(screen.getByTestId("diagnosis-sha256")).toHaveTextContent("SHA-256 unknown");
  });

  it("does not treat absent or invalid findings and conflicting evidence as measured zeros or proof", () => {
    render(<StructuralDiagnosisExplanation diagnosis={{ findings: [null, { count: 0 }], evidence_ledger: { model_year: { status: "conflicting", value: "unknown" } } }} sha256={null} downloadHref="/unknown.json" />);
    expect(screen.getByText(/No finding statements were recorded here/)).toHaveTextContent("missing findings are not zero findings");
    expect(screen.getByText(/Evidence ledger still unknown/)).toHaveTextContent("model_year");
    const ledger = screen.getByText("Recorded comparison-basis facts").closest("details")!;
    ledger.open = true;
    expect(within(ledger).getByText("model year").nextElementSibling).toHaveTextContent("Status: conflicting · Value: unknown");
  });

  it("keeps unknown facts carried only by a comparison finding", () => {
    render(<StructuralDiagnosisExplanation diagnosis={{ findings: [{ category: "comparability", count: null, statement: "Basis facts were not established.", unknown_facts: ["population_vintage"] }] }} sha256={null} downloadHref="/nested.json" />);
    expect(screen.getByText(/Evidence ledger still unknown/)).toHaveTextContent("population_vintage");
  });
});

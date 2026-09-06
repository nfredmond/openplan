import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes } from "react";

vi.mock("next/link", () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} data-page-navigation />,
}));

import { PublishedStructuralDiagnosisCard } from "@/components/models/published-structural-diagnosis-card";
import { loadPublishedStructuralDiagnosisStudy, readPublishedStructuralDiagnosisDownload } from "@/lib/models/published-structural-diagnosis";

describe("published structural diagnosis Models card", () => {
  it("selects each real frozen explanation with its own exact hash, findings, and download", async () => {
    const study = await loadPublishedStructuralDiagnosisStudy();
    render(<PublishedStructuralDiagnosisCard study={study} />);
    fireEvent.click(screen.getByText("Why this is inconclusive", { selector: "summary" }));
    const selector = screen.getByRole("combobox", { name: "Frozen county and method" });
    expect(within(selector).getAllByRole("option")).toHaveLength(study.records.length);
    for (const record of study.records) {
      fireEvent.change(selector, { target: { value: `${record.geographyId}-${record.method}` } });
      const explanation = screen.getByRole("region", { name: `Frozen diagnosis ${record.geographyId} ${record.method}` });
      expect(explanation).toBeVisible();
      expect(screen.getByText(/not a diagnosis of a current workspace run/)).toHaveTextContent(`${record.geographyId} · ${record.method}`);
      expect(within(explanation).getByTestId("diagnosis-sha256")).toHaveTextContent(record.diagnosisSha256);
      const findings = record.diagnosis.findings as { count: number; statement: string }[];
      for (const finding of findings) expect(explanation).toHaveTextContent(`${finding.count.toLocaleString()} · ${finding.statement}`);
      expect(within(explanation).getByRole("link", { name: "Download exact structural diagnosis" })).toHaveAttribute("href", `/api/models/validation-structural-diagnosis/${record.geographyId}/${record.method}/structural-diagnosis.json`);
      const download = await readPublishedStructuralDiagnosisDownload([record.geographyId, record.method, "structural-diagnosis.json"]);
      expect(download?.sha256).toBe(record.diagnosisSha256);
      expect(download?.filename).toBe(`${record.geographyId}-${record.method}-structural-diagnosis.json`);
    }
  });

  it("shows the unchanged outcome, boundaries, hashes, and exact downloads", () => {
    render(<PublishedStructuralDiagnosisCard study={{
      appVersion: "0.40.0",
      createdAt: "2026-08-28T18:45:00Z",
      gitSha: "a".repeat(40),
      scientificOutcome: "inconclusive",
      records: [
        {
          geographyId: "06007",
          method: "aequilibrae",
          diagnosisPath: "data/example.json",
          diagnosisSha256: "b".repeat(64),
          diagnosis: { findings: [], unknown_facts: ["model_year"] },
          findingCounts: {
            missing_usable_point_coordinates: 56,
            frozen_matched_links_with_zero_assigned_volume: 4,
          },
        },
        {
          geographyId: "06007",
          method: "activitysim",
          diagnosisPath: "data/example-2.json",
          diagnosisSha256: "c".repeat(64),
          diagnosis: { findings: [], unknown_facts: ["model_year"] },
          findingCounts: {
            missing_usable_point_coordinates: 56,
            frozen_matched_links_with_zero_assigned_volume: 4,
          },
        },
      ],
    }} />);
    const card = screen.getByRole("region", { name: "Frozen structural diagnosis" });
    expect(card).toHaveTextContent("Why all fourteen assessments are inconclusive");
    expect(card).toHaveTextContent("does not calibrate a model, average methods");
    expect(card).toHaveTextContent("Model year, day represented, coefficients, and population vintage remain unknown");
    expect(card).toHaveTextContent("b".repeat(64));
    expect(screen.getByRole("link", { name: "Download exact study result" })).toHaveAttribute(
      "href",
      "/api/models/validation-structural-diagnosis/study-result.json",
    );
    expect(card.querySelector("div.sm\\:grid-cols-2")).toHaveClass("grid-cols-1", "lg:grid-cols-3");
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("download");
      expect(link).not.toHaveAttribute("data-page-navigation");
    }
  });
});

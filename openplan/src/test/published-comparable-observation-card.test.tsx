import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes } from "react";

vi.mock("next/link", () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} data-page-navigation />,
}));

import { PublishedComparableObservationCard } from "@/components/models/published-comparable-observation-card";

describe("PublishedComparableObservationCard", () => {
  it("states the repaired-instrument boundary and exposes exact downloads", () => {
    render(<PublishedComparableObservationCard study={{
      version: "0.41.0",
      releaseSha: "a".repeat(40),
      createdAt: "2026-08-28T12:00:00Z",
      scientificOutcome: "inconclusive",
      diagnoses: ["aequilibrae", "activitysim"].map((method) => ({
        geographyId: "06007",
        method: method as "aequilibrae" | "activitysim",
        path: `data/${method}.json`,
        sha256: "b".repeat(64),
        coverage: { matched: 4, ambiguous: 8 },
        bindings: {
          observation_package_sha256: "c".repeat(64),
          match_audit_sha256: "d".repeat(64),
          input_bundle_sha256: (method === "aequilibrae" ? "e" : "1").repeat(64),
          comparison_basis_sha256: (method === "aequilibrae" ? "f" : "2").repeat(64),
          assessment_sha256: (method === "aequilibrae" ? "0" : "3").repeat(64),
        },
      })),
    }} />);
    expect(screen.getByText(/not improved model accuracy/i)).toBeInTheDocument();
    expect(screen.getByText(/synthetic expanded daily traffic, not AADT/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "observations" })).toHaveAttribute("href", expect.stringContaining("observation-package-v2.json"));
    expect(screen.getAllByRole("link", { name: /assessment/ })).toHaveLength(2);
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("download");
      expect(link).not.toHaveAttribute("data-page-navigation");
    }
    const expected = [
      ["observations", "observation-package-v2.json", "c"],
      ["match audit", "pre-volume-match-audit-v2.json", "d"],
      ["aequilibrae input bundle", "06007-aequilibrae-validation-input-bundle-v2.json", "e"],
      ["activitysim input bundle", "06007-activitysim-validation-input-bundle-v2.json", "1"],
      ["aequilibrae basis", "06007-aequilibrae-comparison-basis-v2.json", "f"],
      ["activitysim basis", "06007-activitysim-comparison-basis-v2.json", "2"],
      ["aequilibrae assessment", "06007-aequilibrae-assessment-v2.json", "0"],
      ["activitysim assessment", "06007-activitysim-assessment-v2.json", "3"],
      ["aequilibrae diagnosis", "06007-aequilibrae-structural-diagnosis-v2.json", "b"],
      ["activitysim diagnosis", "06007-activitysim-structural-diagnosis-v2.json", "b"],
    ];
    for (const [label, filename, digit] of expected) {
      const item = screen.getByRole("link", { name: label }).parentElement;
      expect(item).toHaveTextContent(filename);
      expect(item).toHaveTextContent(`SHA-256 ${digit.repeat(64)}`);
      expect(item?.querySelectorAll("p.break-all")).toHaveLength(2);
    }
  });

  it("keeps unavailable custody explicit and derives geography and method from each record", () => {
    render(<PublishedComparableObservationCard study={{
      version: "0.41.0", releaseSha: "a".repeat(40), createdAt: "unknown", scientificOutcome: "inconclusive",
      diagnoses: [{ geographyId: "41003", method: "activitysim", path: "data/fixture.json", sha256: "b".repeat(64), coverage: {}, bindings: {} }],
    }} />);
    expect(screen.getAllByText("SHA-256 unavailable")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "activitysim input bundle" })).toHaveAttribute("href", "/api/models/comparable-observation-study/41003/activitysim/validation-input-bundle-v2.json");
    expect(screen.queryByRole("link", { name: "aequilibrae input bundle" })).not.toBeInTheDocument();
  });
});

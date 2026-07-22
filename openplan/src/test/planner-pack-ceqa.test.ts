import { describe, expect, it } from "vitest";

import {
  CEQA_PROJECT_TYPES,
  CEQA_REFERENCE_LABELS,
  DEFAULT_REFERENCE_VMT_PER_CAPITA,
  OPR_DEFAULT_THRESHOLD_PCT,
  ceqaVmtFactBlocks,
  computeCeqaVmt,
} from "@/lib/planner-pack/ceqa";
import { renderCeqaVmtMarkdown } from "@/lib/planner-pack/render";
import { InsufficientDataError } from "@/lib/planner-pack/types";
import { formatFixedPython, formatPythonFloat, pythonRound } from "@/lib/planner-pack/utilities";

// Ported from clawmodeler tests/test_ceqa_vmt.py (ComputeCeqaVmtTest +
// CeqaFactBlocksTest). The filesystem-oriented WriteCeqaVmtTest cases have no
// equivalent here (OpenPlan does not port the workspace/run directory layer);
// their report-content assertions are covered by the renderer tests below.

describe("computeCeqaVmt", () => {
  it("splits significant and below-threshold scenarios", () => {
    const result = computeCeqaVmt(
      [
        { scenario_id: "hi", population: 100, daily_vmt: 2500 },
        { scenario_id: "lo", population: 100, daily_vmt: 1500 },
      ],
      { referenceVmtPerCapita: 22.0, thresholdPct: 0.15 }
    );

    expect(result.threshold_pct).toBe(0.15);
    expect(result.threshold_vmt_per_capita).toBeCloseTo(22.0 * 0.85, 3);

    const byId = new Map(result.scenarios.map((scenario) => [scenario.scenario_id, scenario]));
    const hi = byId.get("hi");
    const lo = byId.get("lo");
    expect(hi?.significant).toBe(true);
    expect(hi?.determination).toBe("potentially significant");
    expect(hi?.mitigation_required).toBe(true);
    expect(hi?.vmt_per_capita).toBeCloseTo(25.0, 3);
    expect(lo?.significant).toBe(false);
    expect(lo?.determination).toBe("less than significant");
    expect(lo?.mitigation_required).toBe(false);
    expect(lo?.vmt_per_capita).toBeCloseTo(15.0, 3);
  });

  it("treats a scenario exactly at the threshold as significant", () => {
    const result = computeCeqaVmt([{ scenario_id: "edge", population: 100, daily_vmt: 1870.0 }], {
      referenceVmtPerCapita: 22.0,
    });
    expect(result.scenarios[0].significant).toBe(true);
  });

  it("skips zero-population scenarios", () => {
    const result = computeCeqaVmt(
      [
        { scenario_id: "empty", population: 0, daily_vmt: 100 },
        { scenario_id: "ok", population: 50, daily_vmt: 500 },
      ],
      { referenceVmtPerCapita: 22.0 }
    );
    expect(result.scenarios.map((scenario) => scenario.scenario_id)).toEqual(["ok"]);
  });

  it("raises InsufficientDataError on empty rows", () => {
    expect(() => computeCeqaVmt([], { referenceVmtPerCapita: 22.0 })).toThrow(
      InsufficientDataError
    );
    expect(() => computeCeqaVmt([], { referenceVmtPerCapita: 22.0 })).toThrow(
      "vmt_screening rows are empty; run a workflow before computing CEQA VMT."
    );
  });

  it("rejects an unknown project_type", () => {
    expect(() =>
      computeCeqaVmt([{ scenario_id: "a", population: 10, daily_vmt: 10 }], {
        referenceVmtPerCapita: 22.0,
        // @ts-expect-error deliberately invalid to mirror the Python ValueError case
        projectType: "industrial",
      })
    ).toThrow(/Unknown project_type/);
  });

  it("rejects an unknown reference_label", () => {
    expect(() =>
      computeCeqaVmt([{ scenario_id: "a", population: 10, daily_vmt: 10 }], {
        referenceVmtPerCapita: 22.0,
        // @ts-expect-error deliberately invalid to mirror the Python ValueError case
        referenceLabel: "global",
      })
    ).toThrow(/Unknown reference_label/);
  });

  it("rejects a threshold_pct outside (0, 1)", () => {
    expect(() =>
      computeCeqaVmt([{ scenario_id: "a", population: 10, daily_vmt: 10 }], {
        referenceVmtPerCapita: 22.0,
        thresholdPct: 1.5,
      })
    ).toThrow(/threshold_pct must be a fraction between 0 and 1/);
  });

  it("rejects a non-positive reference", () => {
    expect(() =>
      computeCeqaVmt([{ scenario_id: "a", population: 10, daily_vmt: 10 }], {
        referenceVmtPerCapita: -1.0,
      })
    ).toThrow(/reference_vmt_per_capita must be > 0/);
  });

  it("defaults the threshold to the OPR 15 percent recommendation", () => {
    expect(OPR_DEFAULT_THRESHOLD_PCT).toBeCloseTo(0.15);
    expect(DEFAULT_REFERENCE_VMT_PER_CAPITA).toBe(22.0);
    expect(CEQA_PROJECT_TYPES).toEqual(["residential", "employment", "retail"]);
    expect(CEQA_REFERENCE_LABELS).toEqual(["regional", "citywide", "custom"]);
  });

  // JS-specific: CSV cells arrive as strings; coercion must match Python float().
  it("coerces string CSV cells like the Python csv.DictReader path", () => {
    const result = computeCeqaVmt(
      [{ scenario_id: " s1 ", population: "100", daily_vmt: "2500" }],
      { referenceVmtPerCapita: 22.0 }
    );
    expect(result.scenarios[0].scenario_id).toBe("s1");
    expect(result.scenarios[0].vmt_per_capita).toBeCloseTo(25.0, 3);
    expect(() =>
      computeCeqaVmt([{ scenario_id: "bad", population: "not-a-number", daily_vmt: "1" }], {
        referenceVmtPerCapita: 22.0,
      })
    ).toThrow(/Non-numeric population/);
  });

  // JS-specific: a boundary value just below the cut line stays less than significant.
  it("keeps a scenario just below the threshold less than significant", () => {
    const result = computeCeqaVmt(
      [{ scenario_id: "just-below", population: 100, daily_vmt: 1869.9 }],
      { referenceVmtPerCapita: 22.0 }
    );
    expect(result.scenarios[0].significant).toBe(false);
    expect(result.scenarios[0].determination).toBe("less than significant");
  });

  it("honors a generatedAt override", () => {
    const result = computeCeqaVmt([{ scenario_id: "a", population: 10, daily_vmt: 100 }], {
      referenceVmtPerCapita: 22.0,
      generatedAt: "2026-07-17T00:00:00Z",
    });
    expect(result.generated_at).toBe("2026-07-17T00:00:00Z");
  });
});

describe("ceqaVmtFactBlocks", () => {
  it("produces one grounded block per scenario with the statutory claim text", () => {
    const result = computeCeqaVmt(
      [
        { scenario_id: "hi", population: 100, daily_vmt: 2500 },
        { scenario_id: "lo", population: 100, daily_vmt: 1500 },
      ],
      { referenceVmtPerCapita: 22.0 }
    );
    const blocks = ceqaVmtFactBlocks(result, "/tmp/ceqa_vmt.csv");

    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block.fact_type).toBe("ceqa_vmt_determination");
      expect(block.fact_id.startsWith("ceqa-vmt-")).toBe(true);
      expect(block.claim_text).toContain("CEQA §15064.3");
      expect(block.source_table).toBe("/tmp/ceqa_vmt.csv");
      expect(block.method_ref).toBe("planner_pack.ceqa_vmt");
      expect(block.artifact_refs).toEqual([{ path: "/tmp/ceqa_vmt.csv", type: "table" }]);
      expect(block.source_row).toBe("residential.regional");
    }

    // Exact claim strings verified byte-identical against the Python
    // ceqa_vmt_fact_blocks output for the same inputs.
    const byScenario = new Map(blocks.map((block) => [block.scenario_id, block]));
    expect(byScenario.get("hi")?.claim_text).toBe(
      "Under CEQA §15064.3, scenario hi VMT per capita is 25.0 — potentially significant, 33.7% above the 15%-below-regional threshold of 18.7 VMT/capita."
    );
    expect(byScenario.get("lo")?.claim_text).toBe(
      "Under CEQA §15064.3, scenario lo VMT per capita is 15.0 — less than significant, 19.8% below the 15%-below-regional threshold of 18.7 VMT/capita."
    );
  });
});

describe("renderCeqaVmtMarkdown", () => {
  const options = { runId: "run-1", engineVersion: "1.0.0" };

  it("renders the memo with statutory citations and both findings sections", () => {
    const result = computeCeqaVmt(
      [
        { scenario_id: "hi", population: 100, daily_vmt: 2500 },
        { scenario_id: "lo", population: 100, daily_vmt: 1500 },
      ],
      { referenceVmtPerCapita: 22.0, generatedAt: "2026-07-17T00:00:00Z" }
    );
    const markdown = renderCeqaVmtMarkdown(result, options);

    expect(markdown).toContain("# CEQA §15064.3 VMT Significance Determination — run `run-1`");
    expect(markdown).toContain("- Project type: **residential**");
    expect(markdown).toContain("- Reference baseline: **regional** — 22.0 VMT per capita");
    expect(markdown).toContain(
      "- Screening threshold: **15% below regional** → 18.7 VMT per capita"
    );
    expect(markdown).toContain("California Public Resources");
    expect(markdown).toContain("- California Public Resources Code §21099.");
    expect(markdown).toContain("- CEQA Guidelines §15064.3 (14 CCR §15064.3).");
    expect(markdown).toContain(
      "Governor's Office of Planning and Research, *Technical Advisory on Evaluating Transportation Impacts in CEQA*, December 2018."
    );
    expect(markdown).toContain(
      "| `hi` | 100.0 | 2500.0 | 25.0 | 18.7 | 33.7% | **potentially significant** |"
    );
    expect(markdown).toContain(
      "| `lo` | 100.0 | 1500.0 | 15.0 | 18.7 | -19.8% | **less than significant** |"
    );
    expect(markdown).toContain(
      "- `hi`: 25.0 VMT per capita — 33.7% above the 18.7 VMT per capita threshold. Mitigation required."
    );
    expect(markdown).toContain(
      "- `lo`: 15.0 VMT per capita — -19.8% versus the 18.7 VMT per capita threshold."
    );
  });

  it("byte-identically omits calibrated disclosure by default (screening basis)", () => {
    const result = computeCeqaVmt([{ scenario_id: "a", population: 10, daily_vmt: 100 }], {
      referenceVmtPerCapita: 22.0,
    });
    expect(renderCeqaVmtMarkdown(result, options)).toEqual(
      renderCeqaVmtMarkdown(result, { ...options, calibratedBasis: false })
    );
    expect(renderCeqaVmtMarkdown(result, options)).not.toContain("CALIBRATED-INPUT BASIS");
  });

  it("discloses the calibrated basis in the exported memo when calibratedBasis is set", () => {
    const result = computeCeqaVmt([{ scenario_id: "a", population: 10, daily_vmt: 100 }], {
      referenceVmtPerCapita: 22.0,
    });
    const markdown = renderCeqaVmtMarkdown(result, { ...options, calibratedBasis: true });
    // The title and body must make the calibrated basis unmistakable in the artifact of record.
    expect(markdown).toContain("# CEQA §15064.3 VMT Significance Determination (CALIBRATED-INPUT BASIS) — run `run-1`");
    expect(markdown).toContain("Determination basis: CALIBRATED (count-tuned) VMT");
    expect(markdown).toContain("Do not present this memo as a screening-basis determination.");
  });

  it("preserves the screening-level caveat language verbatim", () => {
    const result = computeCeqaVmt([{ scenario_id: "a", population: 10, daily_vmt: 100 }], {
      referenceVmtPerCapita: 22.0,
    });
    const markdown = renderCeqaVmtMarkdown(result, options);

    expect(markdown).toContain("Determinations in this memo are *screening-level*.");
    expect(markdown).toContain(
      "A lead agency may adopt a\n  different threshold or a custom methodology with substantial evidence."
    );
    expect(markdown).toContain(
      "Determinations are arithmetic and reproducible; no model is\nconsulted."
    );
    expect(markdown).toContain("remain subject to the OpenPlan citation contract");
  });

  it("renders the all-clear finding when nothing exceeds the threshold", () => {
    const result = computeCeqaVmt([{ scenario_id: "lo", population: 100, daily_vmt: 1500 }], {
      referenceVmtPerCapita: 22.0,
    });
    const markdown = renderCeqaVmtMarkdown(result, options);
    expect(markdown).toContain(
      "No scenarios in this run exceed the CEQA §15064.3 screening threshold."
    );
    expect(markdown).not.toContain("Mitigation required.");
  });

  it("renders the empty-scenarios placeholder when every row was skipped", () => {
    const result = computeCeqaVmt([{ scenario_id: "empty", population: 0, daily_vmt: 100 }], {
      referenceVmtPerCapita: 22.0,
    });
    const markdown = renderCeqaVmtMarkdown(result, options);
    expect(markdown).toContain("_No scenarios were available for CEQA screening._");
  });
});

// JS-specific: the Python-parity helpers that keep determinations and
// rendered numbers byte-comparable with the CPython originals.
describe("python parity helpers", () => {
  it("pythonRound rounds exact ties half-to-even like CPython", () => {
    expect(pythonRound(0.125, 2)).toBe(0.12);
    expect(pythonRound(0.135, 2)).toBe(0.14);
    expect(pythonRound(18.25, 1)).toBe(18.2);
    expect(pythonRound(-1.5, 0)).toBe(-2);
    expect(pythonRound(2.5, 0)).toBe(2);
  });

  it("formatFixedPython matches Python fixed-point formatting", () => {
    expect(formatFixedPython(25, 1)).toBe("25.0");
    expect(formatFixedPython(0.15 * 100, 0)).toBe("15");
    expect(formatFixedPython(18.25, 1)).toBe("18.2");
  });

  it("formatPythonFloat keeps the trailing .0 of Python float repr", () => {
    expect(formatPythonFloat(22)).toBe("22.0");
    expect(formatPythonFloat(18.7)).toBe("18.7");
    expect(formatPythonFloat(-19.8)).toBe("-19.8");
  });
});

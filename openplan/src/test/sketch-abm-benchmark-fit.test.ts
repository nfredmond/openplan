import { describe, expect, it } from "vitest";
import {
  DEFAULT_SKETCH_REFERENCE_BENCHMARKS,
  SKETCH_BENCHMARK_MODES,
  benchmarkFitRecommendation,
  computeBenchmarkFit,
  type SketchModeSplitPct,
} from "@/lib/models/sketch-abm/benchmark-fit";
import { DEFAULT_REFERENCE_VMT_PER_CAPITA } from "@/lib/planner-pack/ceqa";

const REFERENCE = DEFAULT_SKETCH_REFERENCE_BENCHMARKS;

function fit(vmtPerCapita: number, modeSplitPct: SketchModeSplitPct, reference = REFERENCE) {
  return computeBenchmarkFit({
    modeled: { vmt_per_capita: vmtPerCapita, mode_split_pct: modeSplitPct },
    reference,
  });
}

describe("computeBenchmarkFit", () => {
  it("scores a run that matches the reference benchmarks exactly at 100", () => {
    const result = fit(REFERENCE.vmt_per_capita, { ...REFERENCE.mode_split_pct });

    expect(result.vmt_percent_error).toBe(0);
    expect(result.mode_split_rmse).toBe(0);
    expect(result.components.vmt_score).toBe(100);
    expect(result.components.mode_split_score).toBe(100);
    expect(result.fit_score_0_100).toBe(100);
    expect(result.grade).toBe("sketch_screening");
    expect(result.recommendation).toBe("Close to reference benchmarks");
  });

  it("pins the exact score for the upstream-shaped example (vmt 25 vs 20, five-mode split)", () => {
    // Hand computation:
    //   vmt_percent_error = (25 − 20) / 20 × 100 = 25 → vmt_score = 100 − 50 = 50
    //   share errors (pct-pts): +10, −5, −2, −2, −1
    //   squares: 100 + 25 + 4 + 4 + 1 = 134 → mean 26.8 → rmse = sqrt(26.8)
    //   mode_split_score = 100 − sqrt(26.8) × 10 ≈ 48.2312835778…
    //   fit = (50 + 48.2312835778…) / 2 ≈ 49.1156417889…
    const result = fit(
      25,
      { auto: 80, transit: 5, walk: 10, bike: 3, shared: 2 },
      {
        vmt_per_capita: 20,
        mode_split_pct: { auto: 70, transit: 10, walk: 12, bike: 5, shared: 3 },
        sources: ["reference benchmark fixture"],
      }
    );

    expect(result.vmt_percent_error).toBe(25);
    expect(result.components.vmt_score).toBe(50);
    expect(result.mode_split_rmse).toBe(Math.sqrt(26.8));
    expect(result.mode_split_rmse).toBeCloseTo(5.176871642217914, 12);
    expect(result.components.mode_split_score).toBeCloseTo(48.23128357782086, 12);
    expect(result.fit_score_0_100).toBeCloseTo(49.11564178891043, 12);
    expect(result.recommendation).toBe(
      "Large deviation from reference benchmarks — treat results as illustrative"
    );
    expect(result.sources).toEqual(["reference benchmark fixture"]);
  });

  it("keeps the signed VMT percent error while scoring on its magnitude", () => {
    // modeled 11 vs reference 22 → −50% error; |−50| × 2 = 100 → clamps at 0.
    const result = fit(11, { ...REFERENCE.mode_split_pct });

    expect(result.vmt_percent_error).toBe(-50);
    expect(result.components.vmt_score).toBe(0);
    expect(result.components.mode_split_score).toBe(100);
    expect(result.fit_score_0_100).toBe(50);
  });

  it("clamps the VMT component at zero instead of going negative", () => {
    // modeled 66 vs reference 22 → +200% error → 100 − 400 clamps to 0.
    const result = fit(66, { ...REFERENCE.mode_split_pct });

    expect(result.vmt_percent_error).toBeCloseTo(200, 12);
    expect(result.components.vmt_score).toBe(0);
  });

  it("clamps the mode-split component at zero for a large split deviation", () => {
    // errors vs default reference: −38, +48.5, −6, −1.5, −3 (pct-pts)
    // → rmse = sqrt(3843.5 / 5) ≈ 27.7 pct-pts → 100 − 277 clamps to 0.
    const result = fit(REFERENCE.vmt_per_capita, {
      auto: 50,
      transit: 50,
      walk: 0,
      bike: 0,
      shared: 0,
    });

    expect(result.mode_split_rmse).toBe(Math.sqrt(3843.5 / 5));
    expect(result.mode_split_rmse).toBeGreaterThan(10);
    expect(result.components.mode_split_score).toBe(0);
    expect(result.components.vmt_score).toBe(100);
    expect(result.fit_score_0_100).toBe(50);
  });

  it("documents percentage-point RMSE units: a uniform 1-point share error scores 90", () => {
    // Mode shares are percentage points (0–100). A one-percentage-point
    // error on every mode gives rmse exactly 1 → mode_split_score 90.
    // (The same shares passed as 0–1 fractions would give rmse 0.01 and a
    // deceptive 99.9 — which is why the inputs must be on the 0–100 scale.)
    const offByOne = Object.fromEntries(
      SKETCH_BENCHMARK_MODES.map((mode) => [mode, REFERENCE.mode_split_pct[mode] + 1])
    ) as SketchModeSplitPct;
    const result = fit(REFERENCE.vmt_per_capita, offByOne);

    expect(result.mode_split_rmse).toBe(1);
    expect(result.components.mode_split_score).toBe(90);
    expect(result.fit_score_0_100).toBe(95);
    expect(result.recommendation).toBe("Close to reference benchmarks");
  });

  it("echoes the modeled and reference values used", () => {
    const modeled = { auto: 91, transit: 1, walk: 5, bike: 1, shared: 2 };
    const result = fit(19.5, modeled);

    expect(result.modeled).toEqual({ vmt_per_capita: 19.5, mode_split_pct: modeled });
    expect(result.reference).toEqual({
      vmt_per_capita: REFERENCE.vmt_per_capita,
      mode_split_pct: REFERENCE.mode_split_pct,
    });
    // Copies, not shared references.
    expect(result.reference.mode_split_pct).not.toBe(REFERENCE.mode_split_pct);
  });
});

describe("benchmarkFitRecommendation", () => {
  it("uses strict upstream thresholds (>90, >75, >60)", () => {
    expect(benchmarkFitRecommendation(100)).toBe("Close to reference benchmarks");
    expect(benchmarkFitRecommendation(90.01)).toBe("Close to reference benchmarks");
    expect(benchmarkFitRecommendation(90)).toBe("Reasonable screening agreement");
    expect(benchmarkFitRecommendation(75.01)).toBe("Reasonable screening agreement");
    expect(benchmarkFitRecommendation(75)).toBe("Directional only — review assumptions");
    expect(benchmarkFitRecommendation(60.01)).toBe("Directional only — review assumptions");
    expect(benchmarkFitRecommendation(60)).toBe(
      "Large deviation from reference benchmarks — treat results as illustrative"
    );
    expect(benchmarkFitRecommendation(0)).toBe(
      "Large deviation from reference benchmarks — treat results as illustrative"
    );
  });
});

describe("DEFAULT_SKETCH_REFERENCE_BENCHMARKS", () => {
  it("reuses the CEQA screen's operator-default VMT reference (22.0)", () => {
    expect(REFERENCE.vmt_per_capita).toBe(22.0);
    expect(REFERENCE.vmt_per_capita).toBe(DEFAULT_REFERENCE_VMT_PER_CAPITA);
  });

  it("carries a five-mode reference split that sums to 100 percentage points", () => {
    const sum = SKETCH_BENCHMARK_MODES.reduce(
      (total, mode) => total + REFERENCE.mode_split_pct[mode],
      0
    );
    expect(sum).toBeCloseTo(100, 9);
  });

  it("documents every reference value as a screening reference, not a local observation", () => {
    expect(REFERENCE.sources.length).toBeGreaterThanOrEqual(2);
    expect(REFERENCE.sources.join(" ")).toContain("not a local observation");
    expect(REFERENCE.sources.join(" ")).toContain("ACS B08301");
  });

  it("keeps benchmark-fit copy inside the screening claim boundary", () => {
    const surfacedCopy = JSON.stringify({
      defaults: REFERENCE,
      example: fit(30, { auto: 95, transit: 1, walk: 2, bike: 1, shared: 1 }),
      recommendations: [
        benchmarkFitRecommendation(95),
        benchmarkFitRecommendation(80),
        benchmarkFitRecommendation(65),
        benchmarkFitRecommendation(10),
      ],
    });
    expect(surfacedCopy).not.toMatch(/validat|calibrat|forecast/i);
  });
});

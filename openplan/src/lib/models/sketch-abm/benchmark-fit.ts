/**
 * Benchmark fit — a screening diagnostic that compares sketch activity-model
 * outputs against reference benchmarks. It is NOT validation and it does not
 * tune the model: the score only says how far a sketch run sits from generic
 * reference points, so planners know whether to read the outputs as
 * directional or purely illustrative.
 *
 * Goodness-of-fit arithmetic ported faithfully from FreeChAMP
 * (github.com/nfredmond/FreeChAMP, Apache-2.0), original path:
 * apps/web/src/server/routers — the goodness-of-fit scoring block. Upstream
 * scored a run against locally observed data; this port renames the concept
 * to "benchmark fit" and scores against reference benchmarks instead.
 *
 * UNITS (load-bearing): mode-split shares are expressed in PERCENTAGE POINTS
 * (0–100, e.g. auto = 88 means 88%), matching the sketch runner's
 * `summary.mode_split` output and the upstream math. `mode_split_rmse` is
 * therefore in percentage points too: `mode_split_score` = 100 − RMSE×10
 * reaches 0 at a 10-percentage-point RMSE, which is only meaningful on the
 * 0–100 scale. Passing 0–1 fractional shares would produce a deceptively
 * tiny RMSE and a near-perfect score — do not.
 */

import { DEFAULT_REFERENCE_VMT_PER_CAPITA } from "@/lib/planner-pack/ceqa";

/** Aggregate mode-split shares in percentage points (0–100). */
export type SketchModeSplitPct = {
  auto: number;
  transit: number;
  walk: number;
  bike: number;
  shared: number;
};

export const SKETCH_BENCHMARK_MODES = ["auto", "transit", "walk", "bike", "shared"] as const;

export type SketchReferenceBenchmarks = {
  /** Reference daily VMT per capita (vehicle-miles/person/day). */
  vmt_per_capita: number;
  /** Reference aggregate mode split in percentage points (0–100). */
  mode_split_pct: SketchModeSplitPct;
  /** One-line source note per reference value. */
  sources: string[];
};

/**
 * Default screening reference benchmarks for a rural/small-urban California
 * context. Every value is a reference point for screening comparison, not a
 * local observation — a run scored against these has been compared to
 * generic benchmarks only, never to counts or surveys from its study area.
 */
export const DEFAULT_SKETCH_REFERENCE_BENCHMARKS: SketchReferenceBenchmarks = {
  // Same operator-default the CEQA §15064.3 screen uses
  // (DEFAULT_REFERENCE_VMT_PER_CAPITA = 22.0 vehicle-miles/person/day).
  vmt_per_capita: DEFAULT_REFERENCE_VMT_PER_CAPITA,
  mode_split_pct: {
    // ACS B08301-shaped commute share (drove alone + carpool) for
    // rural/small-urban California counties; screening reference only.
    auto: 88,
    // ACS B08301-shaped commute transit share for rural/small-urban
    // California (thin fixed-route service); screening reference only.
    transit: 1.5,
    // ACS B08301-shaped walk share, nudged up because sketch trips cover
    // all purposes, not just commutes; screening reference only.
    walk: 6,
    // ACS B08301-shaped bicycle commute share for rural/small-urban
    // California; screening reference only.
    bike: 1.5,
    // Taxi/TNC and other shared-ride share (ACS B08301 "taxicab + other"
    // shaped) for rural/small-urban California; screening reference only.
    shared: 3,
  },
  sources: [
    "VMT per capita reference 22.0 vehicle-miles/person/day — the same operator-default the CEQA §15064.3 screen uses; a screening reference, not a local observation.",
    "Mode-split reference — ACS B08301-shaped commute mode shares for a rural/small-urban California context, renormalized over auto/transit/walk/bike/shared; screening reference points, not local observations.",
  ],
};

export type ComputeBenchmarkFitParams = {
  modeled: {
    /** Expanded daily VMT per capita from the sketch run KPIs. */
    vmt_per_capita: number;
    /** Aggregate mode split in percentage points (0–100). */
    mode_split_pct: SketchModeSplitPct;
  };
  reference: SketchReferenceBenchmarks;
};

export type BenchmarkFitResult = {
  grade: "sketch_screening";
  /** Signed VMT deviation from the reference, in percent of the reference. */
  vmt_percent_error: number;
  /** Root-mean-square mode-share error across the five aggregate modes, in percentage points. */
  mode_split_rmse: number;
  /** Overall benchmark-fit score, 0–100 (mean of the two component scores). */
  fit_score_0_100: number;
  components: {
    /** max(0, 100 − |vmt_percent_error| × 2) */
    vmt_score: number;
    /** max(0, 100 − mode_split_rmse × 10), RMSE in percentage points */
    mode_split_score: number;
  };
  modeled: {
    vmt_per_capita: number;
    mode_split_pct: SketchModeSplitPct;
  };
  reference: {
    vmt_per_capita: number;
    mode_split_pct: SketchModeSplitPct;
  };
  sources: string[];
  recommendation: string;
};

/** Screening-grade recommendation copy for an overall fit score. */
export function benchmarkFitRecommendation(fitScore: number): string {
  if (fitScore > 90) return "Close to reference benchmarks";
  if (fitScore > 75) return "Reasonable screening agreement";
  if (fitScore > 60) return "Directional only — review assumptions";
  return "Large deviation from reference benchmarks — treat results as illustrative";
}

/**
 * Compute the screening-grade benchmark fit of a sketch run against
 * reference benchmarks. Pure arithmetic, ported faithfully from the
 * FreeChAMP goodness-of-fit block:
 *
 *   vmt_percent_error = (modeled − reference) / reference × 100
 *   mode_split_rmse   = sqrt(mean(squared per-mode share errors))   [pct-pts]
 *   vmt_score         = max(0, 100 − |vmt_percent_error| × 2)
 *   mode_split_score  = max(0, 100 − mode_split_rmse × 10)
 *   fit_score_0_100   = (vmt_score + mode_split_score) / 2
 */
export function computeBenchmarkFit({ modeled, reference }: ComputeBenchmarkFitParams): BenchmarkFitResult {
  const vmtError = modeled.vmt_per_capita - reference.vmt_per_capita;
  const vmtPercentError = (vmtError / reference.vmt_per_capita) * 100;

  const squaredErrorSum = SKETCH_BENCHMARK_MODES.reduce((sum, mode) => {
    const error = modeled.mode_split_pct[mode] - reference.mode_split_pct[mode];
    return sum + error * error;
  }, 0);
  const modeSplitRmse = Math.sqrt(squaredErrorSum / SKETCH_BENCHMARK_MODES.length);

  const vmtScore = Math.max(0, 100 - Math.abs(vmtPercentError) * 2);
  const modeSplitScore = Math.max(0, 100 - modeSplitRmse * 10);
  const fitScore = (vmtScore + modeSplitScore) / 2;

  return {
    grade: "sketch_screening",
    vmt_percent_error: vmtPercentError,
    mode_split_rmse: modeSplitRmse,
    fit_score_0_100: fitScore,
    components: {
      vmt_score: vmtScore,
      mode_split_score: modeSplitScore,
    },
    modeled: {
      vmt_per_capita: modeled.vmt_per_capita,
      mode_split_pct: { ...modeled.mode_split_pct },
    },
    reference: {
      vmt_per_capita: reference.vmt_per_capita,
      mode_split_pct: { ...reference.mode_split_pct },
    },
    sources: [...reference.sources],
    recommendation: benchmarkFitRecommendation(fitScore),
  };
}

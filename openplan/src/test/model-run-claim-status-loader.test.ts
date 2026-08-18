import { describe, expect, it, vi } from "vitest";

import {
  loadModelRunClaimStatuses,
  strongestModelingClaimStatus,
  type ModelingEvidenceSupabaseLike,
} from "@/lib/models/evidence-backbone";

type ClaimRow = {
  model_run_id: string | null;
  claim_status: string | null;
  status_reason?: string | null;
  /**
   * Present because the loader reads it. Its absence here silently dropped the
   * field from every fixture — object literals lose properties the declared
   * type does not name — so two tests of real behaviour failed against correct
   * production code. A fixture type is part of the test's honesty.
   */
  validation_summary_json?: unknown;
};

function fakeSupabase(
  result: { data?: ClaimRow[] | null; error?: { message: string } | null },
  onIn?: (column: string, ids: unknown) => void,
  onSelect?: (projection: string) => void
): ModelingEvidenceSupabaseLike {
  return {
    from: () => ({
      select: (projection: string) => {
        onSelect?.(projection);
        return {
          in: async (column: string, ids: unknown) => {
            onIn?.(column, ids);
            return { data: result.data ?? null, error: result.error ?? null };
          },
        };
      },
    }),
  } as unknown as ModelingEvidenceSupabaseLike;
}

const RUN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("loadModelRunClaimStatuses", () => {
  it("keeps the STRONGEST tier per run across multiple track rows", async () => {
    const supabase = fakeSupabase({
      data: [
        { model_run_id: RUN_A, claim_status: "screening_grade", status_reason: "weaker" },
        { model_run_id: RUN_A, claim_status: "calibrated_to_counts", status_reason: "stronger" },
        { model_run_id: RUN_B, claim_status: "prototype_only", status_reason: null },
      ],
    });

    const map = await loadModelRunClaimStatuses({ supabase, modelRunIds: [RUN_A, RUN_B] });

    // calibrated_to_counts (rank 2) beats screening_grade (rank 1) for the same run.
    expect(map.get(RUN_A)?.status).toBe("calibrated_to_counts");
    expect(map.get(RUN_B)?.status).toBe("prototype_only");
  });

  it("carries the WINNING row's reason, not some other row's", async () => {
    // A reason describes one decision. Pairing the strongest tier with a
    // different row's justification would put a true sentence under a badge it
    // does not explain — worse than showing no reason at all.
    const supabase = fakeSupabase({
      data: [
        {
          model_run_id: RUN_A,
          claim_status: "prototype_only",
          status_reason: "No observed-count source covers this study area.",
        },
        {
          model_run_id: RUN_A,
          claim_status: "screening_grade",
          status_reason: "Observed-count validation passed the screening gate (4 stations).",
        },
      ],
    });

    const map = await loadModelRunClaimStatuses({ supabase, modelRunIds: [RUN_A] });
    expect(map.get(RUN_A)?.status).toBe("screening_grade");
    expect(map.get(RUN_A)?.reason).toBe(
      "Observed-count validation passed the screening gate (4 stations)."
    );
  });

  it("does not let a TIED tier from another track swap the reason", async () => {
    // A run carries one decision per track, and two tracks can reach the same
    // tier for unrelated reasons. If a tie replaced the winner, the badge would
    // hold still while the sentence under it changed with PostgREST's row
    // order — a justification that rewrites itself between page loads.
    const rows: ClaimRow[] = [
      { model_run_id: RUN_A, claim_status: "prototype_only", status_reason: "first track" },
      { model_run_id: RUN_A, claim_status: "prototype_only", status_reason: "second track" },
    ];
    const forward = await loadModelRunClaimStatuses({
      supabase: fakeSupabase({ data: rows }),
      modelRunIds: [RUN_A],
    });
    expect(forward.get(RUN_A)?.reason).toBe("first track");

    // Same rows, order reversed: whichever arrives first is kept, and the tie
    // itself never causes a replacement.
    const reversed = await loadModelRunClaimStatuses({
      supabase: fakeSupabase({ data: [...rows].reverse() }),
      modelRunIds: [RUN_A],
    });
    expect(reversed.get(RUN_A)?.reason).toBe("second track");
  });

  it("reports a missing or blank reason as null, never as an empty string", async () => {
    // The panel renders the reason only when there is one. An empty string is
    // truthy enough to slip through a naive check and print a blank line under
    // the badge, which reads as a reason that failed to load.
    const supabase = fakeSupabase({
      data: [
        { model_run_id: RUN_A, claim_status: "prototype_only", status_reason: "   " },
        { model_run_id: RUN_B, claim_status: "prototype_only" },
      ],
    });

    const map = await loadModelRunClaimStatuses({ supabase, modelRunIds: [RUN_A, RUN_B] });
    expect(map.get(RUN_A)?.reason).toBeNull();
    expect(map.get(RUN_B)?.reason).toBeNull();
  });

  it("asks the database for the columns it renders", async () => {
    /**
     * THE ONE ASSERTION A MOCKED SUPABASE CLIENT CANNOT MAKE FOR ITSELF.
     *
     * The fake returns whatever fixture it was given regardless of the
     * projection, and the real clients are untyped by convention, so deleting
     * `status_reason` from the `.select()` leaves every other test in this file
     * green while the panel renders nothing under the badge. Asserting on the
     * projection STRING is the only thing that catches it.
     */
    let projection: string | null = null;
    const supabase = fakeSupabase({ data: [] }, undefined, (p) => {
      projection = p;
    });

    await loadModelRunClaimStatuses({ supabase, modelRunIds: [RUN_A] });

    expect(projection).not.toBeNull();
    // `validation_summary_json` joined this list when the run card began
    // DRAWING per-road-class accuracy from it — same trap, same assertion:
    // drop it from the projection and every other test here stays green while
    // the chart silently disappears from the page.
    for (const column of ["model_run_id", "claim_status", "status_reason", "validation_summary_json"]) {
      expect(projection!).toContain(column);
    }
  });

  it("carries per-road-class accuracy through to the caller", async () => {
    const supabase = fakeSupabase({
      data: [
        {
          model_run_id: RUN_A,
          claim_status: "screening_grade",
          status_reason: "compared against observed counts",
          validation_summary_json: {
            metrics: {
              by_road_class: [
                { road_class: "motorway", stations: 25, median_absolute_percent_error: 42.73, median_model_over_observed: 0.621 },
                { road_class: "tertiary", stations: 1, median_absolute_percent_error: 1.2 },
              ],
            },
          },
        },
      ],
    });

    const result = await loadModelRunClaimStatuses({ supabase, modelRunIds: [RUN_A] });
    const rows = result.get(RUN_A)?.roadClassAccuracy ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ roadClass: "motorway", stations: 25, medianAbsolutePercentError: 42.73 });
    // A class with no recorded ratio keeps null rather than a fabricated 1.0.
    expect(rows[1].medianModelOverObserved).toBeNull();
  });

  it("drops a road class missing its station count rather than drawing it as zero", async () => {
    // A zero on a chart reads as a perfect match, not as an absence.
    const supabase = fakeSupabase({
      data: [
        {
          model_run_id: RUN_A,
          claim_status: "screening_grade",
          status_reason: null,
          validation_summary_json: {
            metrics: {
              by_road_class: [
                { road_class: "motorway", stations: 25, median_absolute_percent_error: 42.73 },
                { road_class: "trunk", stations: null, median_absolute_percent_error: null },
                { stations: 9, median_absolute_percent_error: 12 },
              ],
            },
          },
        },
      ],
    });

    const rows = (await loadModelRunClaimStatuses({ supabase, modelRunIds: [RUN_A] })).get(RUN_A)?.roadClassAccuracy ?? [];
    expect(rows.map((row) => row.roadClass)).toEqual(["motorway"]);
  });

  it("carries the per-station comparisons the scatter is drawn from", async () => {
    /**
     * NO SCHEMA CHANGE WAS NEEDED FOR THIS. The worker's validation summary has
     * carried a per-station `results` array all along and nothing read it, so
     * the most informative chart in traffic modelling was one projection away
     * the whole time.
     */
    const supabase = fakeSupabase({
      data: [
        {
          model_run_id: RUN_A,
          claim_status: "screening_grade",
          status_reason: null,
          validation_summary_json: {
            results: [
              { station_id: "CT_1", label: "SR 20 mainline", match_status: "matched", observed_volume: 47000, modeled_daily_pce: 53055, link_type: "motorway" },
              { station_id: "CT_2", label: "unmatched one", match_status: "unmatched", observed_volume: 900 },
              { station_id: "CT_3", label: "zero count", match_status: "matched", observed_volume: 0, modeled_daily_pce: 5000 },
            ],
          },
        },
      ],
    });

    const points = (await loadModelRunClaimStatuses({ supabase, modelRunIds: [RUN_A] })).get(RUN_A)?.stationComparisons ?? [];
    // Only the matched, plottable station survives: an unmatched station is not
    // a comparison, and a zero observed count has no place on a log scale.
    expect(points.map((p) => p.stationId)).toEqual(["CT_1"]);
    expect(points[0]).toMatchObject({ observed: 47000, modelled: 53055, roadClass: "motorway" });
  });

  it("falls back to the station id when a station has no label", async () => {
    const supabase = fakeSupabase({
      data: [
        {
          model_run_id: RUN_A,
          claim_status: "screening_grade",
          status_reason: null,
          validation_summary_json: {
            results: [{ station_id: "CT_9", match_status: "matched", observed_volume: 100, modeled_daily_pce: 120 }],
          },
        },
      ],
    });
    const points = (await loadModelRunClaimStatuses({ supabase, modelRunIds: [RUN_A] })).get(RUN_A)?.stationComparisons ?? [];
    expect(points[0].label).toBe("CT_9");
  });

  it("reports no breakdown at all when the run recorded none", async () => {
    const supabase = fakeSupabase({
      data: [{ model_run_id: RUN_A, claim_status: "prototype_only", status_reason: null, validation_summary_json: null }],
    });
    const rows = (await loadModelRunClaimStatuses({ supabase, modelRunIds: [RUN_A] })).get(RUN_A)?.roadClassAccuracy;
    expect(rows).toEqual([]);
  });

  it("ignores rows with an unknown/null claim status or run id", async () => {
    const supabase = fakeSupabase({
      data: [
        { model_run_id: RUN_C, claim_status: "not_a_real_status" },
        { model_run_id: RUN_C, claim_status: null },
        { model_run_id: null, claim_status: "calibrated_to_counts" },
      ],
    });

    const map = await loadModelRunClaimStatuses({ supabase, modelRunIds: [RUN_C] });
    expect(map.has(RUN_C)).toBe(false);
    expect(map.size).toBe(0);
  });

  it("short-circuits without querying when no run ids are given", async () => {
    const fromSpy = vi.fn();
    const supabase = { from: fromSpy } as unknown as ModelingEvidenceSupabaseLike;

    const map = await loadModelRunClaimStatuses({ supabase, modelRunIds: [] });
    expect(map.size).toBe(0);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("dedupes run ids before querying", async () => {
    let queriedIds: unknown = null;
    const supabase = fakeSupabase({ data: [] }, (_column, ids) => {
      queriedIds = ids;
    });

    await loadModelRunClaimStatuses({ supabase, modelRunIds: [RUN_A, RUN_A, RUN_B] });
    expect(queriedIds).toEqual([RUN_A, RUN_B]);
  });

  it("returns an empty map (best-effort) when the query errors", async () => {
    const supabase = fakeSupabase({ error: { message: "relation does not exist" } });
    const map = await loadModelRunClaimStatuses({ supabase, modelRunIds: [RUN_A] });
    expect(map.size).toBe(0);
  });
});

describe("strongestModelingClaimStatus", () => {
  it("ranks calibrated_to_counts above screening_grade and prototype_only", () => {
    expect(
      strongestModelingClaimStatus(["prototype_only", "screening_grade", "calibrated_to_counts"])
    ).toBe("calibrated_to_counts");
  });

  it("ranks claim_grade_passed highest", () => {
    expect(strongestModelingClaimStatus(["calibrated_to_counts", "claim_grade_passed"])).toBe(
      "claim_grade_passed"
    );
  });

  it("returns null for an empty set", () => {
    expect(strongestModelingClaimStatus([])).toBeNull();
  });
});

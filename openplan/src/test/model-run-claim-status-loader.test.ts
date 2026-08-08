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
    for (const column of ["model_run_id", "claim_status", "status_reason"]) {
      expect(projection!).toContain(column);
    }
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

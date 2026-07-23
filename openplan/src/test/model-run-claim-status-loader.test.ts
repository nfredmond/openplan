import { describe, expect, it, vi } from "vitest";

import {
  loadModelRunClaimStatuses,
  strongestModelingClaimStatus,
  type ModelingEvidenceSupabaseLike,
} from "@/lib/models/evidence-backbone";

type ClaimRow = { model_run_id: string | null; claim_status: string | null };

function fakeSupabase(
  result: { data?: ClaimRow[] | null; error?: { message: string } | null },
  onIn?: (column: string, ids: unknown) => void
): ModelingEvidenceSupabaseLike {
  return {
    from: () => ({
      select: () => ({
        in: async (column: string, ids: unknown) => {
          onIn?.(column, ids);
          return { data: result.data ?? null, error: result.error ?? null };
        },
      }),
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
        { model_run_id: RUN_A, claim_status: "screening_grade" },
        { model_run_id: RUN_A, claim_status: "calibrated_to_counts" },
        { model_run_id: RUN_B, claim_status: "prototype_only" },
      ],
    });

    const map = await loadModelRunClaimStatuses({ supabase, modelRunIds: [RUN_A, RUN_B] });

    // calibrated_to_counts (rank 2) beats screening_grade (rank 1) for the same run.
    expect(map.get(RUN_A)).toBe("calibrated_to_counts");
    expect(map.get(RUN_B)).toBe("prototype_only");
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

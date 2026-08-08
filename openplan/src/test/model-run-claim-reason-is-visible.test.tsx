import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRunEvidencePanel } from "@/components/models/model-run-evidence-panel";
// The label comes from the ONE tier labeller rather than a literal, so this
// test cannot drift from what the badge actually says.
import { modelingClaimStatusLabel } from "@/lib/models/evidence-backbone";

/**
 * THE TIER IS NOT THE FINDING — THE REASON IS.
 *
 * Three unrelated outcomes all land on the same "Prototype only" badge:
 *
 *   1. no observed-count source covers this study area (a data gap in their
 *      state, nothing to do with their model);
 *   2. the zone system cannot support a link-level comparison, so the counts
 *      could not settle the question either way;
 *   3. the model was compared to local counts and genuinely disagreed.
 *
 * Only (3) is a finding about the model. A planner shown one identical badge
 * for all three has been told the least useful true thing available, and cannot
 * defend the run or act on it. The reason was being written to
 * `modeling_claim_decisions.status_reason` by the worker and read by nothing —
 * complete, stored, and invisible.
 *
 * This test renders the REAL panel, so it fails if the reason stops reaching a
 * screen — which is the failure mode, not the storage.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_RUN_ID = "22222222-2222-4222-8222-222222222222";

const PACKET = {
  engine: "aequilibrae",
  mode_split: { transit_status: "modeled" },
  provenance: {
    engine_version: "aeq-1.6.2",
    run_started_at: "2026-08-08T17:00:00.000Z",
    run_completed_at: "2026-08-08T17:06:00.000Z",
  },
  inputs: { zone_count: 26 },
  assumptions: { corridor_geojson_hash: "abcdef1234567890ffff" },
  caveats: ["Uncalibrated", "Screening-grade"],
};

const ZONE_REASON =
  "The count comparison (3 stations, median APE 24.1%) met the screening thresholds, but a " +
  "screening claim is NOT recorded from it, because at this zone resolution matching the counts " +
  "does not establish one. 36.0% of this run's trips begin and end in the same zone across 26 " +
  "zones and never reach any link.";

function renderPanel(props: {
  claimStatus?: "prototype_only" | "screening_grade" | null;
  claimStatusReason?: string | null;
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => PACKET }))
  );
  return render(
    <ModelRunEvidencePanel
      modelId={MODEL_ID}
      modelRunId={MODEL_RUN_ID}
      runTitle="County screening run"
      runStatus="succeeded"
      engineKey="aequilibrae"
      comparisonCandidates={[]}
      claimStatus={props.claimStatus ?? null}
      claimStatusReason={props.claimStatusReason ?? null}
    />
  );
}

async function openEvidence() {
  fireEvent.click(screen.getByRole("button", { name: /inspect evidence/i }));
  await waitFor(() => expect(screen.getByTestId("evidence-run-honesty")).toBeInTheDocument());
}

describe("a recorded claim tier shows why it was recorded", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the withheld-gate reason beside the prototype badge", async () => {
    renderPanel({ claimStatus: "prototype_only", claimStatusReason: ZONE_REASON });
    await openEvidence();

    const block = screen.getByTestId("evidence-run-honesty");
    expect(block).toHaveTextContent(modelingClaimStatusLabel("prototype_only"));

    const reason = screen.getByTestId("evidence-claim-status-reason");
    // The distinction a planner has to be able to draw: the counts were MET,
    // and the claim still was not awarded — because of the zone system.
    expect(reason).toHaveTextContent("met the screening thresholds");
    expect(reason).toHaveTextContent("does not establish one");
    expect(reason).toHaveTextContent("never reach any link");
  });

  it("distinguishes a coverage gap from a disagreement under the same badge", async () => {
    const coverage =
      "No observed-count source is registered for this study area. Screening-grade claims " +
      "require a validation pass against local counts.";
    renderPanel({ claimStatus: "prototype_only", claimStatusReason: coverage });
    await openEvidence();

    const reason = screen.getByTestId("evidence-claim-status-reason");
    expect(reason).toHaveTextContent("No observed-count source is registered");
    // And it must NOT read as a failed model.
    expect(reason.textContent ?? "").not.toMatch(/did not meet|failed/i);
  });

  it("renders nothing when no reason was recorded", async () => {
    renderPanel({ claimStatus: "prototype_only", claimStatusReason: null });
    await openEvidence();

    expect(screen.queryByTestId("evidence-claim-status-reason")).toBeNull();
  });

  it("never attaches a reason to the engine-availability FALLBACK tier", async () => {
    // With no recorded decision the panel falls back to a tier derived from the
    // engine's availability. A reason rendered there would be a justification
    // for a default — text implying somebody decided something when nobody did.
    renderPanel({ claimStatus: null, claimStatusReason: ZONE_REASON });
    await openEvidence();

    expect(screen.getByTestId("evidence-run-honesty")).toBeInTheDocument();
    expect(screen.queryByTestId("evidence-claim-status-reason")).toBeNull();
  });
});

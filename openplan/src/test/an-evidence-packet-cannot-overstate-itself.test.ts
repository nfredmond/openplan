import { describe, expect, it } from "vitest";

import { normalizeEvidencePacket } from "@/lib/models/evidence-packet";

/**
 * THE PACKET IS THE ARTIFACT A PLANNER DEFENDS A RUN WITH, so what it says
 * about its own origin is a provenance claim, not formatting.
 *
 * MEASURED 2026-08-09. A mutation sample of `evidence-packet.ts` killed 3 of 8;
 * five survivors, every one re-run against the whole ~7,850-test suite and
 * surviving that too. All five let the packet describe itself as better
 * evidence than it is:
 *
 *   - an EMPTY packet could report `source_packet_format: "worker-legacy"`
 *     instead of "synthesized", so a packet with nothing behind it presents as
 *     real worker output;
 *   - the worker's own caveats could be dropped entirely;
 *   - `fallback_reason` could be suppressed, which is what drives the
 *     "Synthesized fallback" badge on the run evidence panel — hiding that the
 *     packet is a stand-in;
 *   - the engine could default to a name the run never had;
 *   - `engine_version` could drop its "-prototype-" marker.
 *
 * None of these changes a number. Each changes what the number is presented AS,
 * which is the whole job of an evidence packet.
 */

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_RUN_ID = "22222222-2222-4222-8222-222222222222";
const GENERATED_AT = "2026-08-09T12:00:00.000Z";

function normalize(
  rawPacket: unknown,
  overrides: { runRecord?: Record<string, unknown>; fallbackReason?: string | null } = {}
) {
  return normalizeEvidencePacket({
    rawPacket,
    modelId: MODEL_ID,
    modelRunId: MODEL_RUN_ID,
    modelTitle: "Corridor screening",
    runRecord: overrides.runRecord ?? { id: MODEL_RUN_ID, engine_key: "sketch_abm" },
    artifacts: [],
    stages: [],
    kpis: [],
    generatedAt: GENERATED_AT,
    fallbackReason: overrides.fallbackReason ?? null,
  } as never);
}

describe("a packet says honestly where it came from", () => {
  it("calls an empty packet SYNTHESIZED, not worker output", () => {
    /**
     * The badge on the run evidence panel reads
     * `provenance.source_packet_format` verbatim. Labelling a packet with
     * nothing behind it "worker-legacy" tells a planner the engine produced
     * evidence it never produced — and this is the case where there is least
     * else on screen to contradict it.
     */
    expect(normalize({}).provenance.source_packet_format).toBe("synthesized");
    expect(normalize(null).provenance.source_packet_format).toBe("synthesized");
  });

  it("distinguishes worker-legacy from planner-v1 from synthesized", () => {
    // Three distinct origins that must not collapse into one another. Asserted
    // together so a mutation cannot satisfy one by widening another.
    expect(normalize({ inputs: { zone_count: 26 } }).provenance.source_packet_format).toBe(
      "planner-v1"
    );
    expect(normalize({ some_legacy_field: 1 }).provenance.source_packet_format).toBe(
      "worker-legacy"
    );
    expect(normalize({}).provenance.source_packet_format).toBe("synthesized");
  });

  it("keeps the fallback reason, which is what marks a packet as a stand-in", () => {
    // The panel renders a "Synthesized fallback" badge off this field being
    // non-null. Suppressing it removes the only signal that the packet was
    // assembled rather than produced.
    const reason = "Worker packet was unreadable; assembled from run records.";
    expect(normalize({ inputs: {} }, { fallbackReason: reason }).provenance.fallback_reason).toBe(
      reason
    );
    // ...and it stays null when there was no fallback, so the badge is not
    // permanently on.
    expect(normalize({ inputs: {} }).provenance.fallback_reason).toBeNull();
  });

  it("never renames the engine the run actually used", () => {
    /**
     * Defaulting to any specific engine is an engine/provenance mismatch — the
     * same failure the launch route refuses in-process engines to prevent.
     * A sketch run's packet must not read as an assignment run's.
     */
    const packet = normalize({}, { runRecord: { id: MODEL_RUN_ID, engine_key: "sketch_abm" } });
    expect(packet.engine).toBe("sketch_abm");
    expect(packet.engine).not.toBe("aequilibrae");
  });

  it("keeps the prototype marker in the engine version", () => {
    // "-prototype-v1" is a maturity disclosure. Dropping it makes a screening
    // prototype read as a released engine.
    const packet = normalize({}, { runRecord: { id: MODEL_RUN_ID, engine_key: "sketch_abm" } });
    expect(packet.provenance.engine_version).toContain("prototype");
  });

  it("carries the worker's own caveats through to the packet", () => {
    /**
     * The caveats are the run's honesty disclosures, written by whatever
     * produced it. Dropping them survived the whole suite — the packet would
     * simply arrive with none, and nothing would look wrong.
     */
    const packet = normalize({
      inputs: {},
      caveats: ["Uncalibrated", "Screening-grade — not forecast-ready"],
    });

    expect(packet.caveats).toContain("Uncalibrated");
    expect(packet.caveats).toContain("Screening-grade — not forecast-ready");
  });
});

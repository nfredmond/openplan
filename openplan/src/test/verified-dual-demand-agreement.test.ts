import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  freezeDualDemandAgreementSnapshot,
  verifyDualDemandAgreementEvidence,
  verifyFrozenDualDemandAgreementSnapshots,
} from "@/lib/models/verified-dual-demand-agreement";
import {
  retainCitedAgreementCorridorSelections,
  validateAgreementCorridorSelections,
} from "@/lib/reports/dual-demand-agreement";

const MODEL_RUN_ID = "22222222-2222-4222-8222-222222222222";
const ARTIFACT_ID = "66666666-6666-4666-8666-666666666666";
const bytes = readFileSync("../scripts/modeling/tests/fixtures/producer_corridor_agreement_v2.geojson");
const fixture = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;

function cloneFixture() {
  return structuredClone(fixture);
}

function verification(payload: Record<string, unknown>) {
  const metadata = payload.metadata as Record<string, unknown>;
  const convergence = metadata.assignment_convergence as Record<string, unknown>;
  const profileDigests = convergence.assignment_profile_digests as Record<string, string>;
  const consistency = metadata.network_consistency as Record<string, unknown>;
  const evidence = consistency.evidence as Record<string, unknown>;
  const networkSettings = (evidence.network_settings as Record<string, Record<string, string>>).first;
  const networkStates = (evidence.network_states as Record<string, Record<string, string>>).first;
  return {
    artifactSha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    assignmentProfileSha256: profileDigests.first,
    networkSettingsSha256: networkSettings.digest,
    networkStateSha256: networkStates.digest,
  };
}

function verify(payload = cloneFixture(), overrides: Record<string, unknown> = {}) {
  return verifyDualDemandAgreementEvidence({
    source: "registered_artifact",
    payload,
    verification: { ...verification(payload), ...overrides },
    modelRunId: MODEL_RUN_ID,
    artifactId: ARTIFACT_ID,
    isAverage: false,
    artifactType: "demand_model_agreement_geojson",
  });
}

describe("verified dual-demand agreement", () => {
  it("accepts the Python producer's even-sized median without widening summary tolerances", () => {
    const payload = cloneFixture();
    const features = payload.features as Array<{ properties: Record<string, unknown> }>;
    // Synthetic link values with the same two central GEHs as the live failure.
    // Expected median was independently computed by corridor_agreement._median.
    Object.assign(features[0].properties, {
      first_volume: 10000, second_volume: 10523.73, difference: 523.73,
      percent_difference: 5.24, geh: 5.17, agreement: "marginal",
    });
    Object.assign(features[1].properties, {
      first_volume: 10000, second_volume: 10525.06, difference: 525.06,
      percent_difference: 5.25, geh: 5.183, agreement: "marginal",
    });
    Object.assign(features[2].properties, {
      first_volume: 0, second_volume: 0, difference: 0,
      percent_difference: null, geh: 0, agreement: "agree", carries_meaningful_traffic: false,
    });
    const summary = (payload.metadata as Record<string, unknown>).summary as Record<string, unknown>;
    Object.assign(summary, {
      links_carrying_meaningful_traffic: 2, agree_share_all_links: 0.3333,
      agree_share_meaningful_links: 0, diverge_share_meaningful_links: 0,
      agree_share_by_volume: 0, median_geh_meaningful_links: 5.176,
    });
    const result = verify(payload);
    expect(result.status).toBe("verified");
    if (result.status !== "verified") throw new Error(result.reason);
    expect(result.agreement.aggregate.medianGehMeaningfulLinks).toBe(5.176);
    summary.median_geh_meaningful_links = 5.177;
    expect(verify(payload)).toMatchObject({ status: "invalid", reason: expect.stringContaining("summary") });
  });

  it("verifies the registered JSON artifact used by reports, not only the map GeoJSON", () => {
    const geo = cloneFixture();
    const metadata = geo.metadata as Record<string, unknown>;
    const features = geo.features as Array<{ properties: Record<string, unknown> }>;
    const geoState = verify(geo);
    if (geoState.status !== "verified") throw new Error("fixture must verify");
    const manifest = metadata.retained_network_manifest as Record<string, unknown>;
    const jsonPayload = {
      schema_version: metadata.schema_version,
      methods: metadata.methods,
      attribution_is_supportable: metadata.attribution_is_supportable,
      attributable_at: metadata.attributable_at,
      assignment_convergence: metadata.assignment_convergence,
      summary: metadata.summary,
      network_alignment: metadata.network_alignment,
      network_consistency: metadata.network_consistency,
      settings: metadata.settings,
      retained_network: {
        manifest,
        network_state_digest: metadata.network_state_digest,
        excluded_roles: manifest.excluded_roles,
        excluded_modeling_connector_count: manifest.modeling_connector_link_count,
      },
      assignment_noise_floor: metadata.assignment_noise_floor,
      corridors: geoState.agreement.namedCorridors.map((row) => ({
        corridor: row.corridor,
        links: row.links,
        first_volume: row.firstVolume,
        second_volume: row.secondVolume,
        geh: row.geh,
        agreement: row.classification,
      })),
      links: features.map((feature) => feature.properties),
      what_this_is_not: metadata.what_this_is_not,
      sources: { first: "fixture:first", second: "fixture:second" },
      generated_at_utc: "2026-08-23T12:00:00Z",
    };
    const state = verifyDualDemandAgreementEvidence({
      source: "registered_artifact",
      payload: jsonPayload,
      verification: verification(geo),
      modelRunId: MODEL_RUN_ID,
      artifactId: ARTIFACT_ID,
      isAverage: false,
      artifactType: "demand_model_agreement",
    });
    expect(state.status).toBe("verified");
  });

  it("accepts the producer fixture and freezes aggregate evidence without selecting a corridor", () => {
    const state = verify();
    expect(state.status).toBe("verified");
    if (state.status !== "verified") return;

    const snapshot = freezeDualDemandAgreementSnapshot(state.agreement, []);
    expect(snapshot.aggregate.linksCompared).toBeGreaterThan(0);
    expect(snapshot.selectedCorridors).toEqual([]);
    expect(snapshot.isAverage).toBe(false);
    expect(snapshot.mandatoryCaveats.join(" ")).toMatch(/accuracy/i);
    expect(verifyFrozenDualDemandAgreementSnapshots({ dualDemandAgreementSnapshotsV1: [snapshot] })[0]?.status)
      .toBe("verified");
  });

  it("freezes only explicitly selected named corridors with both volumes and GEH", () => {
    const state = verify();
    expect(state.status).toBe("verified");
    if (state.status !== "verified") return;
    const selected = state.agreement.namedCorridors[0];
    expect(selected).toBeDefined();

    const snapshot = freezeDualDemandAgreementSnapshot(state.agreement, [selected.corridor]);
    expect(snapshot.selectedCorridors).toEqual([
      expect.objectContaining({
        corridor: selected.corridor,
        firstVolume: expect.any(Number),
        secondVolume: expect.any(Number),
        geh: expect.any(Number),
      }),
    ]);
  });

  it("rejects an absent corridor and clears saved selections when their cited run is removed", () => {
    const state = verify();
    if (state.status !== "verified") throw new Error("fixture must verify");
    const missing = validateAgreementCorridorSelections({
      selections: [{ modelRunId: MODEL_RUN_ID, corridor: "Not in the artifact" }],
      citedModelRunIds: [MODEL_RUN_ID],
      agreementStates: new Map([[MODEL_RUN_ID, state]]),
    });
    expect(missing).toMatchObject({ ok: false, reason: expect.stringMatching(/absent/i) });
    expect(retainCitedAgreementCorridorSelections(
      [{ modelRunId: MODEL_RUN_ID, corridor: "Central Avenue" }],
      [],
    )).toEqual([]);
  });

  it.each([
    ["unsupported schema", (payload: Record<string, unknown>) => ((payload.metadata as Record<string, unknown>).schema_version = "openplan.corridor_agreement.v999")],
    ["mismatched assignment custody", (_payload: Record<string, unknown>, overrides: Record<string, unknown>) => (overrides.assignmentProfileSha256 = "0".repeat(64))],
    ["mismatched network custody", (_payload: Record<string, unknown>, overrides: Record<string, unknown>) => (overrides.networkStateSha256 = "0".repeat(64))],
    ["loose evidence claiming link attribution", (payload: Record<string, unknown>) => {
      const metadata = payload.metadata as Record<string, unknown>;
      metadata.attribution_is_supportable = false;
      metadata.attributable_at = ["corridor", "link"];
    }],
  ])("rejects %s", (_label, mutate) => {
    const payload = cloneFixture();
    const overrides: Record<string, unknown> = {};
    mutate(payload, overrides);
    expect(verify(payload, overrides).status).toBe("invalid");
  });

  it("rejects any artifact or frozen packet represented as an average", () => {
    const payload = cloneFixture();
    const averaged = verifyDualDemandAgreementEvidence({
      source: "registered_artifact",
      payload,
      verification: verification(payload),
      modelRunId: MODEL_RUN_ID,
      artifactId: ARTIFACT_ID,
      isAverage: true,
      artifactType: "demand_model_agreement_geojson",
    });
    expect(averaged.status).toBe("invalid");

    const state = verify();
    if (state.status !== "verified") throw new Error("fixture must verify");
    const snapshot = { ...freezeDualDemandAgreementSnapshot(state.agreement, []), isAverage: true };
    expect(verifyFrozenDualDemandAgreementSnapshots({ dualDemandAgreementSnapshotsV1: [snapshot] })[0]?.status)
      .toBe("invalid");
  });
});

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AGREEMENT_VERIFICATION_HEADERS } from "@/lib/models/demand-agreement-artifact";
import {
  failNextFakeMapConstruction,
  failNextFakeMapSetup,
  fakeMaps,
  lastFakeMap,
  resetFakeMaps,
} from "@/test/helpers/mapbox-gl-fake";

vi.mock("mapbox-gl", async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  return createMapboxGlModuleFake();
});
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

type JsonRecord = Record<string, unknown>;
type AgreementFixture = {
  type: string;
  features: JsonRecord[];
  metadata: JsonRecord;
};

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_MODEL_ID = "33333333-3333-4333-8333-333333333333";
const SECOND_RUN_ID = "44444444-4444-4444-8444-444444444444";
const ARTIFACT_URL = `/api/models/${MODEL_ID}/runs/${RUN_ID}/agreement`;
const SECOND_ARTIFACT_URL =
  `/api/models/${SECOND_MODEL_ID}/runs/${SECOND_RUN_ID}/agreement`;
const FIXTURE_TEXT = readFileSync(
  "../scripts/modeling/tests/fixtures/producer_corridor_agreement_v2.geojson",
  "utf8",
);
const FIXTURE = JSON.parse(FIXTURE_TEXT) as AgreementFixture;
const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
const ORIGINAL_LEGACY_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

let DemandAgreementMap: typeof import("@/components/models/demand-agreement-map").DemandAgreementMap;

function cloneFixture(): AgreementFixture {
  return structuredClone(FIXTURE);
}

function record(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected fixture record");
  }
  return value as JsonRecord;
}

function nested(value: unknown, ...keys: string[]): JsonRecord {
  let current = record(value);
  for (const key of keys) current = record(current[key]);
  return current;
}

function fixtureVerification() {
  const convergence = nested(FIXTURE.metadata, "assignment_convergence");
  const profileDigests = nested(convergence, "assignment_profile_digests");
  const networkEvidence = nested(FIXTURE.metadata, "network_consistency", "evidence");
  const firstSettings = nested(networkEvidence, "network_settings", "first");
  return {
    assignmentProfile: String(profileDigests.first),
    networkSettings: String(firstSettings.digest),
    networkState: String(FIXTURE.metadata.network_state_digest),
  };
}

const VERIFIED = fixtureVerification();

function responseFor(
  payload: unknown,
  options: {
    body?: string;
    omitHeaders?: boolean;
    headers?: Partial<{
      artifact: string;
      assignmentProfile: string;
      networkSettings: string;
      networkState: string;
    }>;
  } = {},
) {
  const body = options.body ?? JSON.stringify(payload);
  const verification = {
    artifact: createHash("sha256").update(body).digest("hex"),
    ...VERIFIED,
    ...options.headers,
  };
  const headers = new Headers();
  if (!options.omitHeaders) {
    headers.set(AGREEMENT_VERIFICATION_HEADERS.artifact, verification.artifact);
    headers.set(
      AGREEMENT_VERIFICATION_HEADERS.assignmentProfile,
      verification.assignmentProfile,
    );
    headers.set(AGREEMENT_VERIFICATION_HEADERS.networkSettings, verification.networkSettings);
    headers.set(AGREEMENT_VERIFICATION_HEADERS.networkState, verification.networkState);
  }
  return {
    ok: true,
    status: 200,
    headers,
    text: async () => body,
  };
}

function mockArtifactFetch(
  payload: unknown,
  options?: Parameters<typeof responseFor>[1],
) {
  global.fetch = vi.fn().mockResolvedValue(responseFor(payload, options)) as unknown as typeof fetch;
}

async function renderArtifact(
  payload: unknown = cloneFixture(),
  options?: Parameters<typeof responseFor>[1],
) {
  mockArtifactFetch(payload, options);
  render(<DemandAgreementMap geojsonUrl={ARTIFACT_URL} />);
  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(ARTIFACT_URL, {
      signal: expect.any(AbortSignal),
      credentials: "same-origin",
      redirect: "error",
      headers: { accept: "application/geo+json" },
    }),
  );
}

async function loadRenderableArtifact(payload: AgreementFixture = cloneFixture()) {
  await renderArtifact(payload);
  await waitFor(() => expect(fakeMaps()).toHaveLength(1));
  const map = lastFakeMap();
  act(() => map.emit("load"));
  return map;
}

async function expectLinksWithheld(copy: RegExp) {
  const status = await screen.findByTestId("demand-agreement-map-withheld");
  expect(status).toHaveTextContent(copy);
  expect(status).toHaveAttribute("role", "status");
  expect(screen.queryByRole("region", { name: "Demand-method link sensitivity map" })).toBeNull();
  expect(fakeMaps()).toHaveLength(0);
}

function featureProperties(artifact: AgreementFixture, index = 0): JsonRecord {
  return nested(artifact.features[index], "properties");
}

function setProfileTarget(
  artifact: AgreementFixture,
  targetGap: number,
  exactPayloadTarget: string,
): string {
  const convergence = nested(artifact.metadata, "assignment_convergence");
  const profiles = nested(convergence, "assignment_profiles");
  const payloads = nested(convergence, "assignment_profile_payloads");
  const digests = nested(convergence, "assignment_profile_digests");
  const convergenceEvidence = nested(convergence, "assignment_profile_evidence");
  const networkEvidence = nested(
    artifact.metadata,
    "network_consistency",
    "evidence",
    "assignment_profiles",
  );
  const originalPayload = String(payloads.first);
  const nextPayload = originalPayload.replace('"target_gap":0.0005', `"target_gap":${exactPayloadTarget}`);
  const digest = createHash("sha256").update(nextPayload).digest("hex");
  for (const side of ["first", "second"] as const) {
    record(profiles[side]).target_gap = targetGap;
    payloads[side] = nextPayload;
    digests[side] = digest;
    for (const evidence of [convergenceEvidence, networkEvidence]) {
      const item = record(evidence[side]);
      record(item.profile).target_gap = targetGap;
      item.payload_json = nextPayload;
      item.digest = digest;
    }
  }
  return digest;
}

function setNetworkSettings(
  artifact: AgreementFixture,
  mutate: (settings: JsonRecord) => void,
): string {
  const settingsBySide = nested(
    artifact.metadata,
    "network_consistency",
    "evidence",
    "network_settings",
  );
  const first = nested(settingsBySide, "first", "settings");
  mutate(first);
  const payload = JSON.stringify(first);
  const digest = createHash("sha256").update(payload).digest("hex");
  for (const side of ["first", "second"] as const) {
    const item = record(settingsBySide[side]);
    item.settings = structuredClone(first);
    item.payload_json = payload;
    item.recorded_payload_json = payload;
    item.digest = digest;
    item.recorded_digest = digest;
  }
  return digest;
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test-token";
  delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  ({ DemandAgreementMap } = await import("@/components/models/demand-agreement-map"));
});

beforeEach(() => {
  resetFakeMaps();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  global.fetch = ORIGINAL_FETCH;
});

afterAll(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  else process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = ORIGINAL_TOKEN;
  if (ORIGINAL_LEGACY_TOKEN === undefined) delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  else process.env.NEXT_PUBLIC_MAPBOX_TOKEN = ORIGINAL_LEGACY_TOKEN;
});

describe("DemandAgreementMap authenticated v2 evidence gate", () => {
  it("renders the real Python producer fixture", async () => {
    const artifact = cloneFixture();
    const map = await loadRenderableArtifact(artifact);
    expect(map.sourceData("demand-agreement")).toEqual(artifact);
    expect(artifact.features.map((feature) => featureProperties({ ...artifact, features: [feature] }).agreement)).toEqual([
      "agree",
      "marginal",
      "diverge",
    ]);
  });

  it("requires every verification header from the authenticated route", async () => {
    await renderArtifact(cloneFixture(), { omitHeaders: true });
    await expectLinksWithheld(/incomplete or contains invalid link geometry or values/i);
  });

  it.each([
    ["assignment profile", { assignmentProfile: "0".repeat(64) }, /same complete assignment method/i],
    ["network settings", { networkSettings: "0".repeat(64) }, /same retained network/i],
    ["network state", { networkState: "0".repeat(64) }, /same retained network/i],
  ] as const)("joins embedded %s evidence to its route header", async (_label, headers, copy) => {
    await renderArtifact(cloneFixture(), { headers });
    await expectLinksWithheld(copy);
  });

  it("keeps a valid loose comparison reachable and explains why its links are withheld", async () => {
    const artifact = cloneFixture();
    const convergence = nested(artifact.metadata, "assignment_convergence");
    convergence.status = "corridors_only";
    convergence.attributable_at = ["corridor"];
    nested(convergence, "gaps").first = 0.002;
    nested(convergence, "gaps").second = 0.003;
    artifact.metadata.attributable_at = ["corridor"];
    artifact.metadata.attribution_is_supportable = false;
    await renderArtifact(artifact);
    await expectLinksWithheld(/did not converge tightly enough for a link-level comparison/i);
  });

  it("pins the consumer convergence limit at 0.001", async () => {
    const artifact = cloneFixture();
    nested(artifact.metadata, "assignment_convergence").required_gap = 0.01;
    await renderArtifact(artifact);
    await expectLinksWithheld(/internally inconsistent/i);
  });

  it("requires link attribution at both the artifact and convergence levels", async () => {
    const artifact = cloneFixture();
    nested(artifact.metadata, "assignment_convergence").attributable_at = ["corridor"];
    await renderArtifact(artifact);
    await expectLinksWithheld(/does not support demand-model attribution at link level/i);
  });

  it("accepts an exact tighter profile payload without browser JSON reserialization", async () => {
    const artifact = cloneFixture();
    const digest = setProfileTarget(artifact, 0.000_000_1, "1e-07");
    const map = await (async () => {
      mockArtifactFetch(artifact, { headers: { assignmentProfile: digest } });
      render(<DemandAgreementMap geojsonUrl={ARTIFACT_URL} />);
      await waitFor(() => expect(fakeMaps()).toHaveLength(1));
      const loaded = lastFakeMap();
      act(() => loaded.emit("load"));
      return loaded;
    })();
    expect(map.sourceData("demand-agreement")).toEqual(artifact);
  });

  it("requires profile payload bytes, parsed profile, embedded copies, and digest to join", async () => {
    const artifact = cloneFixture();
    const convergence = nested(artifact.metadata, "assignment_convergence");
    nested(convergence, "assignment_profile_payloads").second =
      `${nested(convergence, "assignment_profile_payloads").first} `;
    await renderArtifact(artifact);
    await expectLinksWithheld(/same complete assignment method/i);
  });

  it.each([
    ["target gap", (profile: JsonRecord) => { profile.target_gap = 0.0006; }],
    ["iteration ceiling", (profile: JsonRecord) => { profile.max_iterations = 2_999; }],
    ["capacity field", (profile: JsonRecord) => { profile.capacity_field = ""; }],
  ] as const)("rejects an invalid semantic profile %s even with matching exact bytes", async (_label, mutate) => {
    const artifact = cloneFixture();
    const convergence = nested(artifact.metadata, "assignment_convergence");
    const profiles = nested(convergence, "assignment_profiles");
    const first = structuredClone(record(profiles.first));
    mutate(first);
    const payload = JSON.stringify(first);
    const digest = createHash("sha256").update(payload).digest("hex");
    const payloads = nested(convergence, "assignment_profile_payloads");
    const digests = nested(convergence, "assignment_profile_digests");
    const evidenceSets = [
      nested(convergence, "assignment_profile_evidence"),
      nested(artifact.metadata, "network_consistency", "evidence", "assignment_profiles"),
    ];
    for (const side of ["first", "second"] as const) {
      profiles[side] = structuredClone(first);
      payloads[side] = payload;
      digests[side] = digest;
      for (const evidence of evidenceSets) {
        const item = record(evidence[side]);
        item.profile = structuredClone(first);
        item.payload_json = payload;
        item.digest = digest;
      }
    }
    await renderArtifact(artifact, { headers: { assignmentProfile: digest } });
    await expectLinksWithheld(/same complete assignment method/i);
  });

  it.each([
    ["nonpositive factor", (settings: JsonRecord) => { nested(settings, "road_class_factors").primary = 0; }],
    ["boolean factor", (settings: JsonRecord) => { nested(settings, "road_class_factors").primary = true; }],
    ["application", (settings: JsonRecord) => { nested(settings, "application").capacity = "multiply somehow"; }],
    ["exclusion", (settings: JsonRecord) => { settings.excludes = []; }],
  ] as const)("rejects invalid network-settings %s semantics", async (_label, mutate) => {
    const artifact = cloneFixture();
    const digest = setNetworkSettings(artifact, mutate);
    await renderArtifact(artifact, { headers: { networkSettings: digest } });
    await expectLinksWithheld(/same retained network and network settings/i);
  });

  it("requires both observed network-state records to be identical", async () => {
    const artifact = cloneFixture();
    const second = nested(
      artifact.metadata,
      "network_consistency",
      "evidence",
      "network_states",
      "second",
    );
    record(second.record).graph_row_count = 5;
    record(second.recorded_record).graph_row_count = 5;
    await renderArtifact(artifact);
    await expectLinksWithheld(/same retained network and network settings/i);
  });

  it.each([
    ["table coverage", (artifact: AgreementFixture) => {
      nested(artifact.metadata, "network_consistency", "evidence", "table_coverage", "second").exact = false;
    }],
    ["roadway geometry count", (artifact: AgreementFixture) => {
      nested(artifact.metadata, "geometry_alignment").source_roadway_feature_count = 4;
    }],
    ["retained manifest join", (artifact: AgreementFixture) => {
      artifact.metadata.retained_network_manifest = {
        ...record(artifact.metadata.retained_network_manifest),
        roadway_link_ids_digest: "f".repeat(64),
      };
    }],
    ["selected network-state join", (artifact: AgreementFixture) => {
      artifact.metadata.network_state_digest = "f".repeat(64);
    }],
  ] as const)("withholds links when %s is not exact", async (_label, mutate) => {
    const artifact = cloneFixture();
    mutate(artifact);
    await renderArtifact(artifact);
    await expectLinksWithheld(/same retained network and network settings/i);
  });

  it.each([
    ["missing link id", (properties: JsonRecord) => { delete properties.link_id; }],
    ["negative link id", (properties: JsonRecord) => { properties.link_id = -1; }],
    ["unsafe link id", (properties: JsonRecord) => { properties.link_id = Number.MAX_SAFE_INTEGER + 1; }],
    ["jointly forged GEH and class", (properties: JsonRecord) => { properties.geh = 11; properties.agreement = "diverge"; }],
    ["traffic threshold flag", (properties: JsonRecord) => { properties.carries_meaningful_traffic = false; }],
    ["negative volume", (properties: JsonRecord) => { properties.first_volume = -1; }],
  ] as const)("withholds a feature with %s", async (_label, mutate) => {
    const artifact = cloneFixture();
    mutate(featureProperties(artifact));
    await renderArtifact(artifact);
    await expectLinksWithheld(/incomplete or contains invalid link geometry or values/i);
  });

  it("requires unique roadway link identities", async () => {
    const artifact = cloneFixture();
    featureProperties(artifact, 1).link_id = featureProperties(artifact, 0).link_id;
    await renderArtifact(artifact);
    await expectLinksWithheld(/incomplete or contains invalid link geometry or values/i);
  });

  it("requires valid line geometry", async () => {
    const artifact = cloneFixture();
    artifact.features[0].geometry = { type: "Point", coordinates: [-120, 35] };
    await renderArtifact(artifact);
    await expectLinksWithheld(/incomplete or contains invalid link geometry or values/i);
  });

  it("rejects a cross-origin or non-run URL before fetch", async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;
    render(<DemandAgreementMap geojsonUrl="https://evil.example/map.geojson" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/authenticated OpenPlan run route/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("DemandAgreementMap interaction, map errors, and geography", () => {
  it("uses color and line pattern for all three sensitivity classes", async () => {
    const map = await loadRenderableArtifact();
    expect(map.layer("demand-agreement-lines")?.spec.paint).toMatchObject({
      "line-color": [
        "match",
        ["get", "agreement"],
        "agree",
        "#22c55e",
        "marginal",
        "#f59e0b",
        "diverge",
        "#ef4444",
        "#64748b",
      ],
      "line-dasharray": [
        "match",
        ["get", "agreement"],
        "agree",
        ["literal", [1, 0]],
        "marginal",
        ["literal", [3, 1.5]],
        "diverge",
        ["literal", [0.75, 1.5]],
        ["literal", [1, 0]],
      ],
    });
    const legend = screen.getByRole("list", { name: "Demand-method sensitivity classes" });
    expect(legend.querySelector(".border-solid")).not.toBeNull();
    expect(legend.querySelector(".border-dashed")).not.toBeNull();
    expect(legend.querySelector(".border-dotted")).not.toBeNull();
  });

  it("uses producer labels and safe DOM for pointer and click/touch selection", async () => {
    const artifact = cloneFixture();
    const malicious = '<img src=x onerror="alert(1)"> Trip method';
    nested(artifact.metadata, "methods").first = malicious;
    const map = await loadRenderableArtifact(artifact);
    const properties = featureProperties(artifact);
    const event = { features: [{ properties }], lngLat: [-120, 35] };

    act(() => map.emitOnLayer("mousemove", "demand-agreement-lines", event));
    const hover = map.openPopups.at(-1)?.content;
    expect(hover).toHaveTextContent(`${malicious}: 20,000`);
    expect(hover).toHaveTextContent("activity-based: 20,100");
    expect(hover?.querySelector("img")).toBeNull();

    act(() => map.emitOnLayer("click", "demand-agreement-lines", event));
    const selected = map.openPopups.at(-1);
    act(() => map.emitOnLayer("mouseleave", "demand-agreement-lines"));
    expect(selected?.removed).toBe(false);
  });

  it("focuses the real region and starts reverse keyboard inspection at the last link", async () => {
    await loadRenderableArtifact();
    const region = screen.getByRole("region", { name: "Demand-method link sensitivity map" });
    expect(region).toHaveAttribute("tabindex", "0");
    region.focus();
    expect(region).toHaveFocus();
    fireEvent.keyDown(region, { key: "ArrowLeft" });
    expect(screen.getByTestId("demand-agreement-active-detail")).toHaveTextContent(
      "Road 3. trip-based: 10,000. activity-based: 12,000.",
    );
    fireEvent.keyDown(region, { key: "ArrowRight" });
    expect(screen.getByTestId("demand-agreement-active-detail")).toHaveTextContent("Road 1");
  });

  it("surfaces a pre-load Mapbox error instead of leaving a blank map", async () => {
    await renderArtifact();
    await waitFor(() => expect(fakeMaps()).toHaveLength(1));
    const map = lastFakeMap();
    act(() => map.failStyle("Unauthorized map key"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Agreement map failed to load: Unauthorized map key",
    );
    expect(map.removed).toBe(true);
  });

  it("keeps a loaded map visible but surfaces a post-load Mapbox error", async () => {
    const map = await loadRenderableArtifact();
    act(() => map.failStyle("tile request failed"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Part of the agreement map failed after it opened: tile request failed",
    );
    expect(map.removed).toBe(false);
    expect(map.sourceIds()).toContain("demand-agreement");
  });

  it("surfaces a synchronous Mapbox constructor failure", async () => {
    failNextFakeMapConstruction("WebGL is unavailable");
    await renderArtifact();
    expect(await screen.findByRole("alert")).toHaveTextContent("WebGL is unavailable");
    expect(fakeMaps()).toHaveLength(0);
  });

  it("surfaces and cleans up a control/setup failure", async () => {
    failNextFakeMapSetup("Navigation control failed");
    await renderArtifact();
    expect(await screen.findByRole("alert")).toHaveTextContent("Navigation control failed");
    expect(lastFakeMap().removed).toBe(true);
  });

  it("removes the old URL-keyed map and clears its selected detail", async () => {
    const first = cloneFixture();
    const second = cloneFixture();
    featureProperties(second).name = "Replacement road";
    global.fetch = vi.fn(async (input: string | URL | Request) =>
      responseFor(String(input) === SECOND_ARTIFACT_URL ? second : first),
    ) as unknown as typeof fetch;
    const { rerender } = render(<DemandAgreementMap geojsonUrl={ARTIFACT_URL} />);
    await waitFor(() => expect(fakeMaps()).toHaveLength(1));
    const firstMap = lastFakeMap();
    act(() => firstMap.emit("load"));
    const firstRegion = screen.getByRole("region", { name: "Demand-method link sensitivity map" });
    fireEvent.keyDown(firstRegion, { key: "ArrowRight" });
    expect(screen.getByTestId("demand-agreement-active-detail")).toHaveTextContent("Road 1");

    rerender(<DemandAgreementMap geojsonUrl={SECOND_ARTIFACT_URL} />);
    await waitFor(() => expect(firstMap.removed).toBe(true));
    await waitFor(() => expect(fakeMaps()).toHaveLength(2));
    const secondMap = lastFakeMap();
    act(() => secondMap.emit("load"));
    expect(secondMap.sourceData("demand-agreement")).toEqual(second);
    expect(screen.getByTestId("demand-agreement-active-detail")).toHaveTextContent(
      "Use the arrow keys to inspect compared road links.",
    );
  });

  it("fits an antimeridian study area over its short arc", async () => {
    const artifact = cloneFixture();
    artifact.features.forEach((feature, index) => {
      feature.geometry = {
        type: "LineString",
        coordinates: [
          [179.5 + index * 0.1, 52 + index * 0.1],
          [-179.5 + index * 0.1, 52.2 + index * 0.1],
        ],
      };
    });
    const map = await loadRenderableArtifact(artifact);
    const longitudes = map.fitBoundsCalls[0].bounds.positions.map(([longitude]) => longitude);
    expect(Math.max(...longitudes) - Math.min(...longitudes)).toBeCloseTo(1.2);
  });

  it("reduces statewide-scale bounds without spreading or retaining all vertices", async () => {
    const artifact = cloneFixture();
    artifact.features[0].geometry = {
      type: "LineString",
      coordinates: Array.from({ length: 130_000 }, (_, index) => [
        -124 + (index % 1_000) * 0.001,
        32 + (index % 500) * 0.001,
      ]),
    };
    const map = await loadRenderableArtifact(artifact);
    expect(map.fitBoundsCalls[0].bounds.positions).toHaveLength(2);
  });
});

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AGREEMENT_VERIFICATION_HEADERS } from "@/lib/models/demand-agreement-artifact";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const loadModelAccessMock = vi.fn();
const loadArtifactBytesMock = vi.fn();
const authGetUserMock = vi.fn();
const runMaybeSingleMock = vi.fn();
const artifactLimitMock = vi.fn();
const stageMaybeSingleMock = vi.fn();
const runSelectMock = vi.fn();
const artifactSelectMock = vi.fn();
const stageSelectMock = vi.fn();
const runEqMock = vi.fn();
const artifactEqMock = vi.fn();
const stageEqMock = vi.fn();

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_RUN_ID = "22222222-2222-4222-8222-222222222222";
const STAGE_ID = "33333333-3333-4333-8333-333333333333";
const WORKSPACE_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";
const FIXTURE_PATH = "../scripts/modeling/tests/fixtures/producer_corridor_agreement_v2.geojson";
const FIXTURE_BYTES = readFileSync(FIXTURE_PATH);
const FIXTURE = JSON.parse(FIXTURE_BYTES.toString("utf8")) as Record<string, unknown>;
const ARTIFACT_SHA = createHash("sha256").update(FIXTURE_BYTES).digest("hex");

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

type ArtifactRow = {
  artifact_type: string;
  file_url: string;
  content_hash: string;
  file_size_bytes: number;
  metadata_json: Record<string, unknown>;
  stage_id: string | null;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function fixtureMetadata() {
  return FIXTURE.metadata as Record<string, unknown>;
}

function custodyMetadata(): Record<string, unknown> {
  const metadata = fixtureMetadata();
  const convergence = metadata.assignment_convergence as Record<string, unknown>;
  const profiles = convergence.assignment_profiles as Record<string, unknown>;
  const payloads = convergence.assignment_profile_payloads as Record<string, unknown>;
  const profileDigests = convergence.assignment_profile_digests as Record<string, unknown>;
  const consistency = metadata.network_consistency as Record<string, unknown>;
  const evidence = consistency.evidence as Record<string, unknown>;
  const settings = (evidence.network_settings as Record<string, unknown>).first as Record<
    string,
    unknown
  >;
  const state = (evidence.network_states as Record<string, unknown>).first as Record<
    string,
    unknown
  >;
  return {
    kind: "dual_demand_model_agreement",
    is_average: false,
    upload_status: "stored",
    assignment_profile: clone(profiles.first),
    assignment_profile_payload_json: payloads.first,
    assignment_profile_digest: profileDigests.first,
    network_settings: clone(settings.settings),
    network_settings_payload_json: settings.payload_json,
    network_settings_digest: settings.digest,
    network_state_record: clone(state.record),
    network_state_digest: state.digest,
    first_assignment_convergence: {
      final_gap: (convergence.gaps as Record<string, unknown>).first,
      iterations: 29,
      target_gap: (profiles.first as Record<string, unknown>).target_gap,
      max_iterations: (profiles.first as Record<string, unknown>).max_iterations,
      algorithm: (profiles.first as Record<string, unknown>).algorithm,
      converged: true,
      assignment_profile: clone(profiles.first),
      assignment_profile_payload_json: payloads.first,
      assignment_profile_digest: profileDigests.first,
    },
    second_assignment_convergence: {
      final_gap: (convergence.gaps as Record<string, unknown>).second,
      iterations: 31,
      target_gap: (profiles.second as Record<string, unknown>).target_gap,
      max_iterations: (profiles.second as Record<string, unknown>).max_iterations,
      algorithm: (profiles.second as Record<string, unknown>).algorithm,
      converged: true,
      assignment_profile: clone(profiles.second),
      assignment_profile_payload_json: payloads.second,
      assignment_profile_digest: profileDigests.second,
    },
  };
}

function validArtifactRow(): ArtifactRow {
  return {
    artifact_type: "demand_model_agreement_geojson",
    file_url: `storage://run-artifacts/model-runs/${MODEL_RUN_ID}/agreement/corridor_agreement.geojson`,
    content_hash: ARTIFACT_SHA,
    file_size_bytes: FIXTURE_BYTES.byteLength,
    metadata_json: custodyMetadata(),
    stage_id: STAGE_ID,
  };
}

const runBuilder = {
  eq: (...args: unknown[]) => {
    runEqMock(...args);
    return runBuilder;
  },
  maybeSingle: (...args: unknown[]) => runMaybeSingleMock(...args),
};

const artifactBuilder = {
  eq: (...args: unknown[]) => {
    artifactEqMock(...args);
    return artifactBuilder;
  },
  order: () => artifactBuilder,
  limit: (...args: unknown[]) => artifactLimitMock(...args),
};

const stageBuilder = {
  eq: (...args: unknown[]) => {
    stageEqMock(...args);
    return stageBuilder;
  },
  maybeSingle: (...args: unknown[]) => stageMaybeSingleMock(...args),
};

const fromMock = vi.fn((table: string) => {
  if (table === "model_runs") {
    return {
      select: (projection: string) => {
        runSelectMock(projection);
        return runBuilder;
      },
    };
  }
  if (table === "model_run_artifacts") {
    return {
      select: (projection: string) => {
        artifactSelectMock(projection);
        return artifactBuilder;
      },
    };
  }
  if (table === "model_run_stages") {
    return {
      select: (projection: string) => {
        stageSelectMock(projection);
        return stageBuilder;
      },
    };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/models/api", () => ({
  loadModelAccess: (...args: unknown[]) => loadModelAccessMock(...args),
}));

vi.mock("@/app/api/models/[modelId]/runs/[modelRunId]/volumes/artifact-source", () => ({
  loadArtifactBytes: (...args: unknown[]) => loadArtifactBytesMock(...args),
  workerLocalRoot: () => "/srv/worker",
  resolveRunWorkDir: (root: string, runId: string) => `${root}/runs/${runId.slice(0, 12)}`,
}));

import { GET as getAgreement } from "@/app/api/models/[modelId]/runs/[modelRunId]/agreement/route";

function request() {
  return new NextRequest(
    `http://localhost/api/models/${MODEL_ID}/runs/${MODEL_RUN_ID}/agreement`,
  );
}

function context(overrides: { modelId?: string; modelRunId?: string } = {}) {
  return {
    params: Promise.resolve({
      modelId: overrides.modelId ?? MODEL_ID,
      modelRunId: overrides.modelRunId ?? MODEL_RUN_ID,
    }),
  };
}

function setArtifact(row: ArtifactRow | null) {
  artifactLimitMock.mockResolvedValue({ data: row ? [row] : [], error: null });
}

describe("GET authenticated demand agreement artifact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
    loadModelAccessMock.mockResolvedValue({
      model: { id: MODEL_ID, workspace_id: WORKSPACE_ID },
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
      allowed: true,
      error: null,
    });
    runMaybeSingleMock.mockResolvedValue({
      data: { id: MODEL_RUN_ID, status: "succeeded" },
      error: null,
    });
    setArtifact(validArtifactRow());
    stageMaybeSingleMock.mockResolvedValue({
      data: {
        id: STAGE_ID,
        run_id: MODEL_RUN_ID,
        stage_name: "Demand Model Agreement",
        status: "succeeded",
      },
      error: null,
    });
    loadArtifactBytesMock.mockResolvedValue(new Uint8Array(FIXTURE_BYTES));
  });

  it("returns the exact registered Python fixture bytes with all custody headers", async () => {
    const response = await getAgreement(request(), context());

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(FIXTURE_BYTES);
    expect(response.headers.get("content-type")).toBe("application/geo+json; charset=utf-8");
    expect(response.headers.get("content-length")).toBe(String(FIXTURE_BYTES.byteLength));
    expect(response.headers.get(AGREEMENT_VERIFICATION_HEADERS.artifact)).toBe(ARTIFACT_SHA);
    expect(response.headers.get(AGREEMENT_VERIFICATION_HEADERS.assignmentProfile)).toBe(
      custodyMetadata().assignment_profile_digest,
    );
    expect(response.headers.get(AGREEMENT_VERIFICATION_HEADERS.networkSettings)).toBe(
      custodyMetadata().network_settings_digest,
    );
    expect(response.headers.get(AGREEMENT_VERIFICATION_HEADERS.networkState)).toBe(
      custodyMetadata().network_state_digest,
    );
    expect(artifactSelectMock).toHaveBeenCalledWith(
      "artifact_type, file_url, content_hash, file_size_bytes, metadata_json, stage_id",
    );
    expect(runEqMock).toHaveBeenCalledWith("id", MODEL_RUN_ID);
    expect(runEqMock).toHaveBeenCalledWith("model_id", MODEL_ID);
    expect(artifactEqMock).toHaveBeenCalledWith("run_id", MODEL_RUN_ID);
    expect(stageSelectMock).toHaveBeenCalledWith("id, run_id, stage_name, status");
    expect(stageEqMock).toHaveBeenCalledWith("id", STAGE_ID);
    expect(stageEqMock).toHaveBeenCalledWith("run_id", MODEL_RUN_ID);
    expect(loadArtifactBytesMock).toHaveBeenCalledWith(
      validArtifactRow().file_url,
      {
        bucket: "run-artifacts",
        objectPathPrefix: `model-runs/${MODEL_RUN_ID}/`,
        localRoot: `/srv/worker/runs/${MODEL_RUN_ID.slice(0, 12)}`,
      },
    );
  });

  it("rejects an unauthenticated caller before any run or artifact read", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });
    expect((await getAgreement(request(), context())).status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
    expect(loadArtifactBytesMock).not.toHaveBeenCalled();
  });

  it("rejects a caller without workspace read access", async () => {
    loadModelAccessMock.mockResolvedValue({
      model: { id: MODEL_ID, workspace_id: WORKSPACE_ID },
      membership: null,
      allowed: false,
      error: null,
    });
    expect((await getAgreement(request(), context())).status).toBe(403);
    expect(loadArtifactBytesMock).not.toHaveBeenCalled();
  });

  it("does not use a run from another model", async () => {
    runMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    expect((await getAgreement(request(), context())).status).toBe(404);
    expect(runEqMock).toHaveBeenCalledWith("model_id", MODEL_ID);
    expect(loadArtifactBytesMock).not.toHaveBeenCalled();
  });

  it("does not reveal a model that the authenticated user cannot load", async () => {
    loadModelAccessMock.mockResolvedValue({
      model: null,
      membership: null,
      allowed: false,
      error: null,
    });
    expect((await getAgreement(request(), context())).status).toBe(404);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("refuses an incomplete run", async () => {
    runMaybeSingleMock.mockResolvedValue({
      data: { id: MODEL_RUN_ID, status: "running" },
      error: null,
    });
    expect((await getAgreement(request(), context())).status).toBe(400);
    expect(artifactSelectMock).not.toHaveBeenCalled();
  });

  it("404s when this run has no registered agreement artifact", async () => {
    setArtifact(null);
    expect((await getAgreement(request(), context())).status).toBe(404);
    expect(loadArtifactBytesMock).not.toHaveBeenCalled();
  });

  it("propagates an artifact registry read failure without touching storage", async () => {
    artifactLimitMock.mockResolvedValue({ data: null, error: { message: "registry unavailable" } });
    expect((await getAgreement(request(), context())).status).toBe(500);
    expect(loadArtifactBytesMock).not.toHaveBeenCalled();
  });

  it("404s when the scoped byte reader refuses or cannot read the reference", async () => {
    loadArtifactBytesMock.mockRejectedValue(new Error("out of run scope"));
    expect((await getAgreement(request(), context())).status).toBe(404);
  });

  it.each([
    ["byte length", (row: ArtifactRow) => ({ ...row, file_size_bytes: row.file_size_bytes + 1 })],
    ["content hash", (row: ArtifactRow) => ({ ...row, content_hash: "0".repeat(64) })],
    ["stage custody", (row: ArtifactRow) => ({ ...row, stage_id: null })],
  ] as const)("refuses an invalid registered %s", async (_label, mutate) => {
    setArtifact(mutate(validArtifactRow()));
    expect((await getAgreement(request(), context())).status).toBe(422);
  });

  it.each([
    ["another run", { id: STAGE_ID, run_id: "other", stage_name: "Demand Model Agreement", status: "succeeded" }],
    ["another stage", { id: STAGE_ID, run_id: MODEL_RUN_ID, stage_name: "Artifact Extraction", status: "succeeded" }],
    ["unfinished agreement stage", { id: STAGE_ID, run_id: MODEL_RUN_ID, stage_name: "Demand Model Agreement", status: "running" }],
  ] as const)("refuses stage custody from %s", async (_label, stage) => {
    stageMaybeSingleMock.mockResolvedValue({ data: stage, error: null });
    expect((await getAgreement(request(), context())).status).toBe(422);
    expect(loadArtifactBytesMock).not.toHaveBeenCalled();
  });

  it("hashes exact profile payload bytes instead of accepting a semantically equal reserialization", async () => {
    const row = validArtifactRow();
    row.metadata_json = {
      ...row.metadata_json,
      assignment_profile_payload_json: `${row.metadata_json.assignment_profile_payload_json} `,
    };
    setArtifact(row);
    expect((await getAgreement(request(), context())).status).toBe(422);
  });

  it("refuses a stale convergence verdict even when the recorded gap is valid", async () => {
    const row = validArtifactRow();
    (row.metadata_json.first_assignment_convergence as Record<string, unknown>).converged = false;
    setArtifact(row);
    expect((await getAgreement(request(), context())).status).toBe(422);
  });

  it("refuses drifted embedded evidence even when the new raw hash and size are registered", async () => {
    const drifted = clone(FIXTURE);
    const metadata = drifted.metadata as Record<string, unknown>;
    metadata.network_state_digest = "f".repeat(64);
    const bytes = Buffer.from(`${JSON.stringify(drifted)}\n`);
    const row = validArtifactRow();
    row.content_hash = createHash("sha256").update(bytes).digest("hex");
    row.file_size_bytes = bytes.byteLength;
    loadArtifactBytesMock.mockResolvedValue(new Uint8Array(bytes));
    setArtifact(row);

    expect((await getAgreement(request(), context())).status).toBe(422);
  });

  it("computes the actual feature link-id digest instead of trusting the retained manifest", async () => {
    const drifted = clone(FIXTURE);
    const features = drifted.features as Array<Record<string, unknown>>;
    const properties = features[0].properties as Record<string, unknown>;
    properties.link_id = 99;
    const bytes = Buffer.from(`${JSON.stringify(drifted)}\n`);
    const row = validArtifactRow();
    row.content_hash = createHash("sha256").update(bytes).digest("hex");
    row.file_size_bytes = bytes.byteLength;
    loadArtifactBytesMock.mockResolvedValue(new Uint8Array(bytes));
    setArtifact(row);

    expect((await getAgreement(request(), context())).status).toBe(422);
  });

  it("serves a verified loose-convergence artifact so the browser can explain why links are withheld", async () => {
    const loose = clone(FIXTURE);
    const metadata = loose.metadata as Record<string, unknown>;
    const convergence = metadata.assignment_convergence as Record<string, unknown>;
    convergence.status = "corridors_only";
    convergence.attributable_at = ["corridor"];
    (convergence.gaps as Record<string, unknown>).first = 0.002;
    (convergence.gaps as Record<string, unknown>).second = 0.003;
    metadata.attributable_at = ["corridor"];
    metadata.attribution_is_supportable = false;
    const bytes = Buffer.from(`${JSON.stringify(loose)}\n`);
    const row = validArtifactRow();
    row.content_hash = createHash("sha256").update(bytes).digest("hex");
    row.file_size_bytes = bytes.byteLength;
    row.metadata_json = custodyMetadata();
    (row.metadata_json.first_assignment_convergence as Record<string, unknown>).final_gap = 0.002;
    (row.metadata_json.second_assignment_convergence as Record<string, unknown>).final_gap = 0.003;
    (row.metadata_json.first_assignment_convergence as Record<string, unknown>).converged = false;
    (row.metadata_json.second_assignment_convergence as Record<string, unknown>).converged = false;
    loadArtifactBytesMock.mockResolvedValue(new Uint8Array(bytes));
    setArtifact(row);

    const response = await getAgreement(request(), context());
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });
});

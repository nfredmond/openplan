import { render } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * THE CHAIN, END TO END — a processing job whose bytes OpenPlan does NOT hold
 * must not be presentable to a planner as verified evidence.
 *
 * WHY THIS FILE EXISTS AND NOT JUST A UNIT TEST. This repo has repeatedly
 * shipped complete, tested capability that no person could reach. Custody could
 * be written perfectly into `aerial_artifact_custody` and change nothing anyone
 * sees. So the two halves are asserted together:
 *
 *   1. The REAL callback route, with the artifact fetch failing, writes an
 *      evidence package that says `pending` and carries the custody reason in
 *      its own source-context notes — instead of the unconditional `partial` it
 *      used to write whatever happened to the bytes.
 *   2. The REAL mission page, given that row, renders "Verification pending"
 *      where a custody-complete job renders "Partially verified".
 *
 * Without (2), (1) is bookkeeping. Without (1), (2) is decoration.
 */

// ── Part 1 mocks: the callback route ─────────────────────────────────────────

const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const rebuildAerialProjectPostureMock = vi.fn();

const jobMaybeSingleMock = vi.fn();
const ledgerInsertMock = vi.fn();
const jobUpdateEqMock = vi.fn();
const jobUpdateMock = vi.fn();
const evidenceLookupMaybeSingleMock = vi.fn();
const evidenceInsertSingleMock = vi.fn();
const evidenceInsertMock = vi.fn();
const missionTitleMaybeSingleMock = vi.fn();
const custodyUpsertMock = vi.fn();
const custodySelectEqMock = vi.fn();
const storageUploadMock = vi.fn();
const fetchMock = vi.fn();

const audit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const serviceFromMock = vi.fn((table: string) => {
  if (table === "aerial_processing_jobs") {
    return {
      select: () => ({ eq: () => ({ maybeSingle: jobMaybeSingleMock }) }),
      update: jobUpdateMock,
    };
  }
  if (table === "aerial_processing_callbacks") return { insert: ledgerInsertMock };
  if (table === "aerial_evidence_packages") {
    return {
      select: () => ({ eq: () => ({ maybeSingle: evidenceLookupMaybeSingleMock }) }),
      insert: evidenceInsertMock,
    };
  }
  if (table === "aerial_missions") {
    return { select: () => ({ eq: () => ({ maybeSingle: missionTitleMaybeSingleMock }) }) };
  }
  if (table === "aerial_artifact_custody") {
    return { upsert: custodyUpsertMock, select: () => ({ eq: custodySelectEqMock }) };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/aerial/posture-writeback", () => ({
  rebuildAerialProjectPosture: (...args: unknown[]) => rebuildAerialProjectPostureMock(...args),
}));

// ── Part 2 mocks: the mission page ───────────────────────────────────────────

const createClientMock = vi.fn();
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const loadAerialProjectPostureMock = vi.fn();
const loadAerialProcessingJobsForMissionMock = vi.fn();
const pageMissionMaybeSingleMock = vi.fn();
const pagePackagesOrderMock = vi.fn();

function pageMissionChain(): Record<string, unknown> {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: pageMissionMaybeSingleMock };
  return chain;
}
/** Every `.select()` string the page hands the evidence-package query. */
const pagePackageSelects: string[] = [];

function pagePackagesChain(): Record<string, unknown> {
  const chain = {
    select: (columns: string) => {
      pagePackageSelects.push(columns);
      return chain;
    },
    eq: () => chain,
    order: pagePackagesOrderMock,
  };
  return chain;
}

const pageFromMock = vi.fn((table: string) => {
  if (table === "aerial_missions") return pageMissionChain();
  if (table === "aerial_evidence_packages") return pagePackagesChain();
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: () => {
    throw new Error("redirect");
  },
  // The mission page mounts client controls that call useRouter().
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
}));

/**
 * NOTE ON THIS MOCK, because it is the reason this file did not catch the defect
 * it was named for.
 *
 * Mocking `@/lib/aerial/queries` means the page never runs the real custody
 * loader — so when `loadAerialArtifactCustodyForMission` had NO CALLER at all,
 * every assertion in this file still passed. A test that stubs the seam it is
 * meant to prove cannot prove it. The `expect(...).toHaveBeenCalled` below is
 * the minimum repair; the assertions that drive the real loader against a real
 * table live in `aerial-mission-processing-jobs.test.tsx`.
 */
const loadAerialArtifactCustodyForMissionMock = vi.fn((..._args: unknown[]) => ({
  byProcessingJobId: new Map(),
  unreadableReason: null,
}));

vi.mock("@/lib/aerial/queries", () => ({
  loadAerialProjectPosture: (...args: unknown[]) => loadAerialProjectPostureMock(...args),
  AERIAL_PROCESSING_JOB_SELECT: "id",
  loadAerialProcessingJobsForMission: (...args: unknown[]) =>
    loadAerialProcessingJobsForMissionMock(...args),
  loadAerialArtifactCustodyForMission: (...args: unknown[]) =>
    loadAerialArtifactCustodyForMissionMock(...args),
}));

import { POST as postProcessingCallback } from "@/app/api/aerial/processing-callback/route";
import AerialMissionDetailPage from "@/app/(app)/aerial/missions/[missionId]/page";
import { AERIAL_ARTIFACT_MAX_BYTES_ENV } from "@/lib/aerial/artifact-custody";
import { describeAerialProcessingAvailability } from "@/lib/aerial/processing-availability";

const CALLBACK_TOKEN = "callback-secret";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const MISSION_ID = "22222222-2222-4222-8222-222222222222";

const JOB_ROW = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspace_id: WORKSPACE_ID,
  project_id: "44444444-4444-4444-8444-444444444444",
  mission_id: MISSION_ID,
  request_id: "11111111-1111-4111-8111-111111111111",
  job_reference: "worker-job-9",
  status: "accepted",
};

const ARTIFACTS = [
  {
    kind: "orthomosaic",
    downloadUrl: "https://worker.example.net/outputs/ortho.tif?X-Amz-Signature=deadbeefcafe",
    expiresAt: "2099-07-22T14:30:00Z",
    sizeBytes: 4,
    contentType: "image/tiff",
  },
];

function custodyRow(overrides: Record<string, unknown>) {
  return {
    kind: "orthomosaic",
    ordinal: 0,
    state: "held",
    storage_bucket: "aerial-artifacts",
    storage_path: "ws/mission/job/orthomosaic.tif",
    byte_size: 4,
    checksum_sha256: "b".repeat(64),
    content_type: "image/tiff",
    declared_size_bytes: 4,
    source_host: "worker.example.net",
    source_expires_at: "2099-07-22T14:30:00Z",
    failure_code: null,
    failure_detail: null,
    attempt_count: 1,
    held_at: "2026-07-30T00:00:00Z",
    ...overrides,
  };
}

function succeededCallbackRequest() {
  return new NextRequest("http://localhost/api/aerial/processing-callback", {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: "natford-aerial-processing.v1",
      requestId: JOB_ROW.request_id,
      callbackId: "cb-0000000042",
      jobReference: "worker-job-9",
      status: "succeeded",
      occurredAt: "2026-07-30T12:00:00Z",
      artifacts: ARTIFACTS,
    }),
    headers: { "content-type": "application/json", authorization: `Bearer ${CALLBACK_TOKEN}` },
  });
}

function evidencePackageInsert(): Record<string, unknown> {
  return evidenceInsertMock.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe("artifact custody decides what an evidence package may claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENPLAN_AERIAL_PROCESSING_CALLBACK_BEARER_TOKEN = CALLBACK_TOKEN;

    createApiAuditLoggerMock.mockReturnValue(audit);
    createServiceRoleClientMock.mockReturnValue({
      from: serviceFromMock,
      storage: { from: () => ({ upload: storageUploadMock }) },
    });

    jobMaybeSingleMock.mockResolvedValue({ data: { ...JOB_ROW }, error: null });
    ledgerInsertMock.mockResolvedValue({ error: null });
    // The status write ends at `.eq()`; the custody roll-up chains
    // `.select("id")` so it can see whether it changed anything.
    jobUpdateEqMock.mockReturnValue(
      Object.assign(Promise.resolve({ error: null }), {
        select: () => Promise.resolve({ data: [{ id: JOB_ROW.id }], error: null }),
      })
    );
    jobUpdateMock.mockReturnValue({ eq: jobUpdateEqMock });
    evidenceLookupMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    evidenceInsertSingleMock.mockResolvedValue({ data: { id: "pkg-1" }, error: null });
    evidenceInsertMock.mockReturnValue({ select: () => ({ single: evidenceInsertSingleMock }) });
    missionTitleMaybeSingleMock.mockResolvedValue({ data: { title: "Corridor survey" }, error: null });
    rebuildAerialProjectPostureMock.mockResolvedValue({ posture: null, updatedAt: null, error: null });
    custodyUpsertMock.mockResolvedValue({ error: null });
    storageUploadMock.mockResolvedValue({ error: null });

    vi.stubGlobal("fetch", fetchMock);
  });

  it("writes a VERIFICATION-PENDING package, naming the reason, when the bytes could not be taken", async () => {
    fetchMock.mockResolvedValue(new Response("gateway timeout", { status: 504 }));
    custodySelectEqMock.mockResolvedValue({
      data: [
        custodyRow({
          state: "failed",
          storage_bucket: null,
          storage_path: null,
          byte_size: null,
          checksum_sha256: null,
          held_at: null,
          failure_code: "http_error",
          failure_detail: "The orthomosaic could not be taken into OpenPlan's custody: worker.example.net answered HTTP 504 instead of the file.",
        }),
      ],
      error: null,
    });

    const response = await postProcessingCallback(succeededCallbackRequest());
    expect(response.status).toBe(200);

    const insert = evidencePackageInsert();
    expect(insert.verification_readiness).toBe("pending");
    expect(String(insert.notes)).toContain("Artifact custody");
    expect(String(insert.notes)).toContain("only as a time-limited link");
    // The package's own notes must not have become a place the credential lands.
    expect(String(insert.notes)).not.toContain("X-Amz-Signature");
  });

  it("writes a PARTIALLY-VERIFIED package only when every artifact is actually held", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "image/tiff" },
      })
    );
    custodySelectEqMock.mockResolvedValue({ data: [custodyRow({})], error: null });

    const response = await postProcessingCallback(succeededCallbackRequest());
    expect(response.status).toBe(200);

    const insert = evidencePackageInsert();
    expect(insert.verification_readiness).toBe("partial");
    expect(String(insert.notes)).toContain("OpenPlan holds its own copy");
  });

  it("keeps the signed URL out of the job row and out of every audit call", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "image/tiff" } })
    );
    custodySelectEqMock.mockResolvedValue({ data: [custodyRow({})], error: null });

    await postProcessingCallback(succeededCallbackRequest());

    const jobWrite = JSON.stringify(jobUpdateMock.mock.calls);
    expect(jobWrite).not.toContain("X-Amz-Signature");
    expect(jobWrite).not.toContain("deadbeefcafe");
    expect(jobWrite).toContain("worker.example.net");

    const logged = JSON.stringify([
      ...audit.info.mock.calls,
      ...audit.warn.mock.calls,
      ...audit.error.mock.calls,
    ]);
    expect(logged).not.toContain("X-Amz-Signature");
    expect(logged).not.toContain("deadbeefcafe");
    // The custody outcome IS logged — silence would be its own defect.
    expect(logged).toContain("aerial_artifact_custody_pass");
  });
});

describe("what the planner actually sees on the mission page", () => {
  async function renderMissionPage(): Promise<string> {
    const { container } = render(
      await AerialMissionDetailPage({ params: Promise.resolve({ missionId: MISSION_ID }) })
    );
    return container.textContent ?? "";
  }

  beforeEach(() => {
    vi.clearAllMocks();
    pagePackageSelects.length = 0;
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: pageFromMock });
    authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID },
    });
    loadAerialProjectPostureMock.mockResolvedValue({ posture: null, updatedAt: null });
    loadAerialProcessingJobsForMissionMock.mockResolvedValue({ jobs: [], unreadableReason: null });
    // The evidence-package read needs a default here, not only inside the three
    // tests that care what it returns. `vi.clearAllMocks()` clears call history
    // without removing an implementation, so a test that set this persistently
    // was silently lending its value to every test that ran after it — and the
    // custody-call test below set nothing at all. In file order it always ran
    // after one of the setters and passed; under `--sequence.shuffle` it could
    // run first, get `undefined` back, and the page threw on `.data`.
    pagePackagesOrderMock.mockResolvedValue({ data: [], error: null });
    pageMissionMaybeSingleMock.mockResolvedValue({
      data: {
        id: MISSION_ID,
        workspace_id: WORKSPACE_ID,
        project_id: null,
        title: "Corridor survey",
        status: "complete",
        mission_type: "corridor_survey",
        geography_label: null,
        collected_at: null,
        notes: null,
        aoi_geojson: null,
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-02T00:00:00.000Z",
        projects: null,
      },
      error: null,
    });
  });

  function packageRow(verificationReadiness: string) {
    return {
      id: "pkg-1",
      title: "Corridor survey aerial processing outputs",
      package_type: "measurable_output",
      status: "ready",
      verification_readiness: verificationReadiness,
      notes: "Artifact custody: …",
      created_at: "2026-07-30T00:00:00.000Z",
      updated_at: "2026-07-30T00:00:00.000Z",
    };
  }

  it("renders a custody-incomplete package as VERIFICATION PENDING, not as partially verified", async () => {
    pagePackagesOrderMock.mockResolvedValue({ data: [packageRow("pending")], error: null });

    const text = await renderMissionPage();

    expect(text).toContain("Verification pending");
    expect(text).not.toContain("Partially verified");
  });

  it("renders a custody-complete package differently — the two are not the same page", async () => {
    pagePackagesOrderMock.mockResolvedValue({ data: [packageRow("partial")], error: null });

    const text = await renderMissionPage();

    expect(text).toContain("Partially verified");
  });

  /**
   * ASKS THE DATABASE FOR THE COLUMN IT RENDERS.
   *
   * The two assertions above are NOT enough on their own and it is worth being
   * explicit about why. This suite mocks the Supabase client, so the fixture
   * comes back whatever the page projected — drop `verification_readiness` from
   * the page's `.select()` and both of them still pass, while in production the
   * field is `undefined` at runtime (these clients are untyped by convention, so
   * tsc says nothing) and `formatAerialVerificationReadinessLabel` renders
   * "Unknown" for every package forever. The entire custody-to-planner chain
   * would be severed with a green suite. So the projection itself is asserted.
   */
  it("asks the database for the verification column the custody badge is rendered from", async () => {
    pagePackagesOrderMock.mockResolvedValue({ data: [packageRow("pending")], error: null });

    await renderMissionPage();

    expect(pagePackageSelects).toHaveLength(1);
    expect(pagePackageSelects[0]).toContain("verification_readiness");
    // The badge's other two inputs, projected from the same string.
    expect(pagePackageSelects[0]).toContain("status");
    expect(pagePackageSelects[0]).toContain("notes");
  });

  /**
   * NOT ASSERTED ON THE PAGE: the configured-branch processing notice.
   * `describeAerialProcessingAvailability(true)` states the custody ceiling, but
   * the mission page renders only the UNCONFIGURED branch now — a configured
   * deployment gets a request form and a job list instead. Asserting that copy
   * against the page would be asserting something no reader sees, which is the
   * defect this file exists to guard against, arriving from the other side. The
   * copy is checked directly instead.
   */
  it("states this deployment's custody ceiling in the configured-worker notice", () => {
    const notice = describeAerialProcessingAvailability(true, 512 * 1024 * 1024);
    const text = `${notice.title} ${notice.description}`;

    expect(text).toContain("downloads each artifact");
    expect(text).toContain("512 MB");
    expect(text).toContain(AERIAL_ARTIFACT_MAX_BYTES_ENV);
    // The superseded claim, which was false the moment a request form shipped.
    expect(text).not.toMatch(/no request button/i);
  });

  it("actually asks for the custody it renders", async () => {
    // The one assertion this file was missing. Everything else here stubs the
    // loader, so without this the page could stop calling it entirely — which is
    // exactly what had happened — and all seven tests would stay green.
    await renderMissionPage();

    expect(loadAerialArtifactCustodyForMissionMock).toHaveBeenCalled();
  });
});

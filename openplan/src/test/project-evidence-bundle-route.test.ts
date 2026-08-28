import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ProjectEvidenceBundleError } from "@/lib/project-evidence-bundles/archive";
import type { ProjectEvidenceCandidate } from "@/lib/project-evidence-bundles/contracts";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const loadProjectAccessMock = vi.fn();
const loadInventoryMock = vi.fn();
const loadGeneratedMock = vi.fn();
const resolveBytesMock = vi.fn();
const buildBundleMock = vi.fn();
const audit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
  createServiceRoleClient: () => createServiceRoleClientMock(),
}));
vi.mock("@/lib/programs/api", () => ({
  loadProjectAccess: (...args: unknown[]) => loadProjectAccessMock(...args),
}));
vi.mock("@/lib/project-evidence-bundles/inventory", () => ({
  loadProjectEvidenceCandidateInventory: (...args: unknown[]) => loadInventoryMock(...args),
}));
vi.mock("@/lib/project-evidence-bundles/generated-records", () => ({
  loadProjectEvidenceGeneratedFiles: (...args: unknown[]) => loadGeneratedMock(...args),
}));
vi.mock("@/lib/project-evidence-bundles/bytes", () => ({
  resolveProjectEvidenceCandidateBytes: (...args: unknown[]) => resolveBytesMock(...args),
}));
vi.mock("@/lib/project-evidence-bundles/archive", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/project-evidence-bundles/archive")>();
  return { ...actual, buildProjectEvidenceBundle: (...args: unknown[]) => buildBundleMock(...args) };
});
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => audit }));

import { POST } from "@/app/api/projects/[projectId]/evidence-bundles/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_REVISION = "2026-08-26T18:00:00.000Z";
const GPKG_TOKEN = "a".repeat(64);
const REPORT_TOKEN = "b".repeat(64);
const PLAN_ID = "77777777-7777-4777-8777-777777777777";
const PLAN_TOKEN = "f".repeat(64);

function candidate(overrides: Partial<ProjectEvidenceCandidate>): ProjectEvidenceCandidate {
  return {
    id: "report_artifacts:44444444-4444-4444-8444-444444444444",
    sourceId: "report_artifacts",
    sourceLabel: "Reports",
    owningModule: "reports",
    recordId: "44444444-4444-4444-8444-444444444444",
    parentRecordId: "55555555-5555-4555-8555-555555555555",
    projectId: PROJECT_ID,
    title: "Board packet",
    originalFilename: null,
    contentType: "application/pdf",
    byteSize: 3,
    recordedChecksumSha256: null,
    createdAt: PROJECT_REVISION,
    updatedAt: PROJECT_REVISION,
    sourceKind: "pdf",
    sourceVintage: null,
    citation: null,
    retrievalState: "available",
    claimTier: null,
    custodyState: "openplan_stored",
    uncertainty: [],
    knownLimits: [],
    defaultSelected: true,
    required: false,
    selectable: true,
    exclusionReason: null,
    revisionToken: REPORT_TOKEN,
    ...overrides,
  };
}

const GPKG = candidate({
  id: `project_geopackage:${PROJECT_ID}`,
  sourceId: "project_geopackage",
  sourceLabel: "Project record",
  owningModule: "projects",
  recordId: PROJECT_ID,
  parentRecordId: null,
  title: "Project GeoPackage",
  contentType: "application/geopackage+sqlite3",
  byteSize: null,
  retrievalState: "rendered_on_freeze",
  custodyState: "rendered_on_freeze",
  required: true,
  revisionToken: GPKG_TOKEN,
});
const REPORT = candidate({});

function thenableUpdate(calls: unknown[]) {
  const chain = {
    eq(column: string, value: unknown) {
      calls.push([column, value]);
      return chain;
    },
    select() {
      return chain;
    },
    then(resolve: (value: unknown) => void) {
      resolve({ data: [{ id: "bundle" }], error: null });
    },
  };
  return chain;
}

function fakeClient() {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const filters: unknown[] = [];
  return {
    inserts,
    updates,
    filters,
    client: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
      from(table: string) {
        if (table === "plans") {
          const chain = {
            select: () => chain,
            eq: () => chain,
            maybeSingle: async () => ({
              data: { id: PLAN_ID, workspace_id: WORKSPACE_ID, project_id: PROJECT_ID, title: "Mobility plan", status: "active", updated_at: PROJECT_REVISION },
              error: null,
            }),
          };
          return chain;
        }
        if (table !== "project_evidence_bundles") throw new Error(`Unexpected table ${table}`);
        return {
          insert: vi.fn(async (value: unknown) => {
            inserts.push(value);
            return { error: null };
          }),
          update: vi.fn((value: unknown) => {
            updates.push(value);
            return thenableUpdate(filters);
          }),
        };
      },
    },
  };
}

function fakeService(upload: ReturnType<typeof vi.fn>, remove = vi.fn()) {
  const updates: unknown[] = [];
  const filters: unknown[] = [];
  return {
    updates,
    filters,
    client: {
      storage: { from: () => ({ upload, remove }) },
      from(table: string) {
        if (table !== "project_evidence_bundles") throw new Error(`Unexpected service table ${table}`);
        return {
          update: vi.fn((value: unknown) => {
            updates.push(value);
            return thenableUpdate(filters);
          }),
        };
      },
    },
  };
}

function request(
  body?: unknown,
  headers?: Record<string, string>
) {
  const base = {
    projectRevision: PROJECT_REVISION,
    confirmed: true,
    selectedPlanId: PLAN_ID,
    selectedPlanRevisionToken: PLAN_TOKEN,
    selected: [
      { candidateId: GPKG.id, revisionToken: GPKG_TOKEN },
      { candidateId: REPORT.id, revisionToken: REPORT_TOKEN },
    ],
  };
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/evidence-bundles`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body && typeof body === "object" ? { ...base, ...body } : base),
  });
}

const context = { params: Promise.resolve({ projectId: PROJECT_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  loadProjectAccessMock.mockResolvedValue({
    project: { id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: "Main Street", updated_at: PROJECT_REVISION },
    membership: { workspace_id: WORKSPACE_ID, role: "member" },
    allowed: true,
    error: null,
  });
  loadInventoryMock.mockResolvedValue({
    projectId: PROJECT_ID,
    projectRevision: PROJECT_REVISION,
    candidates: [GPKG, REPORT],
    sourceOutcomes: {},
    inventoryTruncated: false,
    limits: {
      reviewCandidateLimit: 500,
      selectedFileLimit: 200,
      perFileBytes: 50 * 1024 * 1024,
      totalSelectedFileBytes: 100 * 1024 * 1024,
    },
    priorBundles: [],
    linkedPlans: [{ id: PLAN_ID, title: "Mobility plan", status: "active", updatedAt: PROJECT_REVISION, revisionToken: PLAN_TOKEN }],
    readFailed: false,
    failureMessage: null,
  });
  loadGeneratedMock.mockResolvedValue({ projectRecord: {}, files: [] });
  resolveBytesMock.mockResolvedValue({
    candidate: REPORT,
    bytes: Buffer.from("pdf"),
    filename: "report.pdf",
    contentType: "application/pdf",
  });
  buildBundleMock.mockResolvedValue({
    bytes: Buffer.from("zip"),
    manifest: { schemaVersion: "project_evidence_manifest.v2" },
    manifestSha256: "c".repeat(64),
    checksumsSha256: "d".repeat(64),
  });
});

describe("POST /api/projects/[projectId]/evidence-bundles", () => {
  it("executable-refuses an assistant before opening the database", async () => {
    const response = await POST(
      request(undefined, { "x-openplan-assistant-execution-source": "planner_agent_quick_link" }),
      context
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "human_review_required" });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("lets a viewer review but refuses retained artifact creation", async () => {
    const fake = fakeClient();
    createClientMock.mockResolvedValue(fake.client);
    loadProjectAccessMock.mockResolvedValue({
      project: { id: PROJECT_ID, workspace_id: WORKSPACE_ID, updated_at: PROJECT_REVISION },
      membership: { workspace_id: WORKSPACE_ID, role: "viewer" },
      allowed: true,
      error: null,
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(403);
    expect(fake.inserts).toEqual([]);
  });

  it("refuses generation when any source read failed", async () => {
    const fake = fakeClient();
    createClientMock.mockResolvedValue(fake.client);
    loadInventoryMock.mockResolvedValue({
      ...(await loadInventoryMock()),
      readFailed: true,
      failureMessage: "Reports: connection dropped",
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "source_read_failed" });
    expect(fake.inserts).toEqual([]);
  });

  it("returns stale_review when the project revision or candidate token changed", async () => {
    const fake = fakeClient();
    createClientMock.mockResolvedValue(fake.client);
    const staleProject = await POST(
      request({
        projectRevision: "2026-08-26T17:00:00.000Z",
        confirmed: true,
        selected: [{ candidateId: GPKG.id, revisionToken: GPKG_TOKEN }],
      }),
      context
    );
    expect(staleProject.status).toBe(409);

    const staleToken = await POST(
      request({
        projectRevision: PROJECT_REVISION,
        confirmed: true,
        selected: [{ candidateId: GPKG.id, revisionToken: "e".repeat(64) }],
      }),
      context
    );
    expect(staleToken.status).toBe(409);
    expect(fake.inserts).toEqual([]);
  });

  it("records an atomic failed row and uploads nothing when selected bytes disappear", async () => {
    const fake = fakeClient();
    createClientMock.mockResolvedValue(fake.client);
    const upload = vi.fn();
    const service = fakeService(upload);
    createServiceRoleClientMock.mockReturnValue(service.client);
    resolveBytesMock.mockRejectedValue(
      new ProjectEvidenceBundleError("missing_evidence", "The selected report disappeared.")
    );

    const response = await POST(request(), context);
    expect(response.status).toBe(422);
    expect(upload).not.toHaveBeenCalled();
    expect(fake.updates).toEqual([]);
    expect(service.updates).toContainEqual(
      expect.objectContaining({ status: "failed", failure_code: "missing_evidence" })
    );
  });

  it("stores the exact scoped path and finalizes only after the private upload succeeds", async () => {
    const fake = fakeClient();
    createClientMock.mockResolvedValue(fake.client);
    const upload = vi.fn().mockResolvedValue({ error: null });
    const service = fakeService(upload);
    createServiceRoleClientMock.mockReturnValue(service.client);

    const response = await POST(request(), context);
    expect(response.status).toBe(201);
    const payload = await response.json() as { bundleId: string; downloadHref: string };
    expect(payload.downloadHref).toBe(`/api/projects/${PROJECT_ID}/evidence-bundles/${payload.bundleId}/download`);
    expect(fake.inserts[0]).toMatchObject({
      workspace_id: WORKSPACE_ID,
      project_id: PROJECT_ID,
      project_revision: PROJECT_REVISION,
      selected_count: 1,
      generated_by: USER_ID,
      status: "preparing",
    });
    expect(upload).toHaveBeenCalledWith(
      `${WORKSPACE_ID}/${PROJECT_ID}/${payload.bundleId}.zip`,
      Buffer.from("zip"),
      { contentType: "application/zip", upsert: false }
    );
    expect(fake.updates).toEqual([]);
    expect(service.updates).toContainEqual(
      expect.objectContaining({
        status: "ready",
        storage_bucket: "project-evidence-bundles",
        storage_path: `${WORKSPACE_ID}/${PROJECT_ID}/${payload.bundleId}.zip`,
        manifest_sha256: "c".repeat(64),
        checksums_sha256: "d".repeat(64),
      })
    );
  });
});

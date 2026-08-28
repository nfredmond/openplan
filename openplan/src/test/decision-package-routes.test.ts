import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const loadProjectAccessMock = vi.fn();
const loadInventoryMock = vi.fn();
const readinessMock = vi.fn();
const freshnessMock = vi.fn();
const storageDownloadMock = vi.fn();
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
vi.mock("@/lib/project-evidence-bundles/decision-package-readiness", () => ({
  decisionPackageReadiness: (...args: unknown[]) => readinessMock(...args),
  decisionPackageFreshness: (...args: unknown[]) => freshnessMock(...args),
}));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => audit }));

import { POST as submitPackage } from "@/app/api/projects/[projectId]/decision-packages/route";
import {
  GET as downloadReceipt,
  POST as decidePackage,
} from "@/app/api/projects/[projectId]/decision-packages/[submissionId]/decision/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const APPROVER_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const BUNDLE_ID = "55555555-5555-4555-8555-555555555555";
const SUBMISSION_ID = "66666666-6666-4666-8666-666666666666";
const ZIP_BYTES = Buffer.from("governed decision package zip");
const BUNDLE_HASH = createHash("sha256").update(ZIP_BYTES).digest("hex");
const PROJECT_REVISION = "2026-08-27T12:00:00.000Z";
const STORAGE_PATH = `${WORKSPACE_ID}/${PROJECT_ID}/${BUNDLE_ID}.zip`;

type FakeState = {
  bundle?: Record<string, unknown> | null;
  receipt?: { receipt_canonical_json: string; receipt_sha256: string } | null;
  submissionInsertError?: { message: string } | null;
  decisionInsertError?: { message: string } | null;
};

function readChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => result),
  };
  return chain;
}

function insertChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(() => chain),
    single: vi.fn(async () => result),
  };
  return chain;
}

function fakeClient(state: FakeState = {}) {
  const submissionInserts: unknown[] = [];
  const decisionInserts: unknown[] = [];
  const bundle = state.bundle === undefined
    ? {
        id: BUNDLE_ID,
        bundle_sha256: BUNDLE_HASH,
        project_revision: PROJECT_REVISION,
        manifest_json: { schemaVersion: "project_evidence_manifest.v2" },
        status: "ready",
        storage_bucket: "project-evidence-bundles",
        storage_path: STORAGE_PATH,
        byte_count: ZIP_BYTES.length,
      }
    : state.bundle;
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
    from: vi.fn((table: string) => {
      if (table === "project_evidence_bundles") {
        return readChain({ data: bundle, error: null });
      }
      if (table === "project_decision_package_submissions") {
        return {
          insert: vi.fn((value: unknown) => {
            submissionInserts.push(value);
            return insertChain(
              state.submissionInsertError
                ? { data: null, error: state.submissionInsertError }
                : { data: { id: SUBMISSION_ID }, error: null },
            );
          }),
        };
      }
      if (table === "project_decision_package_decisions") {
        return {
          ...readChain({ data: state.receipt ?? null, error: null }),
          insert: vi.fn((value: unknown) => {
            decisionInserts.push(value);
            return insertChain(
              state.decisionInsertError
                ? { data: null, error: state.decisionInsertError }
                : { data: { id: "77777777-7777-4777-8777-777777777777", receipt_sha256: "a".repeat(64) }, error: null },
            );
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  };
  return { client, submissionInserts, decisionInserts };
}

function submitRequest(headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/decision-packages`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      bundleId: BUNDLE_ID,
      bundleSha256: BUNDLE_HASH,
      assignedApproverId: APPROVER_ID,
    }),
  });
}

function decisionRequest(
  decision: "approved" | "returned",
  headers: Record<string, string> = {},
) {
  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/decision-packages/${SUBMISSION_ID}/decision`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        bundleId: BUNDLE_ID,
        bundleSha256: BUNDLE_HASH,
        decision,
        reason: decision === "returned" ? "Freeze a current package." : null,
      }),
    },
  );
}

const submitContext = { params: Promise.resolve({ projectId: PROJECT_ID }) };
const decisionContext = { params: Promise.resolve({ projectId: PROJECT_ID, submissionId: SUBMISSION_ID }) };

function requireResponse(response: Response | undefined): Response {
  if (!response) throw new Error("route returned no response");
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
  readinessMock.mockReturnValue(null);
  freshnessMock.mockReturnValue(null);
  loadInventoryMock.mockResolvedValue({ projectRevision: PROJECT_REVISION });
  loadProjectAccessMock.mockResolvedValue({
    project: { id: PROJECT_ID, workspace_id: WORKSPACE_ID, updated_at: PROJECT_REVISION },
    membership: { workspace_id: WORKSPACE_ID, role: "owner" },
    allowed: true,
    error: null,
  });
  storageDownloadMock.mockResolvedValue({ data: new Blob([ZIP_BYTES]), error: null });
  createServiceRoleClientMock.mockReturnValue({
    storage: { from: vi.fn(() => ({ download: storageDownloadMock })) },
  });
});

describe("governed decision package write routes", () => {
  it("executable-refuses assistant submission and decision before authentication", async () => {
    const headers = { "x-openplan-assistant-execution-source": "planner_agent_quick_link" };
    const submitResponse = requireResponse(await submitPackage(submitRequest(headers), submitContext));
    const decisionResponse = await decidePackage(decisionRequest("approved", headers), decisionContext);
    expect(submitResponse.status).toBe(403);
    expect(decisionResponse.status).toBe(403);
    expect(await submitResponse.json()).toMatchObject({ error: "human_review_required" });
    expect(await decisionResponse.json()).toMatchObject({ error: "human_review_required" });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("runs shared readiness and freshness checks before submitting", async () => {
    const fake = fakeClient();
    createClientMock.mockResolvedValue(fake.client);
    const response = requireResponse(await submitPackage(submitRequest(), submitContext));
    expect(response.status).toBe(201);
    expect(readinessMock).toHaveBeenCalledTimes(1);
    expect(freshnessMock).toHaveBeenCalledTimes(1);
    expect(storageDownloadMock).toHaveBeenCalledWith(STORAGE_PATH);
    expect(fake.submissionInserts).toEqual([
      expect.objectContaining({
        bundle_id: BUNDLE_ID,
        bundle_sha256: BUNDLE_HASH,
        submitted_by: USER_ID,
        assigned_approver_id: APPROVER_ID,
      }),
    ]);
  });

  it("refuses submission when the stored ZIP bytes do not match the retained hash", async () => {
    const fake = fakeClient();
    createClientMock.mockResolvedValue(fake.client);
    storageDownloadMock.mockResolvedValueOnce({ data: new Blob(["altered"]), error: null });
    const response = requireResponse(await submitPackage(submitRequest(), submitContext));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/ZIP bytes.*SHA-256/i);
    expect(fake.submissionInserts).toEqual([]);
  });

  it("blocks stale approval but still permits the assigned reviewer to return it", async () => {
    freshnessMock.mockReturnValue("The project record changed after this bundle was frozen.");
    const staleFake = fakeClient();
    createClientMock.mockResolvedValueOnce(staleFake.client);
    const approval = await decidePackage(decisionRequest("approved"), decisionContext);
    expect(approval.status).toBe(409);
    expect(staleFake.decisionInserts).toEqual([]);
    expect(storageDownloadMock).not.toHaveBeenCalled();

    readinessMock.mockReturnValue("Freeze a current v2 evidence bundle.");
    const returnFake = fakeClient();
    createClientMock.mockResolvedValueOnce(returnFake.client);
    const returned = await decidePackage(decisionRequest("returned"), decisionContext);
    expect(returned.status).toBe(201);
    expect(readinessMock).toHaveBeenCalledTimes(1);
    expect(loadInventoryMock).toHaveBeenCalledTimes(1);
    expect(storageDownloadMock).not.toHaveBeenCalled();
    expect(returnFake.decisionInserts).toEqual([
      expect.objectContaining({ decision: "returned", reason: "Freeze a current package." }),
    ]);
  });

  it("verifies the stored ZIP before approval and refuses altered bytes", async () => {
    const fake = fakeClient();
    createClientMock.mockResolvedValue(fake.client);
    storageDownloadMock.mockResolvedValueOnce({ data: new Blob(["altered"]), error: null });
    const response = await decidePackage(decisionRequest("approved"), decisionContext);
    expect(response.status).toBe(409);
    expect(fake.decisionInserts).toEqual([]);
  });

  it("inserts approval only after readiness, freshness, and stored bytes all verify", async () => {
    const fake = fakeClient();
    createClientMock.mockResolvedValue(fake.client);
    const response = await decidePackage(decisionRequest("approved"), decisionContext);
    expect(response.status).toBe(201);
    expect(readinessMock).toHaveBeenCalledTimes(1);
    expect(freshnessMock).toHaveBeenCalledTimes(1);
    expect(storageDownloadMock).toHaveBeenCalledWith(STORAGE_PATH);
    expect(fake.decisionInserts).toEqual([
      expect.objectContaining({ decision: "approved", bundle_sha256: BUNDLE_HASH }),
    ]);
  });
});

describe("governed decision receipt download", () => {
  it("returns the exact canonical JSON bytes covered by the receipt SHA header", async () => {
    const canonical = '{"decision":"approved","schemaVersion":"project_decision_package_receipt.v1"}';
    const receiptSha256 = createHash("sha256").update(canonical).digest("hex");
    const fake = fakeClient({ receipt: { receipt_canonical_json: canonical, receipt_sha256: receiptSha256 } });
    createClientMock.mockResolvedValue(fake.client);
    const request = new NextRequest(
      `http://localhost/api/projects/${PROJECT_ID}/decision-packages/${SUBMISSION_ID}/decision`,
    );
    const response = await downloadReceipt(request, decisionContext);
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(bytes.equals(Buffer.from(canonical))).toBe(true);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(receiptSha256);
    expect(response.headers.get("x-openplan-receipt-sha256")).toBe(receiptSha256);
  });

  it("refuses a stored receipt whose recorded SHA does not cover its canonical bytes", async () => {
    const canonical = '{"decision":"approved"}';
    const fake = fakeClient({
      receipt: { receipt_canonical_json: canonical, receipt_sha256: "0".repeat(64) },
    });
    createClientMock.mockResolvedValue(fake.client);
    const request = new NextRequest(
      `http://localhost/api/projects/${PROJECT_ID}/decision-packages/${SUBMISSION_ID}/decision`,
    );
    const response = await downloadReceipt(request, decisionContext);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/exact-hash verification/i);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const createSignedUrlMock = vi.fn();

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const REPORT_ID = "33333333-3333-4333-8333-333333333333";
const ARTIFACT_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_REPORT_ID = "55555555-5555-4555-8555-555555555555";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

let reportRow: Record<string, unknown> | null;
let membershipRow: Record<string, unknown> | null;
let artifactRow: Record<string, unknown> | null;

function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {
    eq: () => builder,
    maybeSingle: async () => result,
  };
  return builder;
}

const fromMock = vi.fn((table: string) => {
  if (table === "reports") return { select: () => chain({ data: reportRow, error: null }) };
  if (table === "workspace_members") return { select: () => chain({ data: membershipRow, error: null }) };
  if (table === "report_artifacts") return { select: () => chain({ data: artifactRow, error: null }) };
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { GET as downloadArtifact } from "@/app/api/reports/[reportId]/artifacts/[artifactId]/download/route";

/**
 * Until this route existed, `/api/reports/[reportId]/generate` uploaded PDFs to
 * the private `report-artifacts` bucket and set `latest_artifact_url` to an
 * in-app anchor pointing at a ROW IN AN AUDIT TABLE. There was no signed-URL
 * route anywhere under `/api/reports`, so a generated PDF landed in storage
 * that nothing could ever retrieve.
 *
 * `report_artifacts` INSERT is member-writable (its RLS checks only
 * report -> workspace membership), so `storage_path` is caller-influenced data
 * and confinement is load-bearing, not defence in depth.
 */

function request() {
  return new NextRequest(
    `http://localhost/api/reports/${REPORT_ID}/artifacts/${ARTIFACT_ID}/download`,
    { method: "GET" }
  );
}

function ctx(over: { reportId?: string; artifactId?: string } = {}) {
  return {
    params: Promise.resolve({
      reportId: over.reportId ?? REPORT_ID,
      artifactId: over.artifactId ?? ARTIFACT_ID,
    }),
  };
}

describe("GET /api/reports/[reportId]/artifacts/[artifactId]/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: "https://storage.example/signed?token=abc" },
      error: null,
    });
    createServiceRoleClientMock.mockReturnValue({
      storage: { from: () => ({ createSignedUrl: createSignedUrlMock }) },
    });

    reportRow = {
      id: REPORT_ID,
      workspace_id: WORKSPACE_ID,
      project_id: null,
      title: "Nevada County RTP Packet",
      status: "generated",
      report_type: "board_packet",
      generated_at: "2026-07-24T10:00:00.000Z",
      latest_artifact_url: null,
      latest_artifact_kind: "pdf",
    };
    membershipRow = { workspace_id: WORKSPACE_ID, role: "member" };
    artifactRow = {
      id: ARTIFACT_ID,
      report_id: REPORT_ID,
      artifact_kind: "pdf",
      storage_path: `${WORKSPACE_ID}/${REPORT_ID}/${ARTIFACT_ID}.pdf`,
      generated_at: "2026-07-24T10:00:00.000Z",
      metadata_json: {},
    };
  });

  it("redirects to a short-lived signed URL with a recognisable filename", async () => {
    const response = await downloadArtifact(request(), ctx());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://storage.example/signed?token=abc");
    expect(createSignedUrlMock).toHaveBeenCalledWith(
      `${WORKSPACE_ID}/${REPORT_ID}/${ARTIFACT_ID}.pdf`,
      900,
      { download: "nevada-county-rtp-packet-2026-07-24.pdf" }
    );
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });
    expect((await downloadArtifact(request(), ctx())).status).toBe(401);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a report that does not exist", async () => {
    reportRow = null;
    expect((await downloadArtifact(request(), ctx())).status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-member", async () => {
    membershipRow = null;
    expect((await downloadArtifact(request(), ctx())).status).toBe(403);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an artifact that belongs to no artifact row", async () => {
    artifactRow = null;
    expect((await downloadArtifact(request(), ctx())).status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("rejects malformed route params before touching the database", async () => {
    const response = await downloadArtifact(request(), ctx({ artifactId: "not-a-uuid" }));
    expect(response.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  describe("storage-path confinement", () => {
    const OUT_OF_SCOPE = [
      // Another workspace's prefix entirely.
      `99999999-9999-4999-8999-999999999999/${REPORT_ID}/${ARTIFACT_ID}.pdf`,
      // This workspace, but a DIFFERENT report.
      `${WORKSPACE_ID}/${OTHER_REPORT_ID}/${ARTIFACT_ID}.pdf`,
      // Traversal out of the prefix.
      `${WORKSPACE_ID}/${REPORT_ID}/../../secrets/all.pdf`,
      // Absolute path.
      `/${WORKSPACE_ID}/${REPORT_ID}/${ARTIFACT_ID}.pdf`,
      // A storage:// ref pointing at a different bucket.
      `storage://run-artifacts/${WORKSPACE_ID}/${REPORT_ID}/${ARTIFACT_ID}.pdf`,
    ];

    it.each(OUT_OF_SCOPE)("refuses to sign %s", async (storagePath) => {
      artifactRow = { ...(artifactRow as object), storage_path: storagePath };

      const response = await downloadArtifact(request(), ctx());

      expect(response.status).toBe(404);
      // The important half: it must never reach the signer.
      expect(createSignedUrlMock).not.toHaveBeenCalled();
      expect(mockAudit.warn).toHaveBeenCalledWith(
        "report_artifact_ref_out_of_scope",
        expect.objectContaining({ artifactId: ARTIFACT_ID })
      );
    });

    it("accepts an in-scope storage:// ref for the right bucket", async () => {
      artifactRow = {
        ...(artifactRow as object),
        storage_path: `storage://report-artifacts/${WORKSPACE_ID}/${REPORT_ID}/${ARTIFACT_ID}.pdf`,
      };

      expect((await downloadArtifact(request(), ctx())).status).toBe(307);
    });

    it("refuses a path whose extension contradicts the recorded artifact kind", async () => {
      artifactRow = {
        ...(artifactRow as object),
        artifact_kind: "pdf",
        storage_path: `${WORKSPACE_ID}/${REPORT_ID}/${ARTIFACT_ID}.html`,
      };

      expect((await downloadArtifact(request(), ctx())).status).toBe(404);
      expect(createSignedUrlMock).not.toHaveBeenCalled();
    });
  });

  it("returns 500 when the signer fails, rather than a broken redirect", async () => {
    createSignedUrlMock.mockResolvedValue({ data: null, error: { message: "bucket gone" } });
    expect((await downloadArtifact(request(), ctx())).status).toBe(500);
  });

  describe("inline HTML artifacts", () => {
    beforeEach(() => {
      artifactRow = {
        id: ARTIFACT_ID,
        report_id: REPORT_ID,
        artifact_kind: "html",
        storage_path: null,
        generated_at: "2026-07-24T10:00:00.000Z",
        metadata_json: { htmlContent: "<h1>Packet</h1>" },
      };
    });

    it("serves stored HTML as a sandboxed attachment", async () => {
      const response = await downloadArtifact(request(), ctx());

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("<h1>Packet</h1>");
      // Never executes against this origin.
      expect(response.headers.get("content-disposition")).toContain("attachment");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toBe("sandbox");
      expect(createSignedUrlMock).not.toHaveBeenCalled();
    });

    it("says a recorded artifact has no file rather than 404ing as if it did not exist", async () => {
      artifactRow = { ...(artifactRow as object), artifact_kind: "pdf", metadata_json: {} };

      const response = await downloadArtifact(request(), ctx());

      expect(response.status).toBe(409);
      expect(((await response.json()) as { error: string }).error).toMatch(/Regenerate the report/);
    });
  });
});

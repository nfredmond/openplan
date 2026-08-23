import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { REPORT_AERIAL_ORTHO_CAVEAT } from "@/lib/reports/aerial-ortho-evidence";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const downloadMock = vi.fn();
const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const REPORT_ID = "44444444-4444-4444-8444-444444444444";
const ARTIFACT_ID = "55555555-5555-4555-8555-555555555555";
const CUSTODY_ID = "66666666-6666-4666-8666-666666666666";
const MISSION_ID = "77777777-7777-4777-8777-777777777777";

let artifactMetadata: Record<string, unknown>;
function chain(data: unknown) {
  const value = { eq: () => value, maybeSingle: async () => ({ data, error: null }) };
  return value;
}
const fromMock = vi.fn((table: string) => {
  if (table === "reports") return { select: () => chain({ id: REPORT_ID, workspace_id: WORKSPACE_ID, project_id: PROJECT_ID, title: "Packet" }) };
  if (table === "workspace_members") return { select: () => chain({ workspace_id: WORKSPACE_ID, role: "member" }) };
  if (table === "report_artifacts") return { select: () => chain({ id: ARTIFACT_ID, report_id: REPORT_ID, metadata_json: artifactMetadata }) };
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { GET } from "@/app/api/reports/[reportId]/artifacts/[artifactId]/aerial/[custodyId]/route";

function snapshot() {
  const frozenBytes = new Uint8Array(100).fill(7);
  const checksum = createHash("sha256").update(frozenBytes).digest("hex");
  return {
    schemaVersion: "openplan.report_aerial_ortho.v1",
    reportId: REPORT_ID,
    artifactId: ARTIFACT_ID,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    custodyId: CUSTODY_ID,
    missionId: MISSION_ID,
    missionTitle: "River flight",
    projectName: "River project",
    sourceChecksumSha256: checksum,
    frozenChecksumSha256: checksum,
    byteSize: 100,
    collectedAt: "2026-08-20T00:00:00.000Z",
    heldAt: "2026-08-22T00:00:00.000Z",
    frozenAt: "2026-08-23T00:00:00.000Z",
    bounds: [-121.2, 39.1, -121.1, 39.2],
    nativeCrs: null,
    pixelSizeM: 0.1,
    storageBucket: "report-artifacts",
    storagePath: `${WORKSPACE_ID}/${REPORT_ID}/${ARTIFACT_ID}/aerial/${CUSTODY_ID}.png`,
    contentType: "image/png",
    caveat: REPORT_AERIAL_ORTHO_CAVEAT,
  };
}

describe("authenticated frozen report aerial preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    artifactMetadata = { aerialOrthoSnapshotsV1: [snapshot()] };
    createClientMock.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) }, from: fromMock });
    downloadMock.mockResolvedValue({ data: new Blob([new Uint8Array(100).fill(7)], { type: "image/png" }), error: null });
    createServiceRoleClientMock.mockReturnValue({ storage: { from: () => ({ download: downloadMock }) } });
  });

  it("serves only bytes matching the path, size, and hash certified by the frozen snapshot", async () => {
    const response = await GET(new NextRequest("http://localhost/preview"), { params: Promise.resolve({ reportId: REPORT_ID, artifactId: ARTIFACT_ID, custodyId: CUSTODY_ID }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(downloadMock).toHaveBeenCalledWith(`${WORKSPACE_ID}/${REPORT_ID}/${ARTIFACT_ID}/aerial/${CUSTODY_ID}.png`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(100).fill(7));
  });

  it("refuses altered snapshot metadata before reading storage", async () => {
    artifactMetadata = { aerialOrthoSnapshotsV1: [{ ...snapshot(), caveat: "Survey-grade." }] };
    const response = await GET(new NextRequest("http://localhost/preview"), { params: Promise.resolve({ reportId: REPORT_ID, artifactId: ARTIFACT_ID, custodyId: CUSTODY_ID }) });
    expect(response.status).toBe(422);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("refuses stored bytes that no longer match the frozen hash", async () => {
    downloadMock.mockResolvedValue({ data: new Blob([new Uint8Array(100).fill(8)], { type: "image/png" }), error: null });
    const response = await GET(new NextRequest("http://localhost/preview"), { params: Promise.resolve({ reportId: REPORT_ID, artifactId: ARTIFACT_ID, custodyId: CUSTODY_ID }) });
    expect(response.status).toBe(422);
  });
});

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as publishedGET } from "@/app/api/public/land-use-plans/[planId]/map/[designationId]/route";
import { GET as reviewGET } from "@/app/api/public/land-use-plan-reviews/[shareToken]/map/[designationId]/route";
import { GET as reportGET } from "@/app/api/reports/[reportId]/land-use-map/[designationId]/route";

const mocks = vi.hoisted(() => ({
  published: vi.fn(), review: vi.fn(), map: vi.fn(), create: vi.fn(),
  auth: vi.fn(), access: vi.fn(), snapshot: vi.fn(), artifact: vi.fn(),
}));
vi.mock("@/lib/land-use-plans/public", () => ({
  loadPublishedLandUsePlanPacket: mocks.published, loadPublicLandUsePlanReviewPacket: mocks.review,
}));
vi.mock("@/lib/land-use-plans/public-map", () => ({ loadPublicDesignationMap: mocks.map }));
vi.mock("@/lib/land-use-plans/report-snapshot", () => ({ loadAdoptedReportSnapshot: mocks.snapshot }));
vi.mock("@/lib/reports/api", () => ({ loadReportAccess: mocks.access }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.create }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ info: vi.fn() }) }));

const id = (n: number) => `44000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const planId = id(1), designationId = id(2), reportId = id(3), workspaceId = id(4), actorId = id(5), versionId = id(6);
const shareToken = "a".repeat(48);
const frozen = { synthetic: "exact retained packet" };
const contentHash = "b".repeat(64);
const artifactMetadata = { synthetic: "retained artifact metadata" };
const report = { id: reportId, workspace_id: workspaceId };
const session = {
  auth: { getUser: mocks.auth },
  from(table: string) {
    if (table !== "report_artifacts") throw new Error(`Unexpected synthetic table ${table}`);
    const chain = {
      select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: mocks.artifact,
    };
    return chain;
  },
};
const request = (path: string, bounds: string | null) => {
  const url = new URL(path, "http://localhost");
  if (bounds !== null) url.searchParams.set("bbox", bounds);
  return new NextRequest(url);
};
const surfaces = [
  { name: "published", invoke: (bounds: string | null, invalid = false) => publishedGET(
    request(`/api/public/land-use-plans/${planId}/map/${designationId}`, bounds),
    { params: Promise.resolve({ planId: invalid ? "invalid" : planId, designationId }) },
  ) },
  { name: "review", invoke: (bounds: string | null, invalid = false) => reviewGET(
    request(`/api/public/land-use-plan-reviews/${shareToken}/map/${designationId}`, bounds),
    { params: Promise.resolve({ shareToken: invalid ? "invalid" : shareToken, designationId }) },
  ) },
  { name: "report", invoke: (bounds: string | null, invalid = false) => reportGET(
    request(`/api/reports/${reportId}/land-use-map/${designationId}`, bounds),
    { params: Promise.resolve({ reportId: invalid ? "invalid" : reportId, designationId }) },
  ) },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.published.mockResolvedValue({ ok: true, packet: { content: frozen } });
  mocks.review.mockResolvedValue({ ok: true, packet: { content: frozen } });
  mocks.create.mockResolvedValue(session);
  mocks.auth.mockResolvedValue({ data: { user: { id: actorId } }, error: null });
  mocks.access.mockResolvedValue({ report, membership: { role: "viewer" }, error: null });
  mocks.artifact.mockResolvedValue({ data: { metadata_json: artifactMetadata }, error: null });
  mocks.snapshot.mockResolvedValue({ frozen, versionId, contentHash });
  mocks.map.mockResolvedValue({ ok: true, payload: {
    type: "FeatureCollection", features: [], matchedCount: 0, returnedCount: 0,
    tooDenseToDraw: false, legendField: null, coverageNotes: [],
  } });
});

describe.each(surfaces)("$name designation viewport route", ({ name, invoke }) => {
  it.each([
    { raw: "-20,-10,30,10", expected: [-20, -10, 30, 10] },
    { raw: "170,-10,-170,10", expected: [170, -10, -170, 10] },
    { raw: "-180,-90,180,90", expected: [-180, -90, 180, 90] },
    { raw: "180,-10,-170,10", expected: [-180, -10, -170, 10] },
    { raw: "170,-10,-180,10", expected: [170, -10, 180, 10] },
  ])("passes canonical query $raw through its retained access path", async ({ raw, expected }) => {
    const response = await invoke(raw); expect(response.status).toBe(200);
    if (name === "report") {
      expect(mocks.map).toHaveBeenCalledExactlyOnceWith(frozen, designationId, expected, { client: session, workspaceId });
      expect(mocks.access).toHaveBeenCalledExactlyOnceWith(session, reportId, actorId);
      expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith(session, report, artifactMetadata);
      expect(await response.json()).toMatchObject({ reportId, versionId, contentHash });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    } else {
      expect(mocks.map).toHaveBeenCalledExactlyOnceWith(frozen, designationId, expected);
      expect(mocks.create).not.toHaveBeenCalled();
      expect(name === "published" ? mocks.published : mocks.review)
        .toHaveBeenCalledExactlyOnceWith(name === "published" ? planId : shareToken);
    }
  });

  it.each([null, "", "10,,12,35", "10, ,12,35", "0,0,10,", "1,2,3", "1,2,3,4,5",
    "0,0,0,1", "0,1,1,1", "180,-10,-180,10", "190,-10,210,10", "0,-91,1,1",
    "0,0,Infinity,1", "NaN,0,1,1", "0,-1,1,1x"])("refuses query %s before access or data work", async raw => {
    expect((await invoke(raw)).status).toBe(400);
    for (const boundary of [mocks.published, mocks.review, mocks.create, mocks.auth, mocks.access, mocks.snapshot, mocks.map]) {
      expect(boundary).not.toHaveBeenCalled();
    }
  });

  it("keeps invalid identifiers ahead of access or data work", async () => {
    expect((await invoke("170,-10,-170,10", true)).status).toBe(404);
    expect(mocks.published).not.toHaveBeenCalled(); expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.map).not.toHaveBeenCalled();
  });

  it.each([{ reason: "not_found", status: 404 }, { reason: "incomplete", status: 503 }])(
    "retains map loader $reason status", async ({ reason, status }) => {
      mocks.map.mockResolvedValue({ ok: false, reason });
      expect((await invoke("170,-10,-170,10")).status).toBe(status);
    },
  );
});

describe("viewport parsing does not replace retained access checks", () => {
  it.each([{ index: 0, boundary: mocks.published }, { index: 1, boundary: mocks.review }])(
    "refuses an unavailable retained public packet at boundary $index", async ({ index, boundary }) => {
      boundary.mockResolvedValue({ ok: false, reason: "not_found" });
      expect((await surfaces[index].invoke("170,-10,-170,10")).status).toBe(404);
      expect(mocks.map).not.toHaveBeenCalled();
    },
  );
  it("refuses a signed-out report reader before loading its map", async () => {
    mocks.auth.mockResolvedValue({ data: { user: null }, error: null });
    expect((await surfaces[2].invoke("170,-10,-170,10")).status).toBe(401);
    expect(mocks.map).not.toHaveBeenCalled(); expect(mocks.access).not.toHaveBeenCalled();
  });
  it("refuses a report reader without membership", async () => {
    mocks.access.mockResolvedValue({ report, membership: null, error: null });
    expect((await surfaces[2].invoke("170,-10,-170,10")).status).toBe(403);
    expect(mocks.map).not.toHaveBeenCalled(); expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it("refuses a report whose frozen edition cannot be verified", async () => {
    mocks.snapshot.mockResolvedValue(null);
    expect((await surfaces[2].invoke("170,-10,-170,10")).status).toBe(503);
    expect(mocks.map).not.toHaveBeenCalled();
  });
});

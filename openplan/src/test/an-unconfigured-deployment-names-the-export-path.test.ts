import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  FILE_GEODATABASE_EXPORT_PATH,
  SPATIAL_CONVERSION_WORKER_TOKEN_ENV,
  SPATIAL_CONVERSION_WORKER_URL_ENV,
  describeSpatialConversionAvailability,
} from "@/lib/workspace-gis/conversion-availability";

/**
 * A PLANNER HOLDING A .gdb MUST NOT BE TOLD "UNSUPPORTED FILE TYPE".
 *
 * A file geodatabase is what a county GIS shop hands out, often the only thing
 * it hands out, and no in-browser parser will read it. The generic refusal
 * teaches that planner exactly one thing: OpenPlan does not work with their
 * agency's data. And it is nearly always wrong as advice — ArcGIS Pro is
 * already open on their other monitor and the export is four clicks.
 *
 * So the refusal carries the free way out FIRST and the operator's option
 * second, in the `processing-availability.ts` mould. This test is what keeps
 * that sentence in the payload: a refusal that lost it would still look like a
 * polite error message while having stopped being useful.
 */

const createClientMock = vi.fn();
const authGetUserMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: async () => ({
    membership: { workspace_id: "33333333-3333-4333-8333-333333333333", role: "member" },
    workspace: null,
  }),
}));

import { POST as openIngest } from "@/app/api/workspace-gis/ingests/route";

beforeEach(() => {
  vi.clearAllMocks();
  authGetUserMock.mockResolvedValue({
    data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
  });
  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: () => {
      throw new Error("the refusal must happen before any table is touched");
    },
  });
});

describe("the unconfigured notice", () => {
  it("names both env vars and the export path a planner can use today", () => {
    const notice = describeSpatialConversionAvailability(false, "file geodatabase");

    expect(notice.title).toContain("file geodatabase");
    expect(notice.description).toContain(SPATIAL_CONVERSION_WORKER_URL_ENV);
    expect(notice.description).toContain(SPATIAL_CONVERSION_WORKER_TOKEN_ENV);
    // Nothing was stored and nothing was guessed — said plainly, because the
    // alternative failure here is a half-converted layer.
    expect(notice.description).toMatch(/nothing was stored/i);

    expect(notice.exportPath).toBe(FILE_GEODATABASE_EXPORT_PATH);
    expect(notice.exportPath).toMatch(/ArcGIS Pro/);
    expect(notice.exportPath).toMatch(/Export Features/);
    // QGIS too: an agency without an Esri licence is not a smaller agency.
    expect(notice.exportPath).toMatch(/QGIS/);
  });

  /**
   * THE CONFIGURED BRANCH MUST NOT CLAIM A CAPABILITY THIS BUILD LACKS.
   *
   * The aerial lane's defect was a page telling a deployment that HAD wired up
   * its worker that the capability "ships in a future release". The inverse is
   * live here right now: there is no dispatch path in this build at all, so an
   * operator who set both env vars must be told their worker is not called yet
   * — not told that conversion works. When the dispatch lane lands, this
   * assertion is what makes someone rewrite the sentence rather than leave a
   * stale one behind.
   */
  it("tells an operator with a worker that this build does not call it", () => {
    const notice = describeSpatialConversionAvailability(true, "file geodatabase");
    expect(notice.description).toMatch(/no dispatch path/i);
    expect(notice.description).toMatch(/nothing was stored/i);
    expect(notice.title).toMatch(/does not use it yet/i);
    // The way out is still offered, and it is the complete path today.
    expect(notice.exportPath).toBe(FILE_GEODATABASE_EXPORT_PATH);
  });
});

describe("POST /api/workspace-gis/ingests with a file geodatabase", () => {
  it("answers 501 with the export path, and touches nothing", async () => {
    const response = await openIngest(
      new NextRequest("http://localhost/api/workspace-gis/ingests", {
        method: "POST",
        body: JSON.stringify({
          layerId: "11111111-1111-4111-8111-111111111111",
          sourceFormat: "file_geodatabase",
          sourceFilename: "parcels.gdb.zip",
          sourceByteSize: 240_000_000,
          declaredFeatureCount: 0,
          sourceFeatureCount: 0,
          droppedFeatureCount: 0,
          geometryKinds: [],
          attributeFields: [],
          reprojectionEngine: "gdal",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(response.status).toBe(501);
    const body = await response.json();
    expect(body.exportPath).toBe(FILE_GEODATABASE_EXPORT_PATH);
    expect(body.description).toContain(SPATIAL_CONVERSION_WORKER_URL_ENV);
  });
});

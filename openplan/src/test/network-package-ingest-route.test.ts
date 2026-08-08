import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const packageMaybeSingleMock = vi.fn();
const packageEqMock = vi.fn(() => ({ maybeSingle: packageMaybeSingleMock }));
const packageSelectMock = vi.fn(() => ({ eq: packageEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const workspaceMaybeSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

const runsCountGteMock = vi.fn().mockResolvedValue({ count: 0, error: null });
const runsCountEqMock = vi.fn(() => ({ gte: runsCountGteMock }));
const runsSelectMock = vi.fn(() => ({ eq: runsCountEqMock }));

const versionUpdateSelectMock = vi
  .fn()
  .mockResolvedValue({ data: [{ id: "22222222-2222-4222-8222-222222222222" }], error: null });
const versionUpdateEqPackageMock = vi.fn(() => ({ select: versionUpdateSelectMock }));
const versionUpdateEqIdMock = vi.fn(() => ({ eq: versionUpdateEqPackageMock }));
const versionUpdateMock = vi.fn(() => ({ eq: versionUpdateEqIdMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "network_packages") {
    return { select: packageSelectMock };
  }
  if (table === "workspace_members") {
    return { select: membershipSelectMock };
  }
  if (table === "workspaces") {
    return { select: workspaceSelectMock };
  }
  if (table === "runs") {
    return { select: runsSelectMock };
  }
  if (table === "network_package_versions") {
    return { update: versionUpdateMock };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST as postIngest } from "@/app/api/network-packages/[packageId]/versions/[versionId]/ingest/route";

const PACKAGE_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

function buildRequest(body: unknown = { nodes: null, links: null }): NextRequest {
  return new NextRequest(
    `http://localhost/api/network-packages/${PACKAGE_ID}/versions/${VERSION_ID}/ingest`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

function buildContext() {
  return {
    params: Promise.resolve({ packageId: PACKAGE_ID, versionId: VERSION_ID }),
  };
}

const NODES_FIXTURE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: { id: "n1" },
    },
  ],
};

const LINKS_FIXTURE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      properties: { speed: 35, capacity: 1200 },
    },
  ],
};

describe("/api/network-packages/[packageId]/versions/[versionId]/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    authGetUserMock.mockResolvedValue({
      data: { user: { id: USER_ID } },
    });

    packageMaybeSingleMock.mockResolvedValue({
      data: { id: PACKAGE_ID, workspace_id: WORKSPACE_ID },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: { role: "member" },
      error: null,
    });

    workspaceMaybeSingleMock.mockResolvedValue({
      data: {
        plan: "pilot",
        subscription_plan: "pilot",
        subscription_status: "active",
      },
      error: null,
    });

    runsCountGteMock.mockResolvedValue({ count: 0, error: null });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("returns 401 when the request has no authenticated user", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await postIngest(buildRequest(), buildContext());

    expect(response.status).toBe(401);
    expect(packageSelectMock).not.toHaveBeenCalled();
    expect(versionUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects oversized ingest payloads before auth lookup", async () => {
    const response = await postIngest(
      buildRequest({
        nodes: {
          type: "FeatureCollection",
          features: [],
        },
        links: {
          type: "FeatureCollection",
          features: [],
        },
        oversized: "x".repeat(2 * 1024 * 1024 + 1),
      }),
      buildContext()
    );

    expect(response.status).toBe(413);
    expect(createClientMock).not.toHaveBeenCalled();
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "request_body_too_large",
      expect.objectContaining({
        packageId: PACKAGE_ID,
        versionId: VERSION_ID,
        maxBytes: 2 * 1024 * 1024,
      })
    );
  });

  it("returns 404 when the network package does not exist", async () => {
    packageMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await postIngest(buildRequest(), buildContext());

    expect(response.status).toBe(404);
    expect(membershipSelectMock).not.toHaveBeenCalled();
    expect(versionUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the user is not a member of the package workspace", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await postIngest(buildRequest(), buildContext());

    expect(response.status).toBe(403);
    expect(versionUpdateMock).not.toHaveBeenCalled();
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "workspace_access_denied",
      expect.objectContaining({ packageId: PACKAGE_ID, workspaceId: WORKSPACE_ID, userId: USER_ID })
    );
  });

  it("runs QA and updates the version row for an authorized member", async () => {
    const response = await postIngest(
      buildRequest({
        nodes: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [0, 0] },
              properties: { id: "n1" },
            },
          ],
        },
        links: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: [
                  [0, 0],
                  [1, 1],
                ],
              },
              properties: { speed: 35, capacity: 1200 },
            },
          ],
        },
      }),
      buildContext()
    );

    expect(response.status).toBe(200);
    expect(versionUpdateMock).toHaveBeenCalledTimes(1);
    expect(versionUpdateEqIdMock).toHaveBeenCalledWith("id", VERSION_ID);
    expect(versionUpdateEqPackageMock).toHaveBeenCalledWith("package_id", PACKAGE_ID);
    expect(mockAudit.info).toHaveBeenCalledWith(
      "network_package_version_ingested",
      expect.objectContaining({
        packageId: PACKAGE_ID,
        versionId: VERSION_ID,
        userId: USER_ID,
        workspaceId: WORKSPACE_ID,
      })
    );
  });

  it("returns 404 when versionId does not belong to packageId", async () => {
    versionUpdateSelectMock.mockResolvedValueOnce({ data: [], error: null });

    const response = await postIngest(
      buildRequest({
        nodes: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [0, 0] },
              properties: { id: "n1" },
            },
          ],
        },
        links: { type: "FeatureCollection", features: [] },
      }),
      buildContext()
    );

    expect(response.status).toBe(404);
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "network_package_version_not_found",
      expect.objectContaining({
        packageId: PACKAGE_ID,
        versionId: VERSION_ID,
      })
    );
  });

  it("never demands payment — a lapsed subscription is not a concept", async () => {
    // This route used to answer 402 when subscription_status was not active.
    // OpenPlan is free with no paid tier, so ingest proceeds regardless of any
    // legacy subscription column still sitting on the row.
    workspaceMaybeSingleMock.mockResolvedValueOnce({
      data: {
        plan: "pilot",
        subscription_plan: "pilot",
        subscription_status: "past_due",
      },
      error: null,
    });

    const response = await postIngest(buildRequest(), buildContext());

    expect(response.status).not.toBe(402);
  });

  it("does not count runs when no operator cap is configured", async () => {
    // The counting query is skipped entirely by default, so a huge existing run
    // count cannot refuse the request.
    runsCountGteMock.mockResolvedValueOnce({ count: 9999, error: null });

    const response = await postIngest(buildRequest(), buildContext());

    expect(response.status).not.toBe(429);
  });

  /**
   * WHICH NETWORK DID THIS RUN MODEL?
   *
   * `network_package_versions.file_hash` has carried the comment "SHA-256 hash
   * of the primary network bundle for integrity verification" since 2026-03-18
   * and nothing ever wrote it. The unread-column sweep found it; looking at
   * ingest sharpened the finding — THERE IS NO PRIMARY BUNDLE. Content arrives
   * as parsed GeoJSON in the request body, so a file checksum was never
   * available and the column's premise never matched the design.
   *
   * What it can honestly carry is provenance: two versions with the same digest
   * were ingested from the same nodes and links.
   */
  describe("the digest of the network this version was built from", () => {
    function ingestedRow() {
      const call = versionUpdateMock.mock.calls.at(-1);
      return (call?.[0] ?? {}) as { file_hash?: string };
    }

    it("records a sha256 digest of the ingested nodes and links", async () => {
      await postIngest(buildRequest({ nodes: NODES_FIXTURE, links: LINKS_FIXTURE }), buildContext());

      const hash = ingestedRow().file_hash;
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("gives the same network the same digest, and a changed link a different one", async () => {
      await postIngest(buildRequest({ nodes: NODES_FIXTURE, links: LINKS_FIXTURE }), buildContext());
      const first = ingestedRow().file_hash;

      await postIngest(buildRequest({ nodes: NODES_FIXTURE, links: LINKS_FIXTURE }), buildContext());
      expect(ingestedRow().file_hash, "the same network must digest the same").toBe(first);

      // One link's capacity changed. This is the whole point: a re-ingest that
      // alters the network must be visible as a different network.
      const changed = {
        ...LINKS_FIXTURE,
        features: [
          {
            ...LINKS_FIXTURE.features[0],
            properties: { ...LINKS_FIXTURE.features[0].properties, capacity: 2400 },
          },
        ],
      };
      await postIngest(buildRequest({ nodes: NODES_FIXTURE, links: changed }), buildContext());
      expect(ingestedRow().file_hash, "a changed link must digest differently").not.toBe(first);
    });

    it("distinguishes nodes-only from links-only, rather than hashing them together", async () => {
      // Hashing a concatenation without naming which half is which lets a
      // nodes-only ingest collide with a links-only one carrying the same bytes.
      await postIngest(buildRequest({ nodes: NODES_FIXTURE }), buildContext());
      const nodesOnly = ingestedRow().file_hash;

      await postIngest(buildRequest({ links: NODES_FIXTURE }), buildContext());
      expect(ingestedRow().file_hash).not.toBe(nodesOnly);
    });
  });
});

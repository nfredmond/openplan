import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A malformed record id in a route URL is answered by the route family's own
 * malformed-id status before any database call. Two representative families:
 * projects (400 "Invalid project id", like /api/projects/[projectId]) and
 * network packages (404 "Network package not found", the only answer that
 * family gives for a package it cannot name). Valid ids keep their old
 * answers: a valid id with no row is still 404 and a failed read is still 500.
 */

const createClientMock = vi.fn();
const authGetUserMock = vi.fn();
const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));
const audit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => audit }));

import { GET as getProjectReadiness } from "@/app/api/projects/[projectId]/jurisdiction-readiness/route";
import { POST as postIngest } from "@/app/api/network-packages/[packageId]/versions/[versionId]/ingest/route";
import { isUuid } from "@/lib/uuid";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const PACKAGE_ID = "44444444-4444-4444-8444-444444444444";
const VERSION_ID = "55555555-5555-4555-8555-555555555555";
const MALFORMED = ["new", "project-1", `${PROJECT_ID}x`, ""];

beforeEach(() => {
  vi.clearAllMocks();
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
});

function readiness(projectId: string) {
  return getProjectReadiness(new NextRequest(`http://localhost/api/projects/${projectId}/jurisdiction-readiness`), {
    params: Promise.resolve({ projectId }),
  });
}

function ingest(packageId: string, versionId: string) {
  return postIngest(
    new NextRequest(`http://localhost/api/network-packages/${packageId}/versions/${versionId}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodes: null, links: null }),
    }),
    { params: Promise.resolve({ packageId, versionId }) },
  );
}

describe("GET /api/projects/[projectId]/jurisdiction-readiness", () => {
  it.each(MALFORMED)("answers 400 for the malformed id %j without a database call", async (projectId) => {
    const response = await readiness(projectId);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid project id" });
    expect(createClientMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("still answers 404 for a valid id with no row", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    const response = await readiness(PROJECT_ID);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Project not found" });
    expect(fromMock).toHaveBeenCalledWith("projects");
    expect(eqMock).toHaveBeenCalledWith("id", PROJECT_ID);
  });

  it("still answers 500 when the read fails", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "permission denied for table projects" } });
    const response = await readiness(PROJECT_ID);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Project jurisdiction could not be read" });
  });
});

describe("POST /api/network-packages/[packageId]/versions/[versionId]/ingest", () => {
  it.each(MALFORMED)("answers 404 for the malformed package id %j without a database call", async (packageId) => {
    const response = await ingest(packageId, VERSION_ID);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Network package not found" });
    expect(createClientMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it.each(MALFORMED)("answers 404 for the malformed version id %j without a database call", async (versionId) => {
    const response = await ingest(PACKAGE_ID, versionId);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Network package version not found" });
    expect(createClientMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("still answers 404 for a valid package id with no row", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    const response = await ingest(PACKAGE_ID, VERSION_ID);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Network package not found" });
    expect(fromMock).toHaveBeenCalledWith("network_packages");
    expect(selectMock).toHaveBeenCalledWith("id, workspace_id");
    expect(eqMock).toHaveBeenCalledWith("id", PACKAGE_ID);
  });

  it("still answers 500 when the package read fails", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    const response = await ingest(PACKAGE_ID, VERSION_ID);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to verify network package" });
  });
});

describe("isUuid", () => {
  it("accepts the canonical text form in either case, including non-v4 fixture ids", () => {
    expect(isUuid(PROJECT_ID)).toBe(true);
    expect(isUuid(PROJECT_ID.toUpperCase())).toBe(true);
    expect(isUuid("11111111-1111-1111-1111-111111111111")).toBe(true);
  });

  it("rejects everything else, including forms Postgres would cast but OpenPlan never links", () => {
    for (const value of [...MALFORMED, `{${PROJECT_ID}}`, PROJECT_ID.replace(/-/g, ""), ` ${PROJECT_ID}`, null, undefined, 42]) {
      expect(isUuid(value), String(value)).toBe(false);
    }
  });
});

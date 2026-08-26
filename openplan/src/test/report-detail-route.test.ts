import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const reportMaybeSingleMock = vi.fn();
const reportEqMock = vi.fn(() => ({ maybeSingle: reportMaybeSingleMock }));
const reportSelectMock = vi.fn(() => ({ eq: reportEqMock }));
const reportUpdateEqMock = vi.fn().mockResolvedValue({ error: null });
const reportUpdateMock = vi.fn(() => ({ eq: reportUpdateEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

const sectionsOrderMock = vi.fn();
const sectionsEqMock = vi.fn(() => ({ order: sectionsOrderMock }));
const sectionsSelectMock = vi.fn(() => ({ eq: sectionsEqMock }));
const sectionsDeleteEqMock = vi.fn().mockResolvedValue({ error: null });
const sectionsDeleteMock = vi.fn(() => ({ eq: sectionsDeleteEqMock }));
const sectionsInsertMock = vi.fn().mockResolvedValue({ error: null });

const reportRunsOrderMock = vi.fn();
const reportRunsEqMock = vi.fn(() => ({ order: reportRunsOrderMock }));
const reportRunsSelectMock = vi.fn(() => ({ eq: reportRunsEqMock }));
// delete().eq("report_id", …).not(column, "is", null) — replacements are
// scoped to one citation kind.
const reportRunsDeleteNotMock = vi.fn().mockResolvedValue({ error: null });
const reportRunsDeleteEqMock = vi.fn(() => ({ not: reportRunsDeleteNotMock }));
const reportRunsDeleteMock = vi.fn(() => ({ eq: reportRunsDeleteEqMock }));
const reportRunsInsertMock = vi.fn().mockResolvedValue({ error: null });

const runsInMock = vi.fn();
const runsEqMock = vi.fn(() => ({ in: runsInMock }));
const runsSelectMock = vi.fn(() => ({ in: runsInMock, eq: runsEqMock }));

const modelRunsInMock = vi.fn();
const modelRunsEqMock = vi.fn(() => ({ eq: modelRunsEqMock, in: modelRunsInMock }));
const modelRunsSelectMock = vi.fn(() => ({ in: modelRunsInMock, eq: modelRunsEqMock }));

const countyRunsInMock = vi.fn();
const countyRunsEqMock = vi.fn(() => ({ in: countyRunsInMock }));
const countyRunsSelectMock = vi.fn(() => ({ in: countyRunsInMock, eq: countyRunsEqMock }));
const aerialCustodyMaybeSingleMock = vi.fn();
const aerialCustodyEqMock = vi.fn(() => ({ eq: aerialCustodyEqMock, maybeSingle: aerialCustodyMaybeSingleMock }));
const aerialCustodySelectMock = vi.fn(() => ({ eq: aerialCustodyEqMock }));
const safetyIngestInMock = vi.fn();
const safetyIngestEqMock = vi.fn(() => ({ eq: safetyIngestEqMock, in: safetyIngestInMock }));
const safetyIngestSelectMock = vi.fn(() => ({ eq: safetyIngestEqMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "reports") {
    return {
      select: reportSelectMock,
      update: reportUpdateMock,
    };
  }

  if (table === "workspace_members") {
    return {
      select: membershipSelectMock,
    };
  }

  if (table === "projects") {
    return {
      select: projectSelectMock,
    };
  }

  if (table === "report_sections") {
    return {
      select: sectionsSelectMock,
      delete: sectionsDeleteMock,
      insert: sectionsInsertMock,
    };
  }

  if (table === "report_runs") {
    return {
      select: reportRunsSelectMock,
      delete: reportRunsDeleteMock,
      insert: reportRunsInsertMock,
    };
  }

  if (table === "runs") {
    return {
      select: runsSelectMock,
    };
  }

  if (table === "model_runs") {
    return {
      select: modelRunsSelectMock,
    };
  }

  if (table === "county_runs") {
    return {
      select: countyRunsSelectMock,
    };
  }

  if (table === "aerial_artifact_custody") return { select: aerialCustodySelectMock };
  if (table === "safety_crash_ingests") return { select: safetyIngestSelectMock };

  if (table === "report_artifacts") {
    return {
      select: () => ({
        eq: () => ({
          order: vi.fn().mockResolvedValue({
            data: [{ id: "artifact-1", artifact_kind: "html", generated_at: "2026-03-14T12:00:00.000Z", metadata_json: {} }],
            error: null,
          }),
        }),
      }),
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

import { GET as getReportDetail, PATCH as patchReportDetail } from "@/app/api/reports/[reportId]/route";

describe("/api/reports/[reportId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      },
    });

    reportMaybeSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: "44444444-4444-4444-8444-444444444444",
        title: "Project Status Packet",
        status: "draft",
        report_type: "project_status",
        metadata_json: {
          agreementCorridorSelections: [{
            modelRunId: "88888888-8888-4888-8888-888888888888",
            corridor: "Central Avenue",
          }],
          aerialOrthoSelections: [{ custodyId: "99999999-9999-4999-8999-999999999999" }],
          safetyIngestSelections: [{ ingestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
        },
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: "33333333-3333-4333-8333-333333333333",
        role: "member",
      },
      error: null,
    });

    projectMaybeSingleMock.mockResolvedValue({
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Nevada County Safety Action Program",
      },
      error: null,
    });

    sectionsOrderMock.mockResolvedValue({
      data: [{ id: "section-1", section_key: "project_overview", title: "Project overview", enabled: true, sort_order: 0 }],
      error: null,
    });

    reportRunsOrderMock.mockResolvedValue({
      data: [{ id: "report-run-1", run_id: "55555555-5555-4555-8555-555555555555", sort_order: 0 }],
      error: null,
    });

    runsInMock.mockResolvedValue({
      data: [{ id: "55555555-5555-4555-8555-555555555555", title: "Run A", query_text: "Assess corridor", created_at: "2026-03-13T00:00:00.000Z" }],
      error: null,
    });

    modelRunsInMock.mockResolvedValue({ data: [], error: null });
    countyRunsInMock.mockResolvedValue({ data: [], error: null });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("GET returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await getReportDetail(new NextRequest("http://localhost/api/reports/1"), {
      params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
    });

    expect(response.status).toBe(401);
  });

  it("GET returns report detail payload", async () => {
    const response = await getReportDetail(new NextRequest("http://localhost/api/reports/1"), {
      params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
    });

    expect(response.status).toBe(200);
    expect(await response.clone().json()).toMatchObject({
      agreementCorridorSelections: [{
        modelRunId: "88888888-8888-4888-8888-888888888888",
        corridor: "Central Avenue",
      }],
      aerialOrthoSelections: [{ custodyId: "99999999-9999-4999-8999-999999999999" }],
      safetyIngestSelections: [{ ingestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
    });
    expect(await response.json()).toMatchObject({
      report: {
        id: "11111111-1111-4111-8111-111111111111",
      },
      sections: [expect.objectContaining({ id: "section-1" })],
      runs: [expect.objectContaining({ id: "55555555-5555-4555-8555-555555555555" })],
      artifacts: [expect.objectContaining({ id: "artifact-1" })],
      agreementCorridorSelections: [{
        modelRunId: "88888888-8888-4888-8888-888888888888",
        corridor: "Central Avenue",
      }],
    });
  });

  it("PATCH refuses a held orthophoto from another project", async () => {
    aerialCustodyMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "99999999-9999-4999-8999-999999999999",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        mission_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        kind: "ortho_preview",
        state: "held",
        storage_bucket: "aerial-artifacts",
        storage_path: "33333333-3333-4333-8333-333333333333/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/job/ortho-preview.png",
        byte_size: 10,
        checksum_sha256: "a".repeat(64),
        content_type: "image/png",
        bounds_west: -121.2,
        bounds_south: 39.1,
        bounds_east: -121.1,
        bounds_north: 39.2,
        aerial_missions: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          workspace_id: "33333333-3333-4333-8333-333333333333",
          project_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          title: "Other project flight",
          collected_at: null,
          projects: { name: "Other project" },
        },
      },
      error: null,
    });
    const response = await patchReportDetail(
      new NextRequest("http://localhost/api/reports/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aerialOrthoSelections: [{ custodyId: "99999999-9999-4999-8999-999999999999" }] }),
      }),
      { params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }) },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/another project/i) });
    expect(reportUpdateMock).not.toHaveBeenCalled();
  });

  it("PATCH refuses crash evidence outside the report project", async () => {
    safetyIngestInMock.mockResolvedValueOnce({ data: [], error: null });
    const response = await patchReportDetail(
      new NextRequest("http://localhost/api/reports/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          safetyIngestSelections: [{ ingestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
        }),
      }),
      { params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }) },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/not attached/i) });
    expect(safetyIngestEqMock).toHaveBeenCalledWith(
      "workspace_id",
      "33333333-3333-4333-8333-333333333333",
    );
    expect(safetyIngestEqMock).toHaveBeenCalledWith(
      "project_id",
      "44444444-4444-4444-8444-444444444444",
    );
    expect(reportUpdateMock).not.toHaveBeenCalled();
  });

  it("GET resolves typed model-run and county-run citations with kind + status", async () => {
    reportRunsOrderMock.mockResolvedValueOnce({
      data: [
        { id: "report-run-1", run_id: "55555555-5555-4555-8555-555555555555", model_run_id: null, county_run_id: null, sort_order: 0 },
        { id: "report-run-2", run_id: null, model_run_id: "88888888-8888-4888-8888-888888888888", county_run_id: null, sort_order: 1 },
        { id: "report-run-3", run_id: null, model_run_id: null, county_run_id: "77777777-7777-4777-8777-777777777777", sort_order: 2 },
      ],
      error: null,
    });
    modelRunsInMock.mockResolvedValueOnce({
      data: [
        { id: "88888888-8888-4888-8888-888888888888", run_title: "Corridor screening run", engine_key: "aequilibrae", status: "succeeded" },
      ],
      error: null,
    });
    countyRunsInMock.mockResolvedValueOnce({
      data: [{ id: "77777777-7777-4777-8777-777777777777", run_name: "County screening baseline", stage: "validated-screening" }],
      error: null,
    });

    const response = await getReportDetail(new NextRequest("http://localhost/api/reports/1"), {
      params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { runs: Array<Record<string, unknown>> };
    expect(payload.runs).toHaveLength(3);
    expect(payload.runs[0]).toMatchObject({ kind: "analysis", id: "55555555-5555-4555-8555-555555555555" });
    expect(payload.runs[1]).toMatchObject({
      kind: "model",
      id: "88888888-8888-4888-8888-888888888888",
      title: "Corridor screening run",
      engine_key: "aequilibrae",
      status: "succeeded",
    });
    expect(payload.runs[2]).toMatchObject({
      kind: "county",
      id: "77777777-7777-4777-8777-777777777777",
      title: "County screening baseline",
      stage: "validated-screening",
    });
  });

  it("GET falls back to the legacy report_runs select on a pre-migration database", async () => {
    reportRunsOrderMock
      .mockResolvedValueOnce({
        data: null,
        error: { message: "column report_runs.model_run_id does not exist" },
      })
      .mockResolvedValueOnce({
        data: [{ id: "report-run-1", run_id: "55555555-5555-4555-8555-555555555555", sort_order: 0 }],
        error: null,
      });

    const response = await getReportDetail(new NextRequest("http://localhost/api/reports/1"), {
      params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { runs: Array<Record<string, unknown>> };
    expect(payload.runs).toEqual([
      expect.objectContaining({ kind: "analysis", id: "55555555-5555-4555-8555-555555555555" }),
    ]);
  });

  it("PATCH returns 403 when workspace role is unsupported", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: {
        workspace_id: "33333333-3333-4333-8333-333333333333",
        role: "viewer",
      },
      error: null,
    });

    const response = await patchReportDetail(
      new NextRequest("http://localhost/api/reports/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Updated packet" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("PATCH updates report metadata", async () => {
    const response = await patchReportDetail(
      new NextRequest("http://localhost/api/reports/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Updated packet",
          summary: "Revised basis",
          status: "archived",
          runIds: ["55555555-5555-4555-8555-555555555555"],
        }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    expect(reportUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Updated packet",
        summary: "Revised basis",
        status: "archived",
      })
    );
    expect(reportRunsDeleteMock).toHaveBeenCalled();
    expect(reportRunsInsertMock).toHaveBeenCalledWith([
      {
        report_id: "11111111-1111-4111-8111-111111111111",
        run_id: "55555555-5555-4555-8555-555555555555",
        sort_order: 0,
      },
    ]);
  });

  it("PATCH replaces only model-run citations when modelRunIds is provided", async () => {
    modelRunsInMock.mockResolvedValueOnce({
      data: [{ id: "88888888-8888-4888-8888-888888888888" }],
      error: null,
    });

    const response = await patchReportDetail(
      new NextRequest("http://localhost/api/reports/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modelRunIds: ["88888888-8888-4888-8888-888888888888"],
        }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      agreementCorridorSelections: [{
        modelRunId: "88888888-8888-4888-8888-888888888888",
        corridor: "Central Avenue",
      }],
    });
    // Validated against the report's workspace.
    expect(modelRunsEqMock).toHaveBeenCalledWith("workspace_id", "33333333-3333-4333-8333-333333333333");
    expect(modelRunsEqMock).toHaveBeenCalledWith("project_id", "44444444-4444-4444-8444-444444444444");
    // Deleted by kind, never by report_id alone.
    expect(reportRunsDeleteNotMock).toHaveBeenCalledWith("model_run_id", "is", null);
    expect(reportRunsDeleteNotMock).not.toHaveBeenCalledWith("run_id", "is", null);
    expect(reportRunsInsertMock).toHaveBeenCalledWith([
      {
        report_id: "11111111-1111-4111-8111-111111111111",
        model_run_id: "88888888-8888-4888-8888-888888888888",
        sort_order: 0,
      },
    ]);
  });

  it("PATCH rejects a cross-workspace model run citation", async () => {
    modelRunsInMock.mockResolvedValueOnce({ data: [], error: null });

    const response = await patchReportDetail(
      new NextRequest("http://localhost/api/reports/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modelRunIds: ["88888888-8888-4888-8888-888888888888"],
        }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "One or more linked model runs are invalid" });
    expect(reportRunsDeleteMock).not.toHaveBeenCalled();
  });

  it("PATCH answers 503 on typed writes when the migration is missing", async () => {
    modelRunsInMock.mockResolvedValueOnce({
      data: [{ id: "88888888-8888-4888-8888-888888888888" }],
      error: null,
    });
    reportRunsDeleteNotMock.mockResolvedValueOnce({
      error: { message: "column report_runs.model_run_id does not exist" },
    });

    const response = await patchReportDetail(
      new NextRequest("http://localhost/api/reports/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modelRunIds: ["88888888-8888-4888-8888-888888888888"],
        }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("typed-evidence migration"),
    });
  });

  it("PATCH rejects generated status without an artifact", async () => {
    const response = await patchReportDetail(
      new NextRequest("http://localhost/api/reports/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "generated" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Generate an artifact before marking this report as generated",
    });
  });
});

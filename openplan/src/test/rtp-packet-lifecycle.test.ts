import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const RTP_CYCLE_ID = "44444444-4444-4444-8444-444444444444";
const REPORT_ID = "11111111-1111-4111-8111-111111111111";
const ARTIFACT_ID = "55555555-5555-4555-8555-555555555555";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

type ReportRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  rtp_cycle_id: string | null;
  title: string;
  summary: string | null;
  report_type: string;
  status: string;
  generated_at: string | null;
  latest_artifact_kind: string | null;
  latest_artifact_url: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

let reportRow: ReportRow | null = null;
const reportUpdatePayloads: Array<Record<string, unknown>> = [];
const reportInsertPayloads: Array<Record<string, unknown>> = [];

function createSupabase() {
  return {
    auth: { getUser: authGetUserMock },
    from: (table: string) => buildTableMock(table),
  };
}

function buildTableMock(table: string) {
  if (table === "reports") {
    return {
      insert(payload: Record<string, unknown>) {
        reportInsertPayloads.push(payload);
        reportRow = {
          id: REPORT_ID,
          workspace_id: payload.workspace_id as string,
          project_id: (payload.project_id as string | null) ?? null,
          rtp_cycle_id: (payload.rtp_cycle_id as string | null) ?? null,
          title: payload.title as string,
          summary: (payload.summary as string | null) ?? null,
          report_type: payload.report_type as string,
          status: "draft",
          generated_at: null,
          latest_artifact_kind: null,
          latest_artifact_url: null,
          metadata_json: (payload.metadata_json as Record<string, unknown>) ?? {},
          created_at: "2026-04-16T00:00:00.000Z",
          updated_at: "2026-04-16T00:00:00.000Z",
        };
        return {
          select: () => ({
            single: async () => ({ data: reportRow, error: null }),
          }),
        };
      },
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: reportRow, error: null }),
        }),
      }),
      update(payload: Record<string, unknown>) {
        reportUpdatePayloads.push(payload);
        if (reportRow) {
          reportRow = {
            ...reportRow,
            ...(payload as Partial<ReportRow>),
            metadata_json:
              (payload.metadata_json as Record<string, unknown> | undefined) ?? reportRow.metadata_json,
          };
        }
        return {
          eq: async () => ({ error: null }),
        };
      },
    };
  }

  if (table === "rtp_cycles") {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: RTP_CYCLE_ID,
              workspace_id: WORKSPACE_ID,
              title: "Nevada County RTP 2050",
              status: "draft",
              geography_label: "Nevada County",
              horizon_start_year: 2025,
              horizon_end_year: 2050,
              adoption_target_date: "2026-12-31",
              public_review_open_at: null,
              public_review_close_at: null,
              summary: null,
              updated_at: "2026-04-10T00:00:00.000Z",
            },
            error: null,
          }),
        }),
      }),
    };
  }

  if (table === "workspace_members") {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { workspace_id: WORKSPACE_ID, role: "member" },
              error: null,
            }),
          }),
        }),
      }),
    };
  }

  if (table === "workspaces") {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: WORKSPACE_ID, name: "Nevada County", plan: "pilot" },
            error: null,
          }),
        }),
      }),
    };
  }

  if (table === "report_sections") {
    return {
      insert: async () => ({ error: null }),
      select: () => ({
        eq: () => ({
          order: async () => ({ data: [], error: null }),
        }),
      }),
    };
  }

  if (
    table === "rtp_cycle_chapters"
    || table === "project_rtp_cycle_links"
    || table === "engagement_campaigns"
  ) {
    return {
      select: () => ({
        eq: () => ({
          order: async () => ({ data: [], error: null }),
        }),
      }),
    };
  }

  if (table === "report_artifacts") {
    return {
      insert: () => ({
        select: () => ({
          single: async () => ({
            data: {
              id: ARTIFACT_ID,
              report_id: REPORT_ID,
              artifact_kind: "html",
              generated_at: new Date().toISOString(),
              metadata_json: {},
            },
            error: null,
          }),
        }),
      }),
    };
  }

  throw new Error(`Unexpected table: ${table}`);
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST as postReports } from "@/app/api/reports/route";
import { POST as postGenerate } from "@/app/api/reports/[reportId]/generate/route";

function createReportRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function generateRequest() {
  return new NextRequest(`http://localhost/api/reports/${REPORT_ID}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ format: "html" }),
  });
}

describe("RTP packet lifecycle: create → generate → review posture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportRow = null;
    reportUpdatePayloads.length = 0;
    reportInsertPayloads.length = 0;

    createApiAuditLoggerMock.mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    createClientMock.mockResolvedValue(createSupabase());
  });

  it("moves no-packet → generated → review posture with expected queueTrace transitions", async () => {
    const createResponse = await postReports(
      createReportRequest({
        rtpCycleId: RTP_CYCLE_ID,
        reportType: "board_packet",
      })
    );

    expect(createResponse.status).toBe(201);
    const createBody = await createResponse.json();
    expect(createBody).toMatchObject({ reportId: REPORT_ID });

    expect(reportInsertPayloads).toHaveLength(1);
    const insertedMetadata = reportInsertPayloads[0]?.metadata_json as
      | { queueTrace?: { action?: string; source?: string } }
      | undefined;
    expect(insertedMetadata?.queueTrace?.action).toBe("create_record");
    expect(insertedMetadata?.queueTrace?.source).toBe("reports.create");
    expect(reportRow?.status).toBe("draft");
    expect(reportRow?.generated_at).toBeNull();

    const generateResponse = await postGenerate(generateRequest(), {
      params: Promise.resolve({ reportId: REPORT_ID }),
    });

    expect(generateResponse.status).toBe(200);
    const generateBody = await generateResponse.json();
    expect(generateBody).toMatchObject({
      reportId: REPORT_ID,
      artifactId: ARTIFACT_ID,
      format: "html",
      latestArtifactUrl: `/reports/${REPORT_ID}#artifact-${ARTIFACT_ID}`,
    });

    expect(reportUpdatePayloads).toHaveLength(1);
    const firstUpdate = reportUpdatePayloads[0];
    expect(firstUpdate).toMatchObject({
      status: "generated",
      latest_artifact_kind: "html",
    });
    const firstQueueTrace = (firstUpdate.metadata_json as {
      queueTrace?: { action?: string; source?: string };
    } | undefined)?.queueTrace;
    expect(firstQueueTrace?.action).toBe("generate_first_artifact");
    expect(firstQueueTrace?.source).toBe("reports.generate");

    expect(reportRow?.status).toBe("generated");
    expect(reportRow?.latest_artifact_url).toBe(`/reports/${REPORT_ID}#artifact-${ARTIFACT_ID}`);
    expect(reportRow?.generated_at).not.toBeNull();

    const refreshResponse = await postGenerate(generateRequest(), {
      params: Promise.resolve({ reportId: REPORT_ID }),
    });
    expect(refreshResponse.status).toBe(200);
    expect(reportUpdatePayloads).toHaveLength(2);
    const secondQueueTrace = (reportUpdatePayloads[1].metadata_json as {
      queueTrace?: { action?: string; source?: string };
    } | undefined)?.queueTrace;
    expect(secondQueueTrace?.action).toBe("refresh_artifact");
    expect(secondQueueTrace?.source).toBe("reports.generate");
  });
});

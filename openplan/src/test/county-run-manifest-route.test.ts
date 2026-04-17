import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const fromMock = vi.fn();
const countyRunSelectMock = vi.fn();
const countyRunEqMock = vi.fn();
const countyRunMaybeSingleMock = vi.fn();
const countyRunUpdateMock = vi.fn();
const countyRunUpdateEqMock = vi.fn();
const countyRunUpdateSelectMock = vi.fn();
const countyRunUpdateSingleMock = vi.fn();
const artifactDeleteMock = vi.fn();
const artifactDeleteEqMock = vi.fn();
const artifactInsertMock = vi.fn();
const artifactInsertSelectMock = vi.fn();
const kpiDeleteEqKpiCategoryMock = vi.fn();
const kpiDeleteEqCountyRunIdMock = vi.fn(() => ({ eq: kpiDeleteEqKpiCategoryMock }));
const kpiDeleteMock = vi.fn(() => ({ eq: kpiDeleteEqCountyRunIdMock }));
const kpiInsertMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST as postCountyRunManifest } from "@/app/api/county-runs/[countyRunId]/manifest/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/manifest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const manifest = {
  schema_version: "openplan.county_onramp_manifest.v1",
  generated_at: "2026-03-24T23:00:00Z",
  name: "nevada-county-runtime-scalar0369-connectorbias2-20260324",
  county_fips: "06057",
  county_prefix: "NEVADA",
  run_dir: "/tmp/nevada",
  mode: "existing-run",
  stage: "validated-screening",
  artifacts: {
    scaffold_csv: "/tmp/scaffold.csv",
    review_packet_md: "/tmp/review.md",
    run_summary_json: "/tmp/run_summary.json",
    bundle_manifest_json: "/tmp/bundle_manifest.json",
    validation_summary_json: "/tmp/validation_summary.json",
  },
  runtime: {
    keep_project: true,
    force: false,
    overall_demand_scalar: 0.369,
    external_demand_scalar: null,
    hbw_scalar: null,
    hbo_scalar: null,
    nhb_scalar: null,
  },
  summary: {
    run: {
      zone_count: 26,
      population_total: 102345,
      jobs_total: 45678,
      loaded_links: 3174,
      final_gap: 0.0091,
      total_trips: 231828.75,
    },
    validation: {
      screening_gate: {
        status_label: "bounded screening-ready",
      },
      metrics: {
        median_absolute_percent_error: 16.01,
        max_absolute_percent_error: 49.48,
      },
    },
    bundle_validation: {
      status_label: "bounded screening-ready",
    },
  },
} as const;

describe("POST /api/county-runs/[countyRunId]/manifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    authGetUserMock.mockResolvedValue({
      data: {
        user: { id: "123e4567-e89b-12d3-a456-426614174000" },
      },
    });

    countyRunMaybeSingleMock.mockResolvedValue({
      data: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        workspace_id: "11111111-1111-4111-8111-111111111111",
        geography_type: "county_fips",
        geography_id: "06057",
        geography_label: "Nevada County, CA",
        run_name: "old-run",
        stage: "bootstrap-incomplete",
        status_label: null,
        enqueue_status: "not-enqueued",
        last_enqueued_at: null,
        requested_runtime_json: {
          workspaceId: "11111111-1111-4111-8111-111111111111",
          geographyType: "county_fips",
          geographyId: "06057",
          geographyLabel: "Nevada County, CA",
          runName: "old-run",
          countyPrefix: "NEVADA",
          runtimeOptions: {
            keepProject: true,
            force: true,
            overallDemandScalar: 0.369,
            externalDemandScalar: null,
            hbwScalar: null,
            hboScalar: null,
            nhbScalar: null,
          },
        },
        manifest_json: {},
        validation_summary_json: {},
      },
      error: null,
    });
    countyRunEqMock.mockReturnValue({ maybeSingle: countyRunMaybeSingleMock });
    countyRunSelectMock.mockReturnValue({ eq: countyRunEqMock });

    countyRunUpdateSingleMock.mockResolvedValue({
      data: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        workspace_id: "11111111-1111-4111-8111-111111111111",
        geography_type: "county_fips",
        geography_id: "06057",
        geography_label: "Nevada County, CA",
        run_name: manifest.name,
        stage: "validated-screening",
        status_label: "bounded screening-ready",
        enqueue_status: "queued_stub",
        last_enqueued_at: "2026-03-24T23:05:00Z",
        requested_runtime_json: {
          workspaceId: "11111111-1111-4111-8111-111111111111",
          geographyType: "county_fips",
          geographyId: "06057",
          geographyLabel: "Nevada County, CA",
          runName: "nevada-county-runtime-scalar0369-connectorbias2-20260324",
          countyPrefix: "NEVADA",
          runtimeOptions: {
            keepProject: true,
            force: true,
            overallDemandScalar: 0.369,
            externalDemandScalar: null,
            hbwScalar: null,
            hboScalar: null,
            nhbScalar: null,
          },
        },
        manifest_json: manifest,
        validation_summary_json: manifest.summary.validation,
      },
      error: null,
    });
    countyRunUpdateSelectMock.mockReturnValue({ single: countyRunUpdateSingleMock });
    countyRunUpdateEqMock.mockReturnValue({ select: countyRunUpdateSelectMock });
    countyRunUpdateMock.mockReturnValue({ eq: countyRunUpdateEqMock });

    artifactDeleteEqMock.mockResolvedValue({ error: null });
    artifactDeleteMock.mockReturnValue({ eq: artifactDeleteEqMock });

    artifactInsertSelectMock.mockResolvedValue({
      data: [
        { artifact_type: "validation_scaffold_csv", path: "/tmp/scaffold.csv" },
        { artifact_type: "validation_review_packet_md", path: "/tmp/review.md" },
      ],
      error: null,
    });
    artifactInsertMock.mockReturnValue({ select: artifactInsertSelectMock });

    kpiDeleteEqKpiCategoryMock.mockResolvedValue({ error: null });
    kpiInsertMock.mockResolvedValue({ error: null });

    fromMock.mockImplementation((table: string) => {
      if (table === "county_runs") {
        return {
          select: countyRunSelectMock,
          update: countyRunUpdateMock,
        };
      }
      if (table === "county_run_artifacts") {
        return {
          delete: artifactDeleteMock,
          insert: artifactInsertMock,
        };
      }
      if (table === "model_run_kpis") {
        return {
          delete: kpiDeleteMock,
          insert: kpiInsertMock,
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("ingests a completed manifest and returns county run detail", async () => {
    const response = await postCountyRunManifest(jsonRequest({ status: "completed", manifest }), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.stage).toBe("validated-screening");
    expect(payload.statusLabel).toBe("bounded screening-ready");
    expect(payload.enqueueStatus).toBe("queued_stub");
    expect(payload.lastEnqueuedAt).toBe("2026-03-24T23:05:00Z");
    expect(payload.workerPayload.countyRunId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(payload.manifest.stage).toBe("validated-screening");
    expect(payload.artifacts).toEqual([
      { artifactType: "validation_scaffold_csv", path: "/tmp/scaffold.csv" },
      { artifactType: "validation_review_packet_md", path: "/tmp/review.md" },
    ]);
    expect(kpiInsertMock).toHaveBeenCalledTimes(1);
    const kpiRows = kpiInsertMock.mock.calls[0]?.[0] as Array<{
      kpi_name: string;
      kpi_category: string;
      value: number | null;
      county_run_id: string;
      run_id: null;
    }>;
    expect(kpiRows).toHaveLength(6);
    expect(kpiRows.every((row) => row.kpi_category === "behavioral_onramp")).toBe(true);
    expect(kpiRows.every((row) => row.county_run_id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe(true);
    expect(kpiRows.find((row) => row.kpi_name === "total_trips")?.value).toBe(231828.75);
    expect(mockAudit.info).toHaveBeenCalledWith(
      "county_run_behavioral_kpis_written",
      expect.objectContaining({ kpiCount: 6, stage: "validated-screening" })
    );
  });

  it("records worker failure callbacks", async () => {
    countyRunUpdateMock.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    const response = await postCountyRunManifest(
      jsonRequest({ status: "failed", error: { message: "Worker crashed" } }),
      {
        params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
      }
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "failed",
    });
  });

  it("returns 400 for invalid payloads", async () => {
    const response = await postCountyRunManifest(jsonRequest({ status: "completed" }), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid manifest ingest payload" });
  });
});

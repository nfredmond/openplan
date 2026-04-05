import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
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

import { POST as refreshCountyRunValidation } from "@/app/api/county-runs/[countyRunId]/validate/refresh/route";

const runDir = "/tmp/openplan-validation-refresh-test";
const validationDir = `${runDir}/validation`;
const validationSummaryPath = `${validationDir}/validation_summary.json`;

function request() {
  return new NextRequest(
    "http://localhost/api/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/validate/refresh",
    {
      method: "POST",
    }
  );
}

describe("POST /api/county-runs/[countyRunId]/validate/refresh", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN;
    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    await rm(runDir, { recursive: true, force: true });
    await mkdir(validationDir, { recursive: true });
    await writeFile(
      validationSummaryPath,
      JSON.stringify(
        {
          counts_csv: `${runDir}/scaffold.csv`,
          stations_total: 5,
          stations_matched: 5,
          screening_gate: {
            status_label: "bounded screening-ready",
            reasons: [],
          },
          metrics: {
            median_absolute_percent_error: 16.01,
            max_absolute_percent_error: 49.48,
          },
        },
        null,
        2
      ),
      "utf8"
    );

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
        run_name: "nevada-run",
        stage: "validation-scaffolded",
        status_label: "Validation pending scaffold edits",
        enqueue_status: "queued_stub",
        last_enqueued_at: "2026-03-24T23:05:00Z",
        requested_runtime_json: {},
        manifest_json: {
          schema_version: "openplan.county_onramp_manifest.v1",
          generated_at: "2026-03-24T23:00:00Z",
          name: "nevada-run",
          county_fips: "06057",
          county_prefix: "NEVADA",
          run_dir: runDir,
          mode: "existing-run",
          stage: "validation-scaffolded",
          artifacts: {
            scaffold_csv: `${runDir}/scaffold.csv`,
            review_packet_md: `${runDir}/review.md`,
            run_summary_json: `${runDir}/run_summary.json`,
            bundle_manifest_json: `${runDir}/bundle_manifest.json`,
            validation_summary_json: null,
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
            validation: null,
            bundle_validation: null,
            scaffold: {
              station_count: 5,
              observed_volume_filled_count: 5,
              observed_volume_missing_count: 0,
              source_agency_filled_count: 5,
              source_agency_tbd_count: 0,
              source_description_filled_count: 5,
              source_description_missing_count: 0,
              ready_station_count: 5,
              next_action_label:
                "All starter stations have observed counts and source metadata recorded. Tighten definitions if needed, then run validation.",
            },
          },
        },
        validation_summary_json: null,
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
        run_name: "nevada-run",
        stage: "validated-screening",
        status_label: "bounded screening-ready",
        enqueue_status: "queued_stub",
        last_enqueued_at: "2026-03-24T23:05:00Z",
        requested_runtime_json: {},
        manifest_json: {},
        validation_summary_json: {
          screening_gate: { status_label: "bounded screening-ready" },
        },
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
        { artifact_type: "validation_scaffold_csv", path: `${runDir}/scaffold.csv` },
        { artifact_type: "validation_summary_json", path: validationSummaryPath },
      ],
      error: null,
    });
    artifactInsertMock.mockReturnValue({ select: artifactInsertSelectMock });

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
      throw new Error(`Unexpected table: ${table}`);
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("refreshes county validation from the on-disk validation summary", async () => {
    const response = await refreshCountyRunValidation(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.stage).toBe("validated-screening");
    expect(payload.statusLabel).toBe("bounded screening-ready");
    expect(payload.validationSummary.screening_gate.status_label).toBe("bounded screening-ready");
    expect(payload.artifacts).toEqual([
      { artifactType: "validation_scaffold_csv", path: `${runDir}/scaffold.csv` },
      { artifactType: "validation_summary_json", path: validationSummaryPath },
    ]);
  });

  it("accepts machine-authenticated refresh callbacks without a logged-in user", async () => {
    process.env.OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN = "callback-secret";
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await refreshCountyRunValidation(
      new NextRequest(
        "http://localhost/api/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/validate/refresh",
        {
          method: "POST",
          headers: {
            authorization: "Bearer callback-secret",
          },
        }
      ),
      {
        params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
      }
    );

    expect(response.status).toBe(200);
    expect(authGetUserMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the validation summary file is missing", async () => {
    await rm(validationSummaryPath, { force: true });

    const response = await refreshCountyRunValidation(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Validation summary file was not found on disk" });
  });
});

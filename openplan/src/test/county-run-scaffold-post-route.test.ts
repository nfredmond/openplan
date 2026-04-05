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
const artifactDeleteCountyRunEqMock = vi.fn();
const artifactDeleteTypeEqMock = vi.fn();
const artifactSelectMock = vi.fn();
const artifactSelectEqMock = vi.fn();
const artifactSelectOrderMock = vi.fn();

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

import { POST as postCountyRunScaffold } from "@/app/api/county-runs/[countyRunId]/scaffold/route";

const scaffoldPath = "/tmp/openplan-scaffold-post-route-test.csv";
const countyRunId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function jsonRequest(payload: unknown) {
  return new NextRequest(`http://localhost/api/county-runs/${countyRunId}/scaffold`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/county-runs/[countyRunId]/scaffold", () => {
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
        id: countyRunId,
        workspace_id: "11111111-1111-4111-8111-111111111111",
        geography_type: "county_fips",
        geography_id: "06057",
        geography_label: "Nevada County, CA",
        run_name: "nevada-run",
        stage: "validated-screening",
        status_label: "bounded screening-ready",
        enqueue_status: "queued_stub",
        last_enqueued_at: null,
        requested_runtime_json: {},
        manifest_json: {
          schema_version: "openplan.county_onramp_manifest.v1",
          generated_at: "2026-03-24T23:00:00Z",
          name: "nevada-run",
          county_fips: "06057",
          county_prefix: "NEVADA",
          run_dir: "/tmp/nevada",
          mode: "existing-run",
          stage: "validated-screening",
          artifacts: {
            scaffold_csv: scaffoldPath,
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
            },
            bundle_validation: {
              status_label: "bounded screening-ready",
            },
            scaffold: {
              station_count: 1,
              observed_volume_filled_count: 1,
              observed_volume_missing_count: 0,
              source_agency_filled_count: 1,
              source_agency_tbd_count: 0,
              source_description_filled_count: 1,
              source_description_missing_count: 0,
              ready_station_count: 1,
              next_action_label: "Validation can run next.",
              inline_csv_content: "station_id,observed_volume,source_agency,source_description\nA,123,Caltrans,PM 1.2\n",
            },
          },
        },
        validation_summary_json: {
          screening_gate: {
            status_label: "bounded screening-ready",
          },
        },
      },
      error: null,
    });
    countyRunEqMock.mockReturnValue({ maybeSingle: countyRunMaybeSingleMock });
    countyRunSelectMock.mockReturnValue({ eq: countyRunEqMock });

    countyRunUpdateSingleMock.mockResolvedValue({
      data: {
        id: countyRunId,
        workspace_id: "11111111-1111-4111-8111-111111111111",
        geography_type: "county_fips",
        geography_id: "06057",
        geography_label: "Nevada County, CA",
        run_name: "nevada-run",
        stage: "validation-scaffolded",
        status_label: "Validation pending scaffold edits",
        enqueue_status: "queued_stub",
        last_enqueued_at: null,
        requested_runtime_json: {},
        manifest_json: {
          schema_version: "openplan.county_onramp_manifest.v1",
          generated_at: "2026-03-24T23:00:00Z",
          name: "nevada-run",
          county_fips: "06057",
          county_prefix: "NEVADA",
          run_dir: "/tmp/nevada",
          mode: "existing-run",
          stage: "validation-scaffolded",
          artifacts: {
            scaffold_csv: scaffoldPath,
            review_packet_md: "/tmp/review.md",
            run_summary_json: "/tmp/run_summary.json",
            bundle_manifest_json: "/tmp/bundle_manifest.json",
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
              station_count: 2,
              observed_volume_filled_count: 2,
              observed_volume_missing_count: 0,
              source_agency_filled_count: 2,
              source_agency_tbd_count: 0,
              source_description_filled_count: 2,
              source_description_missing_count: 0,
              ready_station_count: 2,
              next_action_label:
                "All starter stations have observed counts and source metadata recorded. Tighten definitions if needed, then run validation.",
              inline_csv_content:
                "station_id,observed_volume,source_agency,source_description\nA,789,Caltrans,PM 2.4\nB,456,Nevada County,Truckee Way\n",
            },
          },
        },
        validation_summary_json: {},
      },
      error: null,
    });
    countyRunUpdateSelectMock.mockReturnValue({ single: countyRunUpdateSingleMock });
    countyRunUpdateEqMock.mockReturnValue({ select: countyRunUpdateSelectMock });
    countyRunUpdateMock.mockReturnValue({ eq: countyRunUpdateEqMock });

    artifactDeleteTypeEqMock.mockResolvedValue({ error: null });
    artifactDeleteCountyRunEqMock.mockReturnValue({ eq: artifactDeleteTypeEqMock });
    artifactDeleteMock.mockReturnValue({ eq: artifactDeleteCountyRunEqMock });

    artifactSelectOrderMock.mockResolvedValue({
      data: [{ artifact_type: "validation_scaffold_csv", path: scaffoldPath }],
      error: null,
    });
    artifactSelectEqMock.mockReturnValue({ order: artifactSelectOrderMock });
    artifactSelectMock.mockReturnValue({ eq: artifactSelectEqMock });

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
          select: artifactSelectMock,
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("invalidates validation with inline scaffold persistence and non-null validation json", async () => {
    const response = await postCountyRunScaffold(
      jsonRequest({
        csvContent:
          "station_id,observed_volume,source_agency,source_description\nA,789,Caltrans,PM 2.4\nB,456,Nevada County,Truckee Way\n",
      }),
      { params: Promise.resolve({ countyRunId }) }
    );

    expect(response.status).toBe(200);
    const updatePayload = countyRunUpdateMock.mock.calls.at(-1)?.[0] as {
      stage: string;
      status_label: string;
      manifest_json: { summary: { scaffold: { inline_csv_content?: string } } };
      validation_summary_json: Record<string, unknown>;
    };
    expect(updatePayload.stage).toBe("validation-scaffolded");
    expect(updatePayload.status_label).toBe("Validation pending scaffold edits");
    expect(updatePayload.manifest_json.summary.scaffold.inline_csv_content).toBe(
      "station_id,observed_volume,source_agency,source_description\nA,789,Caltrans,PM 2.4\nB,456,Nevada County,Truckee Way\n"
    );
    expect(updatePayload.validation_summary_json).toEqual({});

    const payload = await response.json();
    expect(payload.stage).toBe("validation-scaffolded");
    expect(payload.statusLabel).toBe("Validation pending scaffold edits");
  });
});

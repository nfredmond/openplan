import { beforeEach, describe, expect, it, vi } from "vitest";
import { unlink, writeFile } from "node:fs/promises";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const fromMock = vi.fn();
const countyRunSelectMock = vi.fn();
const countyRunEqMock = vi.fn();
const countyRunMaybeSingleMock = vi.fn();
const scaffoldPath = "/tmp/openplan-scaffold-route-test.csv";

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

import { GET as getCountyRunScaffold } from "@/app/api/county-runs/[countyRunId]/scaffold/route";

function request() {
  return new NextRequest("http://localhost/api/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/scaffold", {
    method: "GET",
  });
}

describe("GET /api/county-runs/[countyRunId]/scaffold", () => {
  beforeEach(async () => {
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
            validation: null,
            bundle_validation: null,
            scaffold: {
              station_count: 1,
              observed_volume_filled_count: 1,
              observed_volume_missing_count: 0,
              source_agency_filled_count: 1,
              source_agency_tbd_count: 0,
              source_description_filled_count: 1,
              source_description_missing_count: 0,
              ready_station_count: 1,
              next_action_label:
                "All starter stations have observed counts and source metadata recorded. Tighten definitions if needed, then run validation.",
            },
          },
        },
      },
      error: null,
    });
    countyRunEqMock.mockReturnValue({ maybeSingle: countyRunMaybeSingleMock });
    countyRunSelectMock.mockReturnValue({ eq: countyRunEqMock });

    fromMock.mockImplementation((table: string) => {
      if (table === "county_runs") {
        return { select: countyRunSelectMock };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });

    await writeFile(
      scaffoldPath,
      "station_id,observed_volume,source_agency,source_description\r\nA,123,Caltrans,PM 1.2",
      "utf8"
    );
  });

  it("returns the registered scaffold path and normalized CSV content", async () => {
    const response = await getCountyRunScaffold(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    const payload = await response.json();
    expect({ status: response.status, payload }).toEqual({
      status: 200,
      payload: {
        path: scaffoldPath,
        csvContent: "station_id,observed_volume,source_agency,source_description\nA,123,Caltrans,PM 1.2\n",
      },
    });
  });

  it("returns inline scaffold content when present even if the registered file is missing", async () => {
    await unlink(scaffoldPath).catch(() => undefined);
    countyRunMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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
            validation: null,
            bundle_validation: null,
            scaffold: {
              station_count: 1,
              observed_volume_filled_count: 1,
              observed_volume_missing_count: 0,
              source_agency_filled_count: 1,
              source_agency_tbd_count: 0,
              source_description_filled_count: 1,
              source_description_missing_count: 0,
              ready_station_count: 1,
              next_action_label:
                "All starter stations have observed counts and source metadata recorded. Tighten definitions if needed, then run validation.",
              inline_csv_content: "station_id,observed_volume,source_agency,source_description\nA,987,Nevada County,Inline test\n",
            },
          },
        },
      },
      error: null,
    });

    const response = await getCountyRunScaffold(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    const payload = await response.json();
    expect({ status: response.status, payload }).toEqual({
      status: 200,
      payload: {
        path: scaffoldPath,
        csvContent: "station_id,observed_volume,source_agency,source_description\nA,987,Nevada County,Inline test\n",
      },
    });
  });

  it("returns 404 when the registered scaffold file is missing", async () => {
    await unlink(scaffoldPath).catch(() => undefined);

    const response = await getCountyRunScaffold(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    const payload = await response.json();
    expect({ status: response.status, payload }).toEqual({
      status: 404,
      payload: { error: "Registered scaffold CSV file was not found" },
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await getCountyRunScaffold(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(401);
  });
});

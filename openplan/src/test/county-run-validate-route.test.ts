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

import { POST as prepareCountyRunValidation } from "@/app/api/county-runs/[countyRunId]/validate/route";

const runDir = "/tmp/openplan-validate-route-test";
const runOutputDir = `${runDir}/run_output`;
const countsCsvPath = `${runDir}/scaffold.csv`;
const projectDbPath = `${runDir}/work/aeq_project/project_database.sqlite`;

function request() {
  return new NextRequest("http://localhost/api/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/validate", {
    method: "POST",
  });
}

describe("POST /api/county-runs/[countyRunId]/validate", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN;
    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    await rm(runDir, { recursive: true, force: true });
    await mkdir(runOutputDir, { recursive: true });
    await mkdir(`${runDir}/work/aeq_project`, { recursive: true });
    await writeFile(countsCsvPath, "station_id,observed_volume,source_agency,source_description\nA,123,Caltrans,PM 1.2\n", "utf8");
    await writeFile(projectDbPath, "", "utf8");

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
          run_dir: runDir,
          mode: "existing-run",
          stage: "validation-scaffolded",
          artifacts: {
            scaffold_csv: countsCsvPath,
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
  });

  it("prepares a validator rerun command when scaffold and runtime outputs are ready", async () => {
    const response = await prepareCountyRunValidation(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ready: true,
      statusLabel: "Ready to validate",
      refreshUrl: "http://localhost/api/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/validate/refresh",
      callbackAuthMode: "session-only",
      runOutputDir,
      countsCsvPath,
      outputDir: `${runDir}/validation`,
      projectDbPath,
    });
    expect(payload.automationCommand).toBeNull();
    expect(String(payload.command)).toContain("validate_screening_observed_counts.py");
    expect(String(payload.command)).toContain(`--run-output-dir '${runOutputDir}'`);
    expect(String(payload.command)).toContain(`--counts-csv '${countsCsvPath}'`);
  });

  it("returns a chained automation command when callback bearer auth is configured", async () => {
    process.env.OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN = "callback-secret";

    const response = await prepareCountyRunValidation(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.callbackAuthMode).toBe("bearer-env");
    expect(String(payload.automationCommand)).toContain("validate_screening_observed_counts.py");
    expect(String(payload.automationCommand)).toContain(
      "curl -sS -X POST 'http://localhost/api/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/validate/refresh'"
    );
    expect(String(payload.automationCommand)).toContain("$OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN");
  });

  it("returns a blocked preparation state when scaffold readiness is incomplete", async () => {
    countyRunMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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
            scaffold_csv: countsCsvPath,
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
              station_count: 2,
              observed_volume_filled_count: 1,
              observed_volume_missing_count: 1,
              source_agency_filled_count: 1,
              source_agency_tbd_count: 1,
              source_description_filled_count: 2,
              source_description_missing_count: 0,
              ready_station_count: 1,
              next_action_label:
                "Complete source metadata and observed counts for the remaining 1 starter stations.",
            },
          },
        },
      },
      error: null,
    });

    const response = await prepareCountyRunValidation(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ready).toBe(false);
    expect(payload.statusLabel).toBe("Validation prep blocked");
    expect(payload.reasons).toContain("Only 1 of 2 starter stations are validator-ready.");
    expect(payload.command).toBeNull();
    expect(payload.automationCommand).toBeNull();
  });
});

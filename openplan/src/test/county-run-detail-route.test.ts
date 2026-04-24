import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const fromMock = vi.fn();
const countyRunSelectMock = vi.fn();
const countyRunEqMock = vi.fn();
const countyRunMaybeSingleMock = vi.fn();
const artifactSelectMock = vi.fn();
const artifactEqMock = vi.fn();
const artifactOrderMock = vi.fn();
const claimDecisionSelectMock = vi.fn();
const claimDecisionEqCountyRunIdMock = vi.fn();
const claimDecisionEqTrackMock = vi.fn();
const claimDecisionMaybeSingleMock = vi.fn();
const sourceManifestSelectMock = vi.fn();
const sourceManifestEqMock = vi.fn();
const sourceManifestOrderMock = vi.fn();
const validationResultSelectMock = vi.fn();
const validationResultEqCountyRunIdMock = vi.fn();
const validationResultEqTrackMock = vi.fn();
const validationResultOrderMock = vi.fn();

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

import { GET as getCountyRunDetail } from "@/app/api/county-runs/[countyRunId]/route";

function request() {
  return new NextRequest("http://localhost/api/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
    method: "GET",
  });
}

describe("GET /api/county-runs/[countyRunId]", () => {
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
        run_name: "nevada-run",
        stage: "validated-screening",
        status_label: "bounded screening-ready",
        enqueue_status: "queued_stub",
        last_enqueued_at: "2026-03-24T23:05:00Z",
        requested_runtime_json: {
          workspaceId: "11111111-1111-4111-8111-111111111111",
          geographyType: "county_fips",
          geographyId: "06057",
          geographyLabel: "Nevada County, CA",
          runName: "nevada-run",
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

    artifactOrderMock.mockResolvedValue({
      data: [
        { artifact_type: "validation_scaffold_csv", path: "/tmp/scaffold.csv" },
        { artifact_type: "validation_review_packet_md", path: "/tmp/review.md" },
      ],
      error: null,
    });
    artifactEqMock.mockReturnValue({ order: artifactOrderMock });
    artifactSelectMock.mockReturnValue({ eq: artifactEqMock });

    claimDecisionMaybeSingleMock.mockResolvedValue({
      data: {
        track: "assignment",
        claim_status: "screening_grade",
        status_reason: "Worst matched facility APE exceeds the claim-grade threshold.",
        reasons_json: ["Worst matched facility APE 237.62% exceeds the 50% claim-grade threshold."],
        validation_summary_json: {
          passed: 3,
          warned: 0,
          failed: 1,
          missingRequiredMetricKeys: [],
          requiredMetricKeys: ["assignment_final_gap", "count_station_matches"],
        },
        decided_at: "2026-03-24T23:00:00Z",
      },
      error: null,
    });
    claimDecisionEqTrackMock.mockReturnValue({ maybeSingle: claimDecisionMaybeSingleMock });
    claimDecisionEqCountyRunIdMock.mockReturnValue({ eq: claimDecisionEqTrackMock });
    claimDecisionSelectMock.mockReturnValue({ eq: claimDecisionEqCountyRunIdMock });

    sourceManifestOrderMock.mockResolvedValue({
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          source_key: "census_tiger_boundary",
          source_kind: "census_tiger",
          source_label: "County boundary and tract geography",
          source_url: "https://tigerweb.geo.census.gov/tigerwebmain/TIGERweb_restmapservice.html",
          source_vintage: "2026",
          geography_id: "06057",
          geography_label: "Nevada County, CA",
          license_note: "U.S. Census public data.",
          citation_text: "U.S. Census TIGER/Line geography for Nevada County, CA.",
        },
      ],
      error: null,
    });
    sourceManifestEqMock.mockReturnValue({ order: sourceManifestOrderMock });
    sourceManifestSelectMock.mockReturnValue({ eq: sourceManifestEqMock });

    validationResultOrderMock.mockResolvedValue({
      data: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          track: "assignment",
          metric_key: "critical_absolute_percent_error",
          metric_label: "Critical facility absolute percent error",
          observed_value: 237.62,
          threshold_value: 50,
          threshold_max_value: null,
          threshold_comparator: "lte",
          status: "fail",
          blocks_claim_grade: true,
          detail: "Worst matched facility APE 237.62% exceeds the 50% claim-grade threshold.",
          source_manifest_id: null,
          evaluated_at: "2026-03-24T23:00:00Z",
        },
      ],
      error: null,
    });
    validationResultEqTrackMock.mockReturnValue({ order: validationResultOrderMock });
    validationResultEqCountyRunIdMock.mockReturnValue({ eq: validationResultEqTrackMock });
    validationResultSelectMock.mockReturnValue({ eq: validationResultEqCountyRunIdMock });

    fromMock.mockImplementation((table: string) => {
      if (table === "county_runs") {
        return { select: countyRunSelectMock };
      }
      if (table === "county_run_artifacts") {
        return { select: artifactSelectMock };
      }
      if (table === "modeling_claim_decisions") {
        return { select: claimDecisionSelectMock };
      }
      if (table === "modeling_source_manifests") {
        return { select: sourceManifestSelectMock };
      }
      if (table === "modeling_validation_results") {
        return { select: validationResultSelectMock };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("returns county run detail with artifacts", async () => {
    const response = await getCountyRunDetail(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.stage).toBe("validated-screening");
    expect(payload.statusLabel).toBe("bounded screening-ready");
    expect(payload.enqueueStatus).toBe("queued_stub");
    expect(payload.lastEnqueuedAt).toBe("2026-03-24T23:05:00Z");
    expect(payload.workerPayload.countyRunId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(payload.artifacts).toEqual([
      { artifactType: "validation_scaffold_csv", path: "/tmp/scaffold.csv" },
      { artifactType: "validation_review_packet_md", path: "/tmp/review.md" },
    ]);
    expect(payload.modelingEvidence.claimDecision.claimStatus).toBe("screening_grade");
    expect(payload.modelingEvidence.validationResults).toHaveLength(1);
    expect(payload.modelingEvidence.sourceManifests).toHaveLength(1);
  });

  it("keeps county-run detail available when modeling evidence tables are not migrated yet", async () => {
    claimDecisionMaybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "modeling_claim_decisions" does not exist', code: "42P01" },
    });

    const response = await getCountyRunDetail(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.modelingEvidence).toBeNull();
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "county_run_modeling_evidence_lookup_failed",
      expect.objectContaining({ missingSchema: true })
    );
  });

  it("returns 404 when county run is missing", async () => {
    countyRunMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const response = await getCountyRunDetail(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "County run not found" });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await getCountyRunDetail(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(401);
  });
});

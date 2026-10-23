import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const mutationMock = vi.fn(() => ({ eq: () => ({ eq: async () => ({ error: null }) }) }));
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

import { GET as getCountyRunProvenance } from "@/app/api/county-runs/[countyRunId]/provenance/route";
import { modelingClaimStatusLabel } from "@/lib/models/evidence-backbone";

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
        enqueue_status: "completed",
        last_enqueued_at: "2026-03-24T23:05:00Z",
        worker_job_id: "123e4567-e89b-12d3-a456-426614174999",
        worker_payload_json: {
          jobId: "123e4567-e89b-12d3-a456-426614174999",
          countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          workspaceId: "11111111-1111-4111-8111-111111111111",
          runName: "nevada-run",
          geographyType: "county_fips",
          geographyId: "06057",
          geographyLabel: "Nevada County, CA",
          countyPrefix: "NEVADA",
          runtimeOptions: {
            keepProject: true,
            force: true,
            calibrateToCounts: false,
            overallDemandScalar: 0.369,
            externalDemandScalar: null,
            hbwScalar: null,
            hboScalar: null,
            nhbScalar: null,
          },
          artifactTargets: {
            attemptDirectory: "data/screening-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/123e4567-e89b-12d3-a456-426614174999",
            scaffoldCsvPath: "data/screening-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/123e4567-e89b-12d3-a456-426614174999/validation-scaffold.csv",
            reviewPacketMdPath: "data/screening-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/123e4567-e89b-12d3-a456-426614174999/validation-review-packet.md",
            manifestPath: "data/screening-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/123e4567-e89b-12d3-a456-426614174999/manifest.json",
          },
          callback: {
            manifestIngestUrl: "http://localhost/api/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/manifest",
            hasBearerToken: false,
          },
        },
        worker_url: "https://worker.example/jobs",
        worker_dispatch_error: null,
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
          metrics: { median_absolute_percent_error: 16.01, max_absolute_percent_error: 49.48 },
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
      from: (table: string) => ({ ...fromMock(table), delete: mutationMock, insert: mutationMock, update: mutationMock, upsert: mutationMock }),
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
    expect(payload.enqueueStatus).toBe("completed");
    expect(payload.lastEnqueuedAt).toBe("2026-03-24T23:05:00Z");
    expect(payload.workerPayload.countyRunId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(payload.artifacts).toEqual([
      { artifactType: "validation_scaffold_csv", path: "/tmp/scaffold.csv" },
      { artifactType: "validation_review_packet_md", path: "/tmp/review.md" },
    ]);
    // The stored row says screening_grade, but the run records no rules-v4
    // outcome, so the tier is shown as prototype-only (KI-2026-10-12-001).
    expect(payload.modelingEvidence.claimDecision.claimStatus).toBe("prototype_only");
    expect(payload.modelingEvidence.claimDecision.statusReason).toMatch(
      /^Not assessed: this run has no rules-v4 scientific outcome\./
    );
    expect(countyRunSelectMock).toHaveBeenCalledWith(
      "basis_rules_version:validation_summary_json->validation_rules_version, basis_outcome:validation_summary_json->model_validation_assessment->>scientific_outcome, basis_evidence_write:validation_summary_json->model_validation_assessment->>validation_evidence_write, basis_reasons:validation_summary_json->model_validation_assessment->reasons"
    );
    expect(payload.modelingEvidence.validationResults).toHaveLength(1);
    expect(payload.modelingEvidence.sourceManifests).toHaveLength(1);
  });

  it("reports unavailable evidence when modeling evidence tables are not migrated yet", async () => {
    claimDecisionMaybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "modeling_claim_decisions" does not exist', code: "42P01" },
    });

    const response = await getCountyRunDetail(request(), {
      params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    });

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.error).toContain("Modeling evidence could not be read");
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
  it.each([
    ["pass", 4, "recorded", "screening_grade"],
    ["fail", 4, "recorded", "prototype_only"],
    ["inconclusive", 4, "recorded", "prototype_only"],
    ["pass", 3, "recorded", "prototype_only"],
    ["pass", 4, "pending", "prototype_only"],
    [null, 4, null, "prototype_only"],
  ])("keeps display and download tiers identical for outcome %s, rules %s, custody %s", async (outcome, version, write, tier) => {
    const { data: row } = await countyRunMaybeSingleMock();
    const validation = {
      ...row.validation_summary_json,
      validation_rules_version: version,
      model_validation_assessment: outcome ? { scientific_outcome: outcome, validation_evidence_write: write, reasons: ["Synthetic outcome reason."] } : null,
    };
    countyRunMaybeSingleMock.mockResolvedValue({ data: {
      ...row, validation_summary_json: validation,
      manifest_json: { ...row.manifest_json, summary: { ...row.manifest_json.summary, validation } },
      basis_rules_version: version, basis_outcome: outcome, basis_evidence_write: write, basis_reasons: ["Synthetic outcome reason."],
    }, error: null });
    const context = { params: Promise.resolve({ countyRunId: row.id }) };
    const displayed = await getCountyRunDetail(request(), context);
    expect(displayed.status).toBe(200);
    const detail = await displayed.json();
    expect(detail.modelingEvidence.claimDecision.claimStatus).toBe(tier);
    const downloaded = await getCountyRunProvenance(request(), context);
    expect(mutationMock).not.toHaveBeenCalled();
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toContain("text/markdown");
    expect(downloaded.headers.get("cache-control")).toBe("no-store");
    const document = await downloaded.text();
    expect(document).toContain(`Assignment claim tier: ${modelingClaimStatusLabel(detail.modelingEvidence.claimDecision.claimStatus)}`);
    expect(document).toContain(detail.modelingEvidence.claimDecision.statusReason);
    expect(document).toContain(detail.modelingEvidence.sourceManifests[0].citationText);
    expect(document).not.toContain("met OpenPlan's screening thresholds");
    // Mutation methods are instrumented separately from the read projections.
    expect(claimDecisionSelectMock).toHaveBeenCalledTimes(2);
    expect(sourceManifestSelectMock).toHaveBeenCalledWith("id, source_key, source_kind, source_label, source_url, source_vintage, geography_id, geography_label, license_note, citation_text");
    expect(claimDecisionEqCountyRunIdMock).toHaveBeenCalledWith("county_run_id", row.id);
  });

  it.each([getCountyRunDetail, getCountyRunProvenance])("refuses malformed and conflicting retained metadata before reading evidence", async handler => {
    const { data: row } = await countyRunMaybeSingleMock();
    for (const [change, message] of [
      [{ manifest_json: { schema_version: "broken" } }, "manifest metadata is malformed"],
      [{ validation_summary_json: [] }, "validation metadata is malformed"],
      [{ validation_summary_json: { stations_matched: 999 } }, "summaries disagree"],
    ] as const) {
      countyRunMaybeSingleMock.mockResolvedValue({ data: { ...row, ...change }, error: null });
      const response = await handler(request(), { params: Promise.resolve({ countyRunId: row.id }) });
      expect(response.status).toBe(409);
      expect((await response.json()).error).toContain(message);
    }
    expect(claimDecisionSelectMock).not.toHaveBeenCalled();
  });

  it("keeps a missing claim explicit in the download without rebuilding one", async () => {
    claimDecisionMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const response = await getCountyRunProvenance(request(), { params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) });
    expect(response.status).toBe(200);
    const document = await response.text();
    expect(document).toContain("Assignment claim tier: Untiered");
    expect(document).toContain("No assignment claim decision is recorded");
    expect(document).not.toContain("met OpenPlan's screening thresholds");
  });

  it.each([getCountyRunDetail, getCountyRunProvenance])("refuses a failed source read instead of reporting no sources", async handler => {
    sourceManifestOrderMock.mockResolvedValue({ data: null, error: { message: "Synthetic read failure" } });
    const response = await handler(request(), { params: Promise.resolve({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("Modeling evidence could not be read");
  });

});

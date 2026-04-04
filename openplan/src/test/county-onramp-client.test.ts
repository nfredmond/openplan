import { describe, expect, it, vi } from "vitest";
import {
  createCountyRun,
  enqueueCountyRun,
  getCountyRunDetail,
  getCountyRunScaffold,
  ingestCountyRunManifest,
  listCountyRuns,
  updateCountyRunScaffold,
} from "@/lib/api/county-onramp-client";

const manifest = {
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
    behavioral_prototype_manifest_json: "/tmp/behavioral/behavioral_demand_prototype_manifest.json",
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
    behavioral_prototype: {
      pipeline_status: "prototype_preflight_complete",
      runtime_status: "behavioral_runtime_blocked",
      runtime_mode: "preflight_only",
      prototype_manifest_path: "/tmp/behavioral/behavioral_demand_prototype_manifest.json",
      caveats: ["ActivitySim CLI is not installed or not on PATH"],
    },
  },
} as const;

describe("county onramp client helpers", () => {
  it("lists county runs", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              geographyLabel: "Nevada County, CA",
              runName: "nevada-run",
              stage: "validated-screening",
              statusLabel: "bounded screening-ready",
              behavioralEvidenceStatusLabel: "Validation-ready county state",
              behavioralComparisonStatusLabel: "Open detail for behavioral readiness",
              updatedAt: "2026-03-24T23:00:00Z",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = await listCountyRuns({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      fetcher: fetcher as typeof fetch,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/county-runs?workspaceId=11111111-1111-4111-8111-111111111111",
      expect.objectContaining({ method: "GET" })
    );
    expect(result.items).toHaveLength(1);
  });

  it("creates a county run", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          countyRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          stage: "bootstrap-incomplete",
          runName: "placer-run",
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      )
    );

    const result = await createCountyRun(
      {
        workspaceId: "11111111-1111-4111-8111-111111111111",
        geographyType: "county_fips",
        geographyId: "06061",
        geographyLabel: "Placer County, CA",
        runName: "placer-run",
        runtimeOptions: { keepProject: true },
      },
      fetcher as typeof fetch
    );

    expect(result.stage).toBe("bootstrap-incomplete");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/county-runs",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("loads county run detail, enqueues runs, and ingests manifests", async () => {
    const detailPayload = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      geographyType: "county_fips",
      geographyId: "06057",
      geographyLabel: "Nevada County, CA",
      runName: "nevada-run",
      stage: "validated-screening",
      statusLabel: "bounded screening-ready",
      manifest,
      artifacts: [{ artifactType: "validation_scaffold_csv", path: "/tmp/scaffold.csv" }],
      validationSummary: { screening_gate: { status_label: "bounded screening-ready" } },
    };

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(detailPayload), { status: 200, headers: { "content-type": "application/json" } })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            status: "queued_stub",
            deliveryMode: "prepared",
            workerPayload: {
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
                overallDemandScalar: 0.369,
                externalDemandScalar: null,
                hbwScalar: null,
                hboScalar: null,
                nhbScalar: null,
              },
              artifactTargets: {
                scaffoldCsvPath: "/tmp/scaffold.csv",
                reviewPacketMdPath: "/tmp/review.md",
                manifestPath: "/tmp/manifest.json",
              },
              callback: {
                manifestIngestUrl: "http://localhost/api/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/manifest",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(detailPayload), { status: 200, headers: { "content-type": "application/json" } })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            path: "/tmp/scaffold.csv",
            csvContent: "station_id,observed_volume,source_agency,source_description\nA,123,Caltrans,PM 1.2\n",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...detailPayload,
            stage: "validation-scaffolded",
            statusLabel: "Validation pending scaffold edits",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "failed" }), {
          status: 202,
          headers: { "content-type": "application/json" },
        })
      );

    const detail = await getCountyRunDetail("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", fetcher as typeof fetch);
    expect(detail.stage).toBe("validated-screening");

    const enqueued = await enqueueCountyRun("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", fetcher as typeof fetch);
    expect(enqueued.status).toBe("queued_stub");
    expect(enqueued.deliveryMode).toBe("prepared");

    const completed = await ingestCountyRunManifest(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      { status: "completed", manifest },
      fetcher as typeof fetch
    );
    expect("stage" in completed && completed.stage).toBe("validated-screening");

    const scaffold = await getCountyRunScaffold("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", fetcher as typeof fetch);
    expect(scaffold.path).toBe("/tmp/scaffold.csv");
    expect(scaffold.csvContent).toContain("station_id,observed_volume");

    const scaffoldUpdated = await updateCountyRunScaffold(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      { csvContent: "station_id,observed_volume,source_agency,source_description\nA,123,Caltrans,PM 1.2\n" },
      fetcher as typeof fetch
    );
    expect(scaffoldUpdated.stage).toBe("validation-scaffolded");
    expect(scaffoldUpdated.statusLabel).toBe("Validation pending scaffold edits");

    const failed = await ingestCountyRunManifest(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      { status: "failed", error: { message: "Worker crashed" } },
      fetcher as typeof fetch
    );
    expect(failed).toEqual({ countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "failed" });
  });

  it("throws friendly errors for non-ok responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Failed to load county runs" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      })
    );

    await expect(
      listCountyRuns({ workspaceId: "11111111-1111-4111-8111-111111111111", fetcher: fetcher as typeof fetch })
    ).rejects.toThrow("Failed to load county runs");
  });
});

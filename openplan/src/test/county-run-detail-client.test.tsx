import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let searchParamsValue = "";
const refreshMock = vi.fn();
const refreshScaffoldMock = vi.fn();
const enqueueMock = vi.fn();
const updateScaffoldMock = vi.fn();
const prepareValidationMock = vi.fn();
const clipboardWriteTextMock = vi.fn();

let detailDataMock = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspaceId: "123e4567-e89b-12d3-a456-426614174000",
  geographyType: "county_fips",
  geographyId: "06057",
  geographyLabel: "Nevada County, CA",
  runName: "nevada-run",
  stage: "validated-screening" as const,
  stageReasonLabel: "bounded screening-ready",
  statusLabel: "bounded screening-ready",
  enqueueStatus: "not-enqueued" as const,
  lastEnqueuedAt: null,
  runtimePresetLabel: null,
  workerPayload: null,
  manifest: null,
  artifacts: [],
  validationSummary: null,
};

vi.mock("next/navigation", () => ({
  usePathname: () => "/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  useSearchParams: () => new URLSearchParams(searchParamsValue),
}));

Object.defineProperty(globalThis.navigator, "clipboard", {
  value: {
    writeText: clipboardWriteTextMock,
  },
  configurable: true,
});

vi.mock("@/lib/hooks/use-county-onramp", () => ({
  useCountyRunDetail: () => ({
    data: detailDataMock,
    loading: false,
    error: null,
    refresh: refreshMock,
  }),
  useCountyRunScaffold: () => ({
    data: {
      path: "/tmp/scaffold.csv",
      csvContent: "station_id,observed_volume,source_agency,source_description\nA,123,Caltrans,PM 1.2\n",
    },
    loading: false,
    error: null,
    refresh: refreshScaffoldMock,
  }),
  useCountyRunMutations: () => ({
    enqueue: enqueueMock,
    updateScaffold: updateScaffoldMock,
    prepareValidation: prepareValidationMock,
    loading: false,
    error: null,
  }),
}));

import { CountyRunDetailClient } from "@/components/county-runs/county-run-detail-client";

describe("CountyRunDetailClient", () => {
  beforeEach(() => {
    searchParamsValue = "";
    detailDataMock = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      workspaceId: "123e4567-e89b-12d3-a456-426614174000",
      geographyType: "county_fips",
      geographyId: "06057",
      geographyLabel: "Nevada County, CA",
      runName: "nevada-run",
      stage: "validated-screening",
      stageReasonLabel: "bounded screening-ready",
      statusLabel: "bounded screening-ready",
      enqueueStatus: "not-enqueued",
      lastEnqueuedAt: null,
      runtimePresetLabel: null,
      workerPayload: null,
      manifest: null,
      artifacts: [],
      validationSummary: null,
    };
    refreshMock.mockReset();
    refreshScaffoldMock.mockReset();
    enqueueMock.mockReset();
    updateScaffoldMock.mockReset();
    prepareValidationMock.mockReset();
    clipboardWriteTextMock.mockReset();
    clipboardWriteTextMock.mockResolvedValue(undefined);
  });

  it("surfaces the saved county dashboard view context on detail pages", () => {
    searchParamsValue =
      "backTo=%2Fcounty-runs%3Fview%3Dneeds-attention%26runtimeStatus%3Dbehavioral_runtime_blocked%26runtimeMode%3Dpreflight_only";

    render(<CountyRunDetailClient countyRunId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);

    expect(screen.getByText("Saved dashboard view")).toBeInTheDocument();
    expect(
      screen.getByText(
        "View: Needs attention · Sort: Recently updated · Runtime: Runtime blocked · Mode: Preflight only"
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to county runs" })).toHaveAttribute(
      "href",
      "/county-runs?view=needs-attention&runtimeStatus=behavioral_runtime_blocked&runtimeMode=preflight_only"
    );
  });

  it("copies the current county detail link with the preserved dashboard context", async () => {
    searchParamsValue =
      "backTo=%2Fcounty-runs%3Fview%3Dneeds-attention%26runtimeStatus%3Dbehavioral_runtime_blocked%26runtimeMode%3Dpreflight_only";

    render(<CountyRunDetailClient countyRunId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy detail link" }));

    await waitFor(() => expect(clipboardWriteTextMock).toHaveBeenCalled());
    expect(String(clipboardWriteTextMock.mock.calls[0]?.[0] ?? "")).toContain(
      "/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?backTo=%2Fcounty-runs%3Fview%3Dneeds-attention%26runtimeStatus%3Dbehavioral_runtime_blocked%26runtimeMode%3Dpreflight_only"
    );
    expect(screen.getByText("Copied detail link")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("surfaces the ActivitySim handoff bundle state honestly", () => {
    detailDataMock = {
      ...detailDataMock,
      manifest: {
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
          activitysim_bundle_manifest_json: "/tmp/activitysim/bundle_manifest.json",
          behavioral_prototype_manifest_json: null,
          behavioral_runtime_manifest_json: null,
          behavioral_runtime_summary_json: null,
          behavioral_ingestion_summary_json: null,
          behavioral_kpi_summary_json: null,
          behavioral_kpi_packet_md: null,
        },
        runtime: {
          keep_project: true,
          force: false,
          overall_demand_scalar: 0.369,
          external_demand_scalar: null,
          hbw_scalar: null,
          hbo_scalar: null,
          nhb_scalar: null,
          activitysim_container_image: "python:3.11-slim",
          container_engine_cli: "docker",
          activitysim_container_cli_template: "activitysim run",
          container_network_mode: "bridge",
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
            screening_gate: { status_label: "bounded screening-ready" },
            metrics: {
              median_absolute_percent_error: 16.01,
              max_absolute_percent_error: 49.48,
            },
          },
          bundle_validation: {
            status_label: "bounded screening-ready",
          },
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
          activitysim_bundle: {
            status: "completed",
            output_dir: "/tmp/activitysim",
            manifest_path: "/tmp/activitysim/bundle_manifest.json",
            land_use_rows: 26,
            households: 41415,
            persons: 102322,
            skim_mode: "copy",
          },
          behavioral_prototype: null,
        },
      },
    };

    render(<CountyRunDetailClient countyRunId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);

    expect(screen.getByText("Why this stage")).toBeInTheDocument();
    expect(screen.getAllByText("bounded screening-ready").length).toBeGreaterThan(0);
    expect(screen.getByText("Validation scaffold")).toBeInTheDocument();
    expect(screen.getByText("Validator-ready")).toBeInTheDocument();
    expect(screen.getByText("Starter stations: 5")).toBeInTheDocument();
    expect(screen.getByText("Validator-ready stations: 5 / 5")).toBeInTheDocument();
    expect(screen.getByText("ActivitySim handoff")).toBeInTheDocument();
    expect(screen.getByText("Bundle ready")).toBeInTheDocument();
    expect(screen.getByText("Bundle ready: Yes")).toBeInTheDocument();
    expect(screen.getByText(/scaffold availability only/i)).toBeInTheDocument();
    expect(screen.getByText("Households: 41415")).toBeInTheDocument();
    expect(screen.getByText("Persons: 102322")).toBeInTheDocument();
    expect(screen.getByText("Skim posture: Copied skims")).toBeInTheDocument();
    expect(screen.getByText("Bundle manifest: /tmp/activitysim/bundle_manifest.json")).toBeInTheDocument();
  });

  it("preloads the current scaffold CSV into the editor", async () => {
    detailDataMock = {
      ...detailDataMock,
      manifest: {
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
            next_action_label: "All starter stations have observed counts and source metadata recorded. Tighten definitions if needed, then run validation.",
          },
        },
      },
    };

    render(<CountyRunDetailClient countyRunId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);

    const textarea = screen.getByPlaceholderText(/paste the full scaffold csv here/i) as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toContain("station_id,observed_volume"));
    expect(textarea.value).toContain("Caltrans");
  });

  it("prepares and copies a validation rerun command for scaffold-ready counties", async () => {
    prepareValidationMock.mockResolvedValue({
      countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ready: true,
      statusLabel: "Ready to validate",
      reasons: [],
      command:
        "python3 'scripts/modeling/validate_screening_observed_counts.py' --run-output-dir '/tmp/nevada/run_output' --counts-csv '/tmp/scaffold.csv' --output-dir '/tmp/nevada/validation'",
      runOutputDir: "/tmp/nevada/run_output",
      countsCsvPath: "/tmp/scaffold.csv",
      outputDir: "/tmp/nevada/validation",
      projectDbPath: null,
    });

    detailDataMock = {
      ...detailDataMock,
      manifest: {
        schema_version: "openplan.county_onramp_manifest.v1",
        generated_at: "2026-03-24T23:00:00Z",
        name: "nevada-run",
        county_fips: "06057",
        county_prefix: "NEVADA",
        run_dir: "/tmp/nevada",
        mode: "existing-run",
        stage: "validation-scaffolded",
        artifacts: {
          scaffold_csv: "/tmp/scaffold.csv",
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
            station_count: 1,
            observed_volume_filled_count: 1,
            observed_volume_missing_count: 0,
            source_agency_filled_count: 1,
            source_agency_tbd_count: 0,
            source_description_filled_count: 1,
            source_description_missing_count: 0,
            ready_station_count: 1,
            next_action_label: "All starter stations have observed counts and source metadata recorded. Tighten definitions if needed, then run validation.",
          },
        },
      },
    };

    render(<CountyRunDetailClient countyRunId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);

    fireEvent.click(screen.getByRole("button", { name: "Prepare validation command" }));

    await waitFor(() => expect(prepareValidationMock).toHaveBeenCalledWith("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
    expect(screen.getByDisplayValue(/validate_screening_observed_counts\.py/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy validation command" }));

    await waitFor(() =>
      expect(clipboardWriteTextMock).toHaveBeenCalledWith(
        "python3 'scripts/modeling/validate_screening_observed_counts.py' --run-output-dir '/tmp/nevada/run_output' --counts-csv '/tmp/scaffold.csv' --output-dir '/tmp/nevada/validation'"
      )
    );
  });

  it("keeps scaffold save disabled until the editor differs from the stored CSV", async () => {
    detailDataMock = {
      ...detailDataMock,
      manifest: {
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
            next_action_label: "All starter stations have observed counts and source metadata recorded. Tighten definitions if needed, then run validation.",
          },
        },
      },
    };

    render(<CountyRunDetailClient countyRunId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);

    const saveButton = screen.getByRole("button", { name: "Save scaffold CSV" });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/paste the full scaffold csv here/i), {
      target: {
        value: "station_id,observed_volume,source_agency,source_description\nA,456,Caltrans,PM 1.2\n",
      },
    });

    expect(saveButton).not.toBeDisabled();
  });

  it("reloads scaffold editor content from the stored CSV", async () => {
    detailDataMock = {
      ...detailDataMock,
      manifest: {
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
            next_action_label: "All starter stations have observed counts and source metadata recorded. Tighten definitions if needed, then run validation.",
          },
        },
      },
    };

    render(<CountyRunDetailClient countyRunId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);

    const textarea = screen.getByPlaceholderText(/paste the full scaffold csv here/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: {
        value: "station_id,observed_volume,source_agency,source_description\nA,456,Caltrans,PM 1.2\n",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reload scaffold CSV" }));

    await waitFor(() => expect(refreshScaffoldMock).toHaveBeenCalled());
    expect(textarea.value).toContain("A,123,Caltrans");
  });

  it("saves pasted scaffold CSV content and refreshes county run detail", async () => {
    updateScaffoldMock.mockResolvedValue({
      ...detailDataMock,
      stage: "validation-scaffolded",
      statusLabel: "Validation pending scaffold edits",
    });

    detailDataMock = {
      ...detailDataMock,
      manifest: {
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
            screening_gate: { status_label: "bounded screening-ready" },
            metrics: {
              median_absolute_percent_error: 16.01,
              max_absolute_percent_error: 49.48,
            },
          },
          bundle_validation: {
            status_label: "bounded screening-ready",
          },
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
    };

    render(<CountyRunDetailClient countyRunId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);

    fireEvent.change(screen.getByPlaceholderText(/paste the full scaffold csv here/i), {
      target: {
        value: "station_id,observed_volume,source_agency,source_description\nA,456,Caltrans,PM 1.2\n",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save scaffold CSV" }));

    await waitFor(() =>
      expect(updateScaffoldMock).toHaveBeenCalledWith("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
        csvContent: "station_id,observed_volume,source_agency,source_description\nA,456,Caltrans,PM 1.2\n",
      })
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    await waitFor(() => expect(refreshScaffoldMock).toHaveBeenCalled());
    expect(screen.getByText("Scaffold saved and readiness refreshed.")).toBeInTheDocument();
  });

  it("surfaces behavioral comparison artifact paths when a run is comparison-ready", () => {
    detailDataMock = {
      ...detailDataMock,
      manifest: {
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
          activitysim_bundle_manifest_json: "/tmp/activitysim/bundle_manifest.json",
          behavioral_prototype_manifest_json: "/tmp/behavioral/behavioral_demand_prototype_manifest.json",
          behavioral_runtime_manifest_json: "/tmp/behavioral/runtime/activitysim_runtime_manifest.json",
          behavioral_runtime_summary_json: "/tmp/behavioral/runtime/activitysim_runtime_summary.json",
          behavioral_ingestion_summary_json: "/tmp/behavioral/ingestion/activitysim_ingestion_summary.json",
          behavioral_kpi_summary_json: "/tmp/behavioral/kpis/activitysim_behavioral_kpi_summary.json",
          behavioral_kpi_packet_md: "/tmp/behavioral/kpis/activitysim_behavioral_kpi_packet.md",
        },
        runtime: {
          keep_project: true,
          force: false,
          overall_demand_scalar: 0.369,
          external_demand_scalar: null,
          hbw_scalar: null,
          hbo_scalar: null,
          nhb_scalar: null,
          activitysim_container_image: "python:3.11-slim",
          container_engine_cli: "docker",
          activitysim_container_cli_template: "activitysim run",
          container_network_mode: "bridge",
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
            screening_gate: { status_label: "bounded screening-ready" },
            metrics: {
              median_absolute_percent_error: 16.01,
              max_absolute_percent_error: 49.48,
            },
          },
          bundle_validation: {
            status_label: "bounded screening-ready",
          },
          activitysim_bundle: {
            status: "completed",
            output_dir: "/tmp/activitysim",
            manifest_path: "/tmp/activitysim/bundle_manifest.json",
            land_use_rows: 26,
            households: 41415,
            persons: 102322,
            skim_mode: "copy",
          },
          behavioral_prototype: {
            pipeline_status: "behavioral_runtime_succeeded",
            runtime_status: "behavioral_runtime_succeeded",
            runtime_mode: "containerized_activitysim",
            runtime_posture: "containerized ActivitySim runtime executed successfully",
            output_root: "/tmp/behavioral",
            prototype_manifest_path: "/tmp/behavioral/behavioral_demand_prototype_manifest.json",
            runtime_manifest_path: "/tmp/behavioral/runtime/activitysim_runtime_manifest.json",
            runtime_summary_path: "/tmp/behavioral/runtime/activitysim_runtime_summary.json",
            ingestion_summary_path: "/tmp/behavioral/ingestion/activitysim_ingestion_summary.json",
            kpi_summary_path: "/tmp/behavioral/kpis/activitysim_behavioral_kpi_summary.json",
            kpi_packet_path: "/tmp/behavioral/kpis/activitysim_behavioral_kpi_packet.md",
            caveats: [],
          },
        },
      },
    };

    render(<CountyRunDetailClient countyRunId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);

    expect(screen.getByText("Comparison ready: Yes")).toBeInTheDocument();
    expect(screen.getByText("Runtime summary: /tmp/behavioral/runtime/activitysim_runtime_summary.json")).toBeInTheDocument();
    expect(
      screen.getByText("Ingestion summary: /tmp/behavioral/ingestion/activitysim_ingestion_summary.json")
    ).toBeInTheDocument();
    expect(screen.getByText("Comparison summary: /tmp/behavioral/kpis/activitysim_behavioral_kpi_summary.json")).toBeInTheDocument();
    expect(screen.getByText("Comparison packet: /tmp/behavioral/kpis/activitysim_behavioral_kpi_packet.md")).toBeInTheDocument();
  });

  it("falls back to the default county runs page when no saved dashboard view is present", () => {
    render(<CountyRunDetailClient countyRunId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);

    expect(screen.queryByText("Saved dashboard view")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to county runs" })).toHaveAttribute("href", "/county-runs");
  });
});

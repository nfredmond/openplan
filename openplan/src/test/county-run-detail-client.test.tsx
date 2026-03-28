import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let searchParamsValue = "";
const refreshMock = vi.fn();
const enqueueMock = vi.fn();
const clipboardWriteTextMock = vi.fn();

let detailDataMock = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspaceId: "123e4567-e89b-12d3-a456-426614174000",
  geographyType: "county_fips",
  geographyId: "06057",
  geographyLabel: "Nevada County, CA",
  runName: "nevada-run",
  stage: "validated-screening" as const,
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
  useCountyRunMutations: () => ({
    enqueue: enqueueMock,
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
    enqueueMock.mockReset();
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

    expect(screen.getByText("ActivitySim handoff")).toBeInTheDocument();
    expect(screen.getByText("Bundle ready")).toBeInTheDocument();
    expect(screen.getByText("Bundle ready: Yes")).toBeInTheDocument();
    expect(screen.getByText(/scaffold availability only/i)).toBeInTheDocument();
    expect(screen.getByText("Households: 41415")).toBeInTheDocument();
    expect(screen.getByText("Persons: 102322")).toBeInTheDocument();
    expect(screen.getByText("Skim posture: Copied skims")).toBeInTheDocument();
    expect(screen.getByText("Bundle manifest: /tmp/activitysim/bundle_manifest.json")).toBeInTheDocument();
  });

  it("falls back to the default county runs page when no saved dashboard view is present", () => {
    render(<CountyRunDetailClient countyRunId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);

    expect(screen.queryByText("Saved dashboard view")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to county runs" })).toHaveAttribute("href", "/county-runs");
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVITYSIM_BEHAVIORAL_SMOKE_CLI_TEMPLATE } from "@/lib/models/county-runtime-presets";

const routerPushMock = vi.fn();
const routerReplaceMock = vi.fn();
const refreshMock = vi.fn();
const createMock = vi.fn();

let searchParamsValue = "";

let countyRunsItemsMock = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    geographyLabel: "Nevada County, CA",
    runName: "nevada-run",
    stage: "validated-screening",
    statusLabel: "bounded screening-ready",
    enqueueStatus: "queued_stub",
    runtimePresetLabel: "Containerized behavioral smoke runtime (prototype)",
    behavioralPipelineStatus: "prototype_preflight_complete",
    behavioralRuntimeStatus: "behavioral_runtime_blocked",
    behavioralRuntimeMode: "preflight_only",
    behavioralEvidenceReady: true,
    behavioralComparisonReady: false,
    behavioralEvidenceStatusLabel: "Preflight-only behavioral evidence",
    behavioralComparisonStatusLabel: "Comparison blocked: preflight only",
    artifactAvailabilityLabels: ["Scaffold CSV", "Validation summary", "Behavioral prototype"],
    metricAvailabilityLabels: ["Zones 26", "Links 3174", "Gap 0.0091", "Median APE 16.01%"],
    zoneCount: 26,
    loadedLinks: 3174,
    finalGap: 0.0091,
    medianApe: 16.01,
    updatedAt: "2026-03-24T23:00:00Z",
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    geographyLabel: "Placer County, CA",
    runName: "placer-run",
    stage: "bootstrap-incomplete",
    statusLabel: null,
    enqueueStatus: "not-enqueued",
    runtimePresetLabel: "Containerized behavioral smoke runtime (prototype)",
    behavioralPipelineStatus: null,
    behavioralRuntimeStatus: null,
    behavioralRuntimeMode: null,
    behavioralEvidenceReady: false,
    behavioralComparisonReady: false,
    behavioralEvidenceStatusLabel: "Behavioral lane requested",
    behavioralComparisonStatusLabel: "Await recorded behavioral state",
    artifactAvailabilityLabels: [],
    zoneCount: null,
    loadedLinks: null,
    finalGap: null,
    medianApe: null,
    updatedAt: "2026-03-24T23:10:00Z",
  },
];

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: routerReplaceMock,
  }),
  usePathname: () => "/county-runs",
  useSearchParams: () => new URLSearchParams(searchParamsValue),
}));

vi.mock("@/lib/hooks/use-county-onramp", () => ({
  useCountyRuns: () => ({
    items: countyRunsItemsMock,
    loading: false,
    error: null,
    refresh: refreshMock,
  }),
  useCountyRunMutations: () => ({
    create: createMock,
    loading: false,
    error: null,
  }),
  useCountyGeographySearch: () => ({
    items: [
      {
        geographyId: "06057",
        geographyLabel: "Nevada County, CA",
        countyPrefix: "NEVADA",
        countySlug: "nevada-county-06057",
        suggestedRunName: "nevada-county-06057-runtime",
      },
    ],
    loading: false,
    error: null,
  }),
}));

import { CountyRunsPageClient } from "@/components/county-runs/county-runs-page-client";

describe("CountyRunsPageClient", () => {
  beforeEach(() => {
    countyRunsItemsMock = [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        geographyLabel: "Nevada County, CA",
        runName: "nevada-run",
        stage: "validated-screening",
        statusLabel: "bounded screening-ready",
        enqueueStatus: "queued_stub",
        runtimePresetLabel: "Containerized behavioral smoke runtime (prototype)",
        behavioralPipelineStatus: "prototype_preflight_complete",
        behavioralRuntimeStatus: "behavioral_runtime_blocked",
        behavioralRuntimeMode: "preflight_only",
        behavioralEvidenceReady: true,
        behavioralComparisonReady: false,
        behavioralEvidenceStatusLabel: "Preflight-only behavioral evidence",
        behavioralComparisonStatusLabel: "Comparison blocked: preflight only",
        artifactAvailabilityLabels: ["Scaffold CSV", "Validation summary", "Behavioral prototype"],
        metricAvailabilityLabels: ["Zones 26", "Links 3174", "Gap 0.0091", "Median APE 16.01%"],
        zoneCount: 26,
        loadedLinks: 3174,
        finalGap: 0.0091,
        medianApe: 16.01,
        updatedAt: "2026-03-24T23:00:00Z",
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        geographyLabel: "Placer County, CA",
        runName: "placer-run",
        stage: "bootstrap-incomplete",
        statusLabel: null,
        enqueueStatus: "not-enqueued",
        runtimePresetLabel: "Containerized behavioral smoke runtime (prototype)",
        behavioralPipelineStatus: null,
        behavioralRuntimeStatus: null,
        behavioralRuntimeMode: null,
        behavioralEvidenceReady: false,
        behavioralComparisonReady: false,
        behavioralEvidenceStatusLabel: "Behavioral lane requested",
        behavioralComparisonStatusLabel: "Await recorded behavioral state",
        artifactAvailabilityLabels: [],
        zoneCount: null,
        loadedLinks: null,
        finalGap: null,
        medianApe: null,
        updatedAt: "2026-03-24T23:10:00Z",
      },
    ];
    searchParamsValue = "";
    routerPushMock.mockReset();
    routerReplaceMock.mockReset();
    routerReplaceMock.mockImplementation((href: string) => {
      searchParamsValue = href.split("?")[1] ?? "";
    });
    refreshMock.mockReset();
    refreshMock.mockResolvedValue(null);
    createMock.mockReset();
    createMock.mockResolvedValue({
      countyRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      stage: "bootstrap-incomplete",
      runName: "nevada-smoke",
    });
  });

  it("shows behavioral readiness badges for list items and submits the standard runtime by default", async () => {
    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);

    expect(screen.getByText("Total runs")).toBeInTheDocument();
    expect(screen.getAllByText("Needs attention").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Prototype blocked").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Comparison-ready").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Validated screening").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "All runs (2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Needs attention (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Best validated (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prototype blocked (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Comparison-ready (0)" })).toBeInTheDocument();
    expect(screen.getByText("Preflight-only evidence")).toBeInTheDocument();
    expect(screen.getByText("Preflight-only behavioral evidence")).toBeInTheDocument();
    expect(screen.getByText("Pipeline status: Prototype preflight complete")).toBeInTheDocument();
    expect(screen.getByText("Runtime status: Behavioral runtime blocked")).toBeInTheDocument();
    expect(screen.getByText("Runtime mode: Preflight only")).toBeInTheDocument();
    expect(screen.getByText("Artifacts")).toBeInTheDocument();
    expect(screen.getByText("Scaffold CSV")).toBeInTheDocument();
    expect(screen.getByText("Validation summary")).toBeInTheDocument();
    expect(screen.getByText("Behavioral prototype")).toBeInTheDocument();
    expect(screen.getByText("Metrics")).toBeInTheDocument();
    expect(screen.getByText("Zones 26")).toBeInTheDocument();
    expect(screen.getByText("Links 3174")).toBeInTheDocument();
    expect(screen.getByText("Gap 0.0091")).toBeInTheDocument();
    expect(screen.getByText("Median APE 16.01%")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("County search"), { target: { value: "Nevada" } });
    fireEvent.click(screen.getByRole("button", { name: "Nevada County, CA FIPS 06057 · Prefix NEVADA" }));
    fireEvent.change(screen.getByLabelText("Run name"), { target: { value: "nevada-standard" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch county run" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith({
      workspaceId: "123e4567-e89b-12d3-a456-426614174000",
      geographyType: "county_fips",
      geographyId: "06057",
      geographyLabel: "Nevada County, CA",
      runName: "nevada-standard",
      countyPrefix: "NEVADA",
      runtimeOptions: { keepProject: true },
    });
    await waitFor(() => expect(routerPushMock).toHaveBeenCalledWith("/county-runs/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));
  });

  it("filters county runs by behavioral state and persists the filter in the URL", () => {
    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);

    expect(screen.getByText("Showing 2 of 2 county runs")).toBeInTheDocument();
    expect(screen.getByText("Nevada County, CA")).toBeInTheDocument();
    expect(screen.getByText("Placer County, CA")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Behavioral state"), {
      target: { value: "lane-requested" },
    });

    expect(routerReplaceMock).toHaveBeenCalledWith("/county-runs?behavioral=lane-requested", { scroll: false });
    expect(screen.getByRole("button", { name: "Behavioral: Lane requested ×" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear all filters" })).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 2 county runs")).toBeInTheDocument();
    expect(screen.queryByText("Nevada County, CA")).not.toBeInTheDocument();
    expect(screen.getByText("Placer County, CA")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Behavioral state"), {
      target: { value: "preflight-only" },
    });

    expect(routerReplaceMock).toHaveBeenCalledWith("/county-runs?behavioral=preflight-only", { scroll: false });
    expect(screen.getByText("Showing 1 of 2 county runs")).toBeInTheDocument();
    expect(screen.getByText("Nevada County, CA")).toBeInTheDocument();
    expect(screen.queryByText("Placer County, CA")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Runtime status"), {
      target: { value: "behavioral_runtime_blocked" },
    });

    expect(routerReplaceMock).toHaveBeenCalledWith(
      "/county-runs?behavioral=preflight-only&runtimeStatus=behavioral_runtime_blocked",
      { scroll: false }
    );
    expect(screen.getByText("Showing 1 of 2 county runs")).toBeInTheDocument();
    expect(screen.getByText("Nevada County, CA")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Runtime mode"), {
      target: { value: "preflight_only" },
    });

    expect(routerReplaceMock).toHaveBeenCalledWith(
      "/county-runs?behavioral=preflight-only&runtimeStatus=behavioral_runtime_blocked&runtimeMode=preflight_only",
      { scroll: false }
    );
    expect(screen.getByRole("button", { name: "Runtime status: Runtime blocked ×" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Runtime mode: Preflight only ×" })).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 2 county runs")).toBeInTheDocument();
    expect(screen.getByText("Nevada County, CA")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));

    expect(routerReplaceMock).toHaveBeenCalledWith("/county-runs", { scroll: false });
    expect(screen.getByText("Showing 2 of 2 county runs")).toBeInTheDocument();
    expect(screen.getByText("Nevada County, CA")).toBeInTheDocument();
    expect(screen.getByText("Placer County, CA")).toBeInTheDocument();
  });

  it("initializes behavioral and runtime filters from the URL", () => {
    searchParamsValue = "runtimeStatus=behavioral_runtime_blocked&runtimeMode=preflight_only";

    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);

    expect(screen.getByDisplayValue("Runtime blocked")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Preflight only")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 2 county runs")).toBeInTheDocument();
    expect(screen.getByText("Nevada County, CA")).toBeInTheDocument();
    expect(screen.queryByText("Placer County, CA")).not.toBeInTheDocument();
  });

  it("persists county sorting in the URL", () => {
    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);

    fireEvent.change(screen.getByLabelText("Sort by"), {
      target: { value: "final-gap-asc" },
    });

    expect(routerReplaceMock).toHaveBeenCalledWith("/county-runs?sort=final-gap-asc", { scroll: false });
    expect(screen.getByDisplayValue("Lowest final gap")).toBeInTheDocument();
  });

  it("lets summary tiles drive quick-view presets", () => {
    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);

    fireEvent.click(screen.getByRole("button", { name: "Summary tile: Prototype blocked" }));

    expect(routerReplaceMock).toHaveBeenCalledWith("/county-runs?view=prototype-blocked&sort=final-gap-asc", {
      scroll: false,
    });
    expect(screen.getByDisplayValue("Lowest final gap")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View: Prototype blocked ×" })).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 2 county runs")).toBeInTheDocument();
    expect(screen.getByText("Nevada County, CA")).toBeInTheDocument();
    expect(screen.queryByText("Placer County, CA")).not.toBeInTheDocument();
  });

  it("applies quick-view presets with URL-backed sort defaults", () => {
    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);

    fireEvent.click(screen.getByRole("button", { name: "Best validated (1)" }));

    expect(routerReplaceMock).toHaveBeenCalledWith("/county-runs?view=best-validated&sort=median-ape-asc", {
      scroll: false,
    });
    expect(screen.getByDisplayValue("Lowest median APE")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View: Best validated ×" })).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 2 county runs")).toBeInTheDocument();
    expect(screen.getByText("Nevada County, CA")).toBeInTheDocument();
    expect(screen.queryByText("Placer County, CA")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));

    expect(routerReplaceMock).toHaveBeenCalledWith("/county-runs", { scroll: false });
    expect(screen.getByDisplayValue("Recently updated")).toBeInTheDocument();
  });

  it("initializes county sorting from the URL", () => {
    searchParamsValue = "sort=median-ape-asc";

    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);

    expect(screen.getByDisplayValue("Lowest median APE")).toBeInTheDocument();
  });

  it("initializes quick view presets from the URL", () => {
    searchParamsValue = "view=prototype-blocked&sort=final-gap-asc";

    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);

    expect(screen.getByDisplayValue("Lowest final gap")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View: Prototype blocked ×" })).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 2 county runs")).toBeInTheDocument();
    expect(screen.getByText("Nevada County, CA")).toBeInTheDocument();
    expect(screen.queryByText("Placer County, CA")).not.toBeInTheDocument();
  });

  it("submits the containerized behavioral smoke preset and shows honest caveats", async () => {
    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);

    fireEvent.change(screen.getByLabelText("Runtime preset"), {
      target: { value: "activitysim_behavioral_smoke" },
    });

    expect(screen.getAllByText("Containerized behavioral smoke runtime (prototype)").length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText(/Prototype only\. This surfaces a containerized behavioral smoke path/)
    ).toBeInTheDocument();
    expect(screen.getByText(/activitysimContainerImage: python:3\.11-slim/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(ACTIVITYSIM_BEHAVIORAL_SMOKE_CLI_TEMPLATE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("County search"), { target: { value: "06057" } });
    fireEvent.click(screen.getByRole("button", { name: "Nevada County, CA FIPS 06057 · Prefix NEVADA" }));
    fireEvent.change(screen.getByLabelText("Run name"), { target: { value: "nevada-smoke" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch county run" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith({
      workspaceId: "123e4567-e89b-12d3-a456-426614174000",
      geographyType: "county_fips",
      geographyId: "06057",
      geographyLabel: "Nevada County, CA",
      runName: "nevada-smoke",
      countyPrefix: "NEVADA",
      runtimeOptions: {
        keepProject: true,
        activitysimContainerImage: "python:3.11-slim",
        containerEngineCli: "docker",
        activitysimContainerCliTemplate: ACTIVITYSIM_BEHAVIORAL_SMOKE_CLI_TEMPLATE,
        containerNetworkMode: "bridge",
      },
    });
  });
});

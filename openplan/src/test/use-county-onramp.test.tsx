import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listCountyRunsMock = vi.fn();
const getCountyRunDetailMock = vi.fn();
const createCountyRunMock = vi.fn();
const enqueueCountyRunMock = vi.fn();
const updateCountyRunScaffoldMock = vi.fn();
const ingestCountyRunManifestMock = vi.fn();
const searchCountyGeographiesMock = vi.fn();

vi.mock("@/lib/api/county-onramp-client", () => ({
  listCountyRuns: (...args: unknown[]) => listCountyRunsMock(...args),
  getCountyRunDetail: (...args: unknown[]) => getCountyRunDetailMock(...args),
  createCountyRun: (...args: unknown[]) => createCountyRunMock(...args),
  enqueueCountyRun: (...args: unknown[]) => enqueueCountyRunMock(...args),
  updateCountyRunScaffold: (...args: unknown[]) => updateCountyRunScaffoldMock(...args),
  ingestCountyRunManifest: (...args: unknown[]) => ingestCountyRunManifestMock(...args),
}));

vi.mock("@/lib/api/county-geographies-client", () => ({
  searchCountyGeographies: (...args: unknown[]) => searchCountyGeographiesMock(...args),
}));

import {
  useCountyGeographySearch,
  useCountyRunDetail,
  useCountyRunMutations,
  useCountyRuns,
} from "@/lib/hooks/use-county-onramp";

describe("useCountyOnramp hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("searches county geographies", async () => {
    searchCountyGeographiesMock.mockResolvedValue({
      items: [
        {
          geographyId: "06057",
          geographyLabel: "Nevada County, CA",
          countyPrefix: "NEVADA",
          countySlug: "nevada-county-06057",
          suggestedRunName: "nevada-county-06057-runtime",
        },
      ],
    });

    const { result } = renderHook(() => useCountyGeographySearch("nevada", { debounceMs: 0 }));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0]?.geographyId).toBe("06057");
  });

  it("loads county runs for a workspace", async () => {
    listCountyRunsMock.mockResolvedValue({
      items: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          geographyLabel: "Nevada County, CA",
          runName: "nevada-run",
          stage: "validated-screening",
          statusLabel: "bounded screening-ready",
          updatedAt: "2026-03-24T23:00:00Z",
        },
      ],
    });

    const { result } = renderHook(() => useCountyRuns({ workspaceId: "workspace-1" }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("loads county run detail", async () => {
    getCountyRunDetailMock.mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      geographyType: "county_fips",
      geographyId: "06057",
      geographyLabel: "Nevada County, CA",
      runName: "nevada-run",
      stage: "validated-screening",
      statusLabel: "bounded screening-ready",
      manifest: null,
      artifacts: [],
      validationSummary: null,
    });

    const { result } = renderHook(() => useCountyRunDetail("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.stage).toBe("validated-screening");
  });

  it("creates county runs, updates scaffolds, and ingests manifests via mutation helper", async () => {
    createCountyRunMock.mockResolvedValue({
      countyRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      stage: "bootstrap-incomplete",
      runName: "placer-run",
    });
    enqueueCountyRunMock.mockResolvedValue({
      countyRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      status: "queued_stub",
      deliveryMode: "prepared",
      workerPayload: {
        countyRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        callback: { manifestIngestUrl: "http://localhost/api/county-runs/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/manifest" },
      },
    });
    updateCountyRunScaffoldMock.mockResolvedValue({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      geographyType: "county_fips",
      geographyId: "06061",
      geographyLabel: "Placer County, CA",
      runName: "placer-run",
      stage: "validation-scaffolded",
      statusLabel: "Validation pending scaffold edits",
      manifest: null,
      artifacts: [],
      validationSummary: null,
    });
    ingestCountyRunManifestMock.mockResolvedValue({
      countyRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      status: "failed",
    });

    const { result } = renderHook(() => useCountyRunMutations());

    let createResult;
    await act(async () => {
      createResult = await result.current.create({
        workspaceId: "123e4567-e89b-12d3-a456-426614174000",
        geographyType: "county_fips",
        geographyId: "06061",
        geographyLabel: "Placer County, CA",
        runName: "placer-run",
        runtimeOptions: {},
      });
    });

    expect(createResult).toMatchObject({ runName: "placer-run" });

    let enqueueResult;
    await act(async () => {
      enqueueResult = await result.current.enqueue("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    });

    expect(enqueueResult).toMatchObject({
      countyRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      status: "queued_stub",
    });

    let scaffoldResult;
    await act(async () => {
      scaffoldResult = await result.current.updateScaffold("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
        csvContent: "station_id,observed_volume,source_agency,source_description\nA,123,Caltrans,PM 1.2\n",
      });
    });

    expect(scaffoldResult).toMatchObject({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      stage: "validation-scaffolded",
    });

    let ingestResult;
    await act(async () => {
      ingestResult = await result.current.ingestManifest("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
        status: "failed",
        error: { message: "Worker crashed" },
      });
    });

    expect(ingestResult).toEqual({ countyRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "failed" });
    expect(result.current.error).toBeNull();
  });
});

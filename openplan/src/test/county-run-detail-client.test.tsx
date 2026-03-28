import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let searchParamsValue = "";
const refreshMock = vi.fn();
const enqueueMock = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchParamsValue),
}));

vi.mock("@/lib/hooks/use-county-onramp", () => ({
  useCountyRunDetail: () => ({
    data: {
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
    },
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
    refreshMock.mockReset();
    enqueueMock.mockReset();
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

  it("falls back to the default county runs page when no saved dashboard view is present", () => {
    render(<CountyRunDetailClient countyRunId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);

    expect(screen.queryByText("Saved dashboard view")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to county runs" })).toHaveAttribute("href", "/county-runs");
  });
});

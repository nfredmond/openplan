import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVITYSIM_BEHAVIORAL_SMOKE_CLI_TEMPLATE } from "@/lib/models/county-runtime-presets";

const routerPushMock = vi.fn();
const refreshMock = vi.fn();
const createMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

vi.mock("@/lib/hooks/use-county-onramp", () => ({
  useCountyRuns: () => ({
    items: [],
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
    routerPushMock.mockReset();
    refreshMock.mockReset();
    refreshMock.mockResolvedValue(null);
    createMock.mockReset();
    createMock.mockResolvedValue({
      countyRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      stage: "bootstrap-incomplete",
      runName: "nevada-smoke",
    });
  });

  it("submits the standard runtime by default", async () => {
    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);

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

  it("submits the containerized behavioral smoke preset and shows honest caveats", async () => {
    render(<CountyRunsPageClient workspaceId="123e4567-e89b-12d3-a456-426614174000" />);

    fireEvent.change(screen.getByLabelText("Runtime preset"), {
      target: { value: "activitysim_behavioral_smoke" },
    });

    expect(screen.getAllByText("Containerized behavioral smoke runtime (prototype)")).toHaveLength(2);
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
